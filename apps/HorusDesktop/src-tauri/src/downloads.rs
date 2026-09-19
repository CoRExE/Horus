use crate::{
    download_storage as storage,
    download_support::{write_error, Diagnostics, Progress},
};
use crate::{
    relay::{self, PreparedStream, Relay},
    MediaSource,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    sync::{Arc, Mutex},
};
use storage::Download;
use tauri::Emitter;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    sync::oneshot,
};
use uuid::Uuid;

#[derive(Default)]
pub struct Jobs(
    Mutex<HashMap<String, Option<oneshot::Sender<()>>>>,
    std::sync::atomic::AtomicBool,
);

impl Jobs {
    fn cancel(&self, id: &str) -> Result<(), String> {
        if let Some(sender) = self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .get_mut(id)
            .and_then(Option::take)
        {
            let _ = sender.send(());
        }
        Ok(())
    }
    pub fn cancel_all(&self) {
        if let Ok(mut jobs) = self.0.lock() {
            self.1.store(true, std::sync::atomic::Ordering::SeqCst);
            for sender in jobs.values_mut() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(());
                }
            }
        }
    }
    pub fn is_empty(&self) -> bool {
        self.0.lock().map(|jobs| jobs.is_empty()).unwrap_or(true)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    bytes: u64,
    phase: &'static str,
    bytes_per_second: Option<f64>,
    percent: Option<f64>,
    eta_seconds: Option<f64>,
}

#[tauri::command]
pub async fn get_download_directory(state: tauri::State<'_, Relay>) -> Result<String, String> {
    Ok(storage::directory(&state.downloads)?
        .to_string_lossy()
        .into())
}
#[tauri::command]
pub async fn set_download_directory(
    directory: Option<String>,
    state: tauri::State<'_, Relay>,
    jobs: tauri::State<'_, Jobs>,
) -> Result<String, String> {
    let guard = jobs.0.lock().map_err(|e| e.to_string())?;
    if !guard.is_empty() {
        return Err("Attendez la fin du téléchargement avant de changer de dossier.".into());
    }
    Ok(storage::set_directory(&state.downloads, directory)?
        .to_string_lossy()
        .into())
}

pub fn clean_partial_files(directory: &Path) {
    storage::clean_pending(directory);
    if let Ok(entries) = std::fs::read_dir(directory) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|ext| ext == "part") {
                let _ = std::fs::remove_file(entry.path());
            }
            if entry.path().extension().is_some_and(|ext| ext == "mp4")
                && entry
                    .path()
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .is_some_and(|id| Uuid::parse_str(id).is_ok())
                && !entry.path().with_extension("json").exists()
            {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

#[tauri::command]
pub async fn download_media(
    id: String,
    source: MediaSource,
    metadata: serde_json::Value,
    state: tauri::State<'_, Relay>,
    jobs: tauri::State<'_, Jobs>,
    app: tauri::AppHandle,
) -> Result<Download, String> {
    let progress_id = id.clone();
    run_download(id, source, metadata, &state, &jobs, move |progress| {
        let mut payload = serde_json::to_value(progress).unwrap();
        payload["id"] = progress_id.clone().into();
        let _ = app.emit("download-progress", payload);
    })
    .await
}

async fn run_download(
    id: String,
    source: MediaSource,
    metadata: serde_json::Value,
    state: &Relay,
    jobs: &Jobs,
    on_progress: impl Fn(DownloadProgress) + Send + 'static,
) -> Result<Download, String> {
    let id = Uuid::parse_str(&id)
        .map_err(|_| "Identifiant invalide")?
        .to_string();
    let (cancel, cancelled) = oneshot::channel();
    let mut download = {
        let mut running = jobs.0.lock().map_err(|e| e.to_string())?;
        if jobs.1.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Application en cours de fermeture".into());
        }
        if !running.is_empty() {
            return Err("Un téléchargement est déjà en cours".into());
        }
        let download = storage::begin(&state.downloads, &id, metadata)?;
        running.insert(id.clone(), Some(cancel));
        download
    };
    let file = download.file_path.as_ref().unwrap().clone();
    let partial = file.with_extension("part");
    let relay_id = match state.register(source).await {
        Ok(id) => id,
        Err(e) => {
            storage::rollback(&state.downloads, &download);
            jobs.0.lock().unwrap().remove(&id);
            return Err(e);
        }
    };
    let result = async {
        let mut command = relay::ffmpeg_command(&state.local_url(&relay_id))?;
        command.args(["-loglevel", "info", "-nostats", "-movflags", "+faststart", "-progress", "pipe:1", "-f", "mp4", "-y"])
            .arg(&partial).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|_| "Impossible de démarrer FFmpeg pour le téléchargement")?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let diagnostics = Arc::new(Mutex::new(Diagnostics::default()));
        let stats = diagnostics.clone();
        let progress = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut progress = Progress::default();
            let mut last = (std::time::Instant::now(), 0_u64);
            while let Ok(Some(line)) = lines.next_line().await {
                if progress.feed(&line) {
                    let duration = stats.lock().unwrap().duration_seconds;
                    let (percent, eta_seconds) = progress.estimate(duration);
                    let elapsed = last.0.elapsed().as_secs_f64();
                    let bytes_per_second = (elapsed >= 0.1).then(|| progress.bytes.saturating_sub(last.1) as f64 / elapsed);
                    last = (std::time::Instant::now(), progress.bytes);
                    on_progress(DownloadProgress {
                        bytes: progress.bytes,
                        phase: if line == "progress=end" || percent == Some(99.0) { "finalizing" } else { "downloading" },
                        bytes_per_second, percent, eta_seconds,
                    });
                }
            }
        });
        let errors_seen = diagnostics.clone();
        let errors = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buffer = [0; 4096];
            // Keep only bounded diagnostic markers, never log stderr/source URLs.
            while let Ok(length) = reader.read(&mut buffer).await {
                if length == 0 { break; }
                errors_seen.lock().unwrap().feed(&buffer[..length]);
            }
        });
        let status = tokio::select! {
            result = child.wait() => result.map_err(|_| "Impossible de suivre le téléchargement".to_string()),
            _ = cancelled => { let _ = child.kill().await; Err("Téléchargement annulé".into()) }
        };
        let _ = progress.await;
        let _ = errors.await;
        if !status?.success() { return Err(diagnostics.lock().unwrap().message().into()); }
        download.size_bytes = tokio::fs::metadata(&partial).await.map_err(write_error)?.len();
        if download.size_bytes == 0 { return Err("Le fichier téléchargé est vide".into()); }
        download.downloaded_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        storage::commit(&state.downloads, &download)?;
        Ok(download.clone())
    }.await;
    state.release(&relay_id).await;
    if result.is_err() {
        storage::rollback(&state.downloads, &download);
    }
    jobs.0.lock().unwrap().remove(&id);
    result
}

#[tauri::command]
pub fn cancel_download(id: String, jobs: tauri::State<'_, Jobs>) -> Result<(), String> {
    jobs.cancel(&id)
}

#[tauri::command]
pub async fn list_downloads(state: tauri::State<'_, Relay>) -> Result<Vec<Download>, String> {
    storage::list(&state.downloads)
}

#[tauri::command]
pub async fn remove_download(id: String, state: tauri::State<'_, Relay>) -> Result<(), String> {
    storage::remove(&state.downloads, &id)
}

#[tauri::command]
pub async fn offline_stream(
    id: String,
    receiver: Option<String>,
    state: tauri::State<'_, Relay>,
) -> Result<PreparedStream, String> {
    relay::register_offline(&state, id, receiver).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, middleware, routing::get, Router};
    use std::{
        path::PathBuf,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
        time::Duration,
    };
    use tokio::net::TcpListener;
    use tower_http::services::ServeDir;

    struct TestDirectory(PathBuf);
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    #[ignore = "Requires FFmpeg and fixtures generated by pnpm test:fixtures"]
    async fn media_integration_download_remux_failure_and_cancellation() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/.media-fixtures");
        assert!(
            fixtures.join("sample.m3u8").is_file(),
            "Run pnpm test:fixtures first"
        );
        let directory = TestDirectory(
            std::env::temp_dir().join(format!("horus-media-test-{}", Uuid::new_v4())),
        );
        tokio::fs::create_dir_all(&directory.0).await.unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let slow_request = Arc::new(tokio::sync::Notify::new());
        let notified = slow_request.clone();
        let source = Router::new()
            .route("/broken.mp4", get(|| async { "not a media file" }))
            .route(
                "/slow.mp4",
                get(move || {
                    let notified = notified.clone();
                    async move {
                        notified.notify_one();
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        "not a media file"
                    }
                }),
            )
            .fallback_service(ServeDir::new(fixtures))
            .layer(middleware::from_fn(
                |request: Request<Body>, next: middleware::Next| async move {
                    // Every playlist and segment must preserve the source headers.
                    assert_eq!(
                        request.headers().get("x-horus-fixture").unwrap(),
                        "required"
                    );
                    next.run(request).await
                },
            ));
        let source_task = tokio::spawn(async move {
            axum::serve(listener, source).await.unwrap();
        });
        let state = Relay::start(directory.0.clone()).await.unwrap();
        let jobs = Arc::new(Jobs::default());
        let source = |name: &str| MediaSource {
            url: format!("http://127.0.0.1:{port}/{name}"),
            headers: HashMap::from([("X-Horus-Fixture".into(), "required".into())]),
        };

        let external = TestDirectory(directory.0.join("external"));
        tokio::fs::create_dir_all(&external.0).await.unwrap();
        for name in ["sample.mp4", "sample.m3u8"] {
            if name == "sample.m3u8" {
                storage::set_directory(&state.downloads, Some(external.0.to_string_lossy().into()))
                    .unwrap();
            }
            let id = Uuid::new_v4().to_string();
            let progress = Arc::new(AtomicU64::new(0));
            let observed = progress.clone();
            let downloaded = tokio::time::timeout(
                Duration::from_secs(20),
                run_download(
                    id.clone(),
                    source(name),
                    serde_json::json!({ "title": "Synthetic fixture" }),
                    &state,
                    &jobs,
                    move |progress| {
                        observed.fetch_max(progress.bytes, Ordering::SeqCst);
                    },
                ),
            )
            .await
            .expect("Download timed out")
            .expect(name);
            assert!(downloaded.size_bytes > 1000);
            assert!(progress.load(Ordering::SeqCst) > 0);
            assert!(jobs.is_empty());
            assert!(!directory.0.join(format!("{id}.part")).exists());
            let saved: Download = serde_json::from_slice(
                &tokio::fs::read(directory.0.join(format!("{id}.json")))
                    .await
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(saved.metadata["title"], "Synthetic fixture");
            let prepared = relay::register_offline(&state, id, None).await.unwrap();
            let response = state
                .client
                .get(&prepared.url)
                .header("Range", "bytes=0-31")
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 206);
            assert!(response
                .bytes()
                .await
                .unwrap()
                .windows(4)
                .any(|window| window == b"ftyp"));
            // Decode the resulting file, not just its header, to validate the remux.
            let result = relay::ffmpeg_command(&prepared.url)
                .unwrap()
                .args(["-c", "rawvideo", "-an", "-f", "null", "-"])
                .output()
                .await
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            state.release(&prepared.id).await;
        }

        assert_eq!(storage::list(&state.downloads).unwrap().len(), 2);
        storage::set_directory(&state.downloads, None).unwrap();
        let bridge_id = state.register(source("sample.m3u8")).await.unwrap();
        let response = state
            .client
            .get(format!(
                "http://127.0.0.1:{}/transport/{bridge_id}",
                state.port
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "video/mp2t");
        let transport = response.bytes().await.unwrap();
        assert!(transport.len() > 188);
        assert_eq!(transport.len() % 188, 0);
        assert!(transport.chunks(188).all(|packet| packet[0] == 0x47));
        state.release(&bridge_id).await;

        let failed_id = Uuid::new_v4().to_string();
        assert!(run_download(
            failed_id.clone(),
            source("broken.mp4"),
            serde_json::Value::Null,
            &state,
            &jobs,
            |_| {}
        )
        .await
        .is_err());
        for extension in ["part", "mp4", "json", "json.part"] {
            assert!(!directory
                .0
                .join(format!("{failed_id}.{extension}"))
                .exists());
        }
        assert!(jobs.is_empty());

        let cancelled_id = Uuid::new_v4().to_string();
        let cancel_id = cancelled_id.clone();
        let downloading_state = state.clone();
        let downloading_jobs = jobs.clone();
        let slow_source = source("slow.mp4");
        let download = tokio::spawn(async move {
            run_download(
                cancel_id,
                slow_source,
                serde_json::Value::Null,
                &downloading_state,
                &downloading_jobs,
                |_| {},
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(5), slow_request.notified())
            .await
            .unwrap();
        assert!(run_download(
            Uuid::new_v4().to_string(),
            source("sample.mp4"),
            serde_json::Value::Null,
            &state,
            &jobs,
            |_| {}
        )
        .await
        .unwrap_err()
        .contains("déjà en cours"));
        jobs.cancel(&cancelled_id).unwrap();
        let error = tokio::time::timeout(Duration::from_secs(3), download)
            .await
            .expect("Cancellation did not stop FFmpeg")
            .unwrap()
            .unwrap_err();
        assert!(error.contains("annulé"));
        assert!(jobs.is_empty());
        for extension in ["part", "mp4", "json", "json.part"] {
            assert!(!directory
                .0
                .join(format!("{cancelled_id}.{extension}"))
                .exists());
        }
        jobs.cancel_all();
        assert!(run_download(
            Uuid::new_v4().to_string(),
            source("sample.mp4"),
            serde_json::Value::Null,
            &state,
            &jobs,
            |_| {}
        )
        .await
        .unwrap_err()
        .contains("fermeture"));
        state.stop();
        source_task.abort();
    }
}
