use crate::{http_url, MediaSource};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{Request, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use futures_util::StreamExt;
use regex::Regex;
use serde::Serialize;
use std::{collections::HashMap, path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    net::{TcpListener, UdpSocket},
    sync::RwLock,
};
use tokio_util::io::ReaderStream;
use tower::ServiceExt;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeFile,
};
use uuid::Uuid;

#[derive(Clone)]
struct Resource {
    source: MediaSource,
    group: String,
    closed: tokio::sync::watch::Sender<bool>,
}

#[derive(Clone)]
pub struct Relay {
    pub client: reqwest::Client,
    pub port: u16,
    pub downloads: PathBuf,
    resources: Arc<RwLock<HashMap<String, Resource>>>,
    shutdown: tokio::sync::watch::Sender<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedStream {
    pub id: String,
    pub url: String,
    pub content_type: String,
}

impl Relay {
    pub async fn start(downloads: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(("0.0.0.0", 0)).await?;
        let relay = Self {
            port: listener.local_addr()?.port(),
            downloads,
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .read_timeout(Duration::from_secs(30))
                .build()?,
            resources: Default::default(),
            shutdown: tokio::sync::watch::channel(false).0,
        };
        // Chromecast's receiver fetches HLS cross-origin. Resource UUIDs are the
        // credentials; no cookies or arbitrary upstream URLs are accepted here.
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([axum::http::Method::GET, axum::http::Method::HEAD])
            .allow_headers([axum::http::header::RANGE]);
        let app = Router::new()
            .route("/media/{id}", get(media))
            .route("/media/{id}/{name}", get(named_media))
            .route("/transport/{id}", get(transport))
            .route("/offline/{id}", get(offline))
            .layer(cors)
            .with_state(relay.clone());
        tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(listener, app).await {
                eprintln!("Horus relay: {error}");
            }
        });
        Ok(relay)
    }

    pub async fn register(&self, source: MediaSource) -> Result<String, String> {
        http_url(&source.url)?;
        let id = Uuid::new_v4().to_string();
        self.resources.write().await.insert(
            id.clone(),
            Resource {
                source,
                group: id.clone(),
                closed: tokio::sync::watch::channel(false).0,
            },
        );
        Ok(id)
    }

    pub async fn release(&self, id: &str) {
        self.resources.write().await.retain(|_, value| {
            if value.group == id {
                value.closed.send_replace(true);
                false
            } else {
                true
            }
        });
    }

    pub fn stop(&self) {
        self.shutdown.send_replace(true);
    }

    pub fn local_url(&self, id: &str) -> String {
        format!("http://127.0.0.1:{}/media/{id}", self.port)
    }

    pub async fn host_for(&self, receiver: Option<&str>) -> Result<String, String> {
        if let Some(receiver) = receiver {
            let receiver: std::net::Ipv4Addr = receiver
                .parse()
                .map_err(|_| "Adresse IPv4 du téléviseur invalide")?;
            let socket = UdpSocket::bind("0.0.0.0:0")
                .await
                .map_err(|e| e.to_string())?;
            socket
                .connect((receiver, 9))
                .await
                .map_err(|e| e.to_string())?;
            Ok(socket
                .local_addr()
                .map_err(|e| e.to_string())?
                .ip()
                .to_string())
        } else {
            Ok("127.0.0.1".into())
        }
    }
}

#[tauri::command]
pub async fn prepare_stream(
    source: MediaSource,
    format: String,
    receiver: Option<String>,
    bridge: bool,
    state: tauri::State<'_, Relay>,
) -> Result<PreparedStream, String> {
    if bridge {
        ffmpeg_path()?;
    }
    let host = state.host_for(receiver.as_deref()).await?;
    let id = state.register(source).await?;
    let path = if bridge { "transport" } else { "media" };
    let content_type = if bridge {
        "video/mp2t"
    } else if format == "hls" {
        "application/vnd.apple.mpegurl"
    } else {
        "video/mp4"
    };
    Ok(PreparedStream {
        url: format!("http://{host}:{}/{path}/{id}", state.port),
        id,
        content_type: content_type.into(),
    })
}

#[tauri::command]
pub async fn release_stream(id: String, state: tauri::State<'_, Relay>) -> Result<(), String> {
    state.release(&id).await;
    Ok(())
}

fn failure(status: StatusCode, text: &str) -> Response {
    Response::builder()
        .status(status)
        .body(Body::from(text.to_owned()))
        .unwrap()
}

// Relative paths keep every nested playlist, key and segment behind the same
// authenticated (unguessable UUID) relay URL, on loopback or the selected LAN IP.
pub async fn rewrite_playlist(
    state: &Relay,
    text: &str,
    base: &url::Url,
    resource_id: &str,
) -> Result<String, String> {
    let uri = Regex::new(r#"URI="([^"]+)""#).unwrap();
    let mut resources = state.resources.write().await;
    let resource = resources.get(resource_id).cloned().ok_or("Flux fermé")?;
    let mut register = |value: &str| -> Result<String, String> {
        let target = base.join(value).map_err(|e| e.to_string())?;
        http_url(target.as_str())?;
        let existing = resources
            .iter()
            .find(|(_, item)| item.group == resource.group && item.source.url == target.as_str())
            .map(|(id, _)| id.clone());
        let id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
        if resources.len() >= 100_000 {
            return Err("Manifeste trop volumineux".into());
        }
        resources.entry(id.clone()).or_insert_with(|| Resource {
            source: MediaSource {
                url: target.to_string(),
                headers: resource.source.headers.clone(),
            },
            group: resource.group.clone(),
            closed: resource.closed.clone(),
        });
        // FFmpeg validates HLS segment extensions. Keep the source extension on
        // an opaque URL while keeping signed URLs and original filenames private.
        let extension = std::path::Path::new(target.path())
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| value.len() <= 10 && value.chars().all(|c| c.is_ascii_alphanumeric()))
            .map(|value| format!(".{value}"))
            .unwrap_or_default();
        Ok(format!("/media/{id}/resource{extension}"))
    };
    let mut lines = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            lines.push(String::new());
        } else if line.starts_with('#') {
            let mut rewritten = line.to_string();
            for captures in uri.captures_iter(line) {
                rewritten = rewritten.replace(
                    &captures[0],
                    &format!("URI=\"{}\"", register(&captures[1])?),
                );
            }
            lines.push(rewritten);
        } else {
            lines.push(register(line.trim())?);
        }
    }
    Ok(lines.join("\n") + "\n")
}

async fn named_media(
    State(state): State<Relay>,
    Path((id, _name)): Path<(String, String)>,
    request: Request<Body>,
) -> Response {
    media(State(state), Path(id), request).await
}

async fn media(
    State(state): State<Relay>,
    Path(id): Path<String>,
    request: Request<Body>,
) -> Response {
    let resource = state.resources.read().await.get(&id).cloned();
    let Some(resource) = resource else {
        return failure(StatusCode::NOT_FOUND, "Flux fermé");
    };
    let mut upstream = state
        .client
        .request(request.method().clone(), &resource.source.url);
    for (key, value) in &resource.source.headers {
        upstream = upstream.header(key, value);
    }
    if let Some(range) = request.headers().get("range") {
        upstream = upstream.header("range", range);
    }
    let response = match upstream.send().await {
        Ok(r) => r,
        Err(_) => return failure(StatusCode::BAD_GATEWAY, "Source inaccessible"),
    };
    let status = response.status();
    let final_url = response.url().clone();
    let headers = response.headers().clone();
    let is_hls = final_url.path().ends_with(".m3u8")
        || headers
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|h| h.contains("mpegurl"));
    if is_hls && status.is_success() && request.method() != axum::http::Method::HEAD {
        let text = match response.text().await {
            Ok(text) if text.len() <= 5_000_000 => text,
            _ => return failure(StatusCode::BAD_GATEWAY, "Manifeste invalide"),
        };
        return match rewrite_playlist(&state, &text, &final_url, &id).await {
            Ok(body) => Response::builder()
                .header("content-type", "application/vnd.apple.mpegurl")
                .header("cache-control", "no-store")
                .body(Body::from(body))
                .unwrap(),
            Err(_) => failure(StatusCode::BAD_GATEWAY, "Manifeste invalide"),
        };
    }
    let mut result = Response::builder().status(status);
    for key in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
    ] {
        if let Some(value) = headers.get(key) {
            result = result.header(key, value);
        }
    }
    let mut closed = resource.closed.subscribe();
    result
        .body(Body::from_stream(response.bytes_stream().take_until(
            async move {
                if !*closed.borrow() {
                    let _ = closed.changed().await;
                }
            },
        )))
        .unwrap()
}

fn bundled_ffmpeg(directory: &std::path::Path) -> Option<PathBuf> {
    #[cfg(windows)]
    let names = ["horus-ffmpeg.exe", "ffmpeg.exe"];
    #[cfg(target_os = "linux")]
    let names = ["horus-ffmpeg", "ffmpeg"];
    #[cfg(not(any(target_os = "linux", windows)))]
    let names = ["ffmpeg"];
    names
        .iter()
        .map(|name| directory.join(name))
        .find(|path| path.is_file())
}

pub fn ffmpeg_path() -> Result<PathBuf, String> {
    let binary = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let mut candidates = Vec::new();
    // Tauri places sidecars next to Horus. A dedicated name on Windows/Linux
    // avoids replacing /usr/bin/ffmpeg when installing the Debian package.
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            if let Some(bundled) = bundled_ffmpeg(directory) {
                return Ok(bundled);
            }
        }
    }
    candidates.extend(
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|p| p.join(binary)),
    );
    // Finder does not inherit the shell PATH on macOS.
    if cfg!(target_os = "macos") {
        candidates.extend(["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].map(PathBuf::from));
    }
    candidates.into_iter().find(|p| p.is_file()).ok_or_else(|| "FFmpeg est requis pour les téléchargements et le relais DLNA. Installez-le puis relancez Horus.".into())
}

pub fn ffmpeg_command(input: &str) -> Result<tokio::process::Command, String> {
    let mut command = tokio::process::Command::new(ffmpeg_path()?);
    command.kill_on_drop(true).args([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-rw_timeout",
        "15000000",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c",
        "copy",
    ]);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    Ok(command)
}

async fn transport(
    State(state): State<Relay>,
    Path(id): Path<String>,
    request: Request<Body>,
) -> Response {
    let resource = state.resources.read().await.get(&id).cloned();
    let Some(resource) = resource else {
        return failure(StatusCode::NOT_FOUND, "Flux fermé");
    };
    let mut response = Response::builder()
        .header("content-type", "video/mp2t")
        .header("transferMode.dlna.org", "Streaming");
    if request.method() == axum::http::Method::HEAD {
        return response.body(Body::empty()).unwrap();
    }
    let mut command = match ffmpeg_command(&state.local_url(&id)) {
        Ok(c) => c,
        Err(e) => return failure(StatusCode::SERVICE_UNAVAILABLE, &e),
    };
    command
        .args(["-f", "mpegts", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(_) => return failure(StatusCode::BAD_GATEWAY, "FFmpeg indisponible"),
    };
    let stdout = child.stdout.take().unwrap();
    // Keep the child owned by the response stream; disconnecting kills FFmpeg.
    let mut shutdown = state.shutdown.subscribe();
    let mut closed = resource.closed.subscribe();
    let stream = ReaderStream::new(stdout)
        .map(move |chunk| {
            let _keep_alive = &child;
            chunk
        })
        .take_until(async move {
            if *closed.borrow() || *shutdown.borrow() {
                return;
            }
            tokio::select! { _ = shutdown.changed() => {}, _ = closed.changed() => {} }
        });
    response = response.header("contentFeatures.dlna.org", "DLNA.ORG_OP=00;DLNA.ORG_CI=1");
    response.body(Body::from_stream(stream)).unwrap()
}

async fn offline(
    State(state): State<Relay>,
    Path(id): Path<String>,
    request: Request<Body>,
) -> Response {
    // Offline IDs are relay capabilities too; raw library IDs are never served.
    let resource = state.resources.read().await.get(&id).cloned();
    let Some(resource) = resource else {
        return failure(StatusCode::NOT_FOUND, "Fichier indisponible");
    };
    let Ok(file_id) = Uuid::parse_str(&resource.source.url) else {
        return failure(StatusCode::NOT_FOUND, "Fichier invalide");
    };
    let Ok(file) = crate::download_storage::path_for(&state.downloads, &file_id.to_string()) else {
        return failure(StatusCode::NOT_FOUND, "Fichier indisponible");
    };
    match ServeFile::new(file).oneshot(request).await {
        Ok(response) => response.map(Body::new),
        Err(_) => failure(StatusCode::NOT_FOUND, "Fichier indisponible"),
    }
}

pub async fn register_offline(
    state: &Relay,
    file_id: String,
    receiver: Option<String>,
) -> Result<PreparedStream, String> {
    let file_id = Uuid::parse_str(&file_id)
        .map_err(|_| "Identifiant invalide")?
        .to_string();
    if !crate::download_storage::path_for(&state.downloads, &file_id)?.is_file() {
        return Err("Téléchargement introuvable. Vérifiez que son disque est connecté.".into());
    }
    let host = state.host_for(receiver.as_deref()).await?;
    let id = Uuid::new_v4().to_string();
    state.resources.write().await.insert(
        id.clone(),
        Resource {
            source: MediaSource {
                url: file_id,
                headers: Default::default(),
            },
            group: id.clone(),
            closed: tokio::sync::watch::channel(false).0,
        },
    );
    Ok(PreparedStream {
        url: format!("http://{host}:{}/offline/{id}", state.port),
        id,
        content_type: "video/mp4".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn serves_ranges_and_preserves_upstream_headers_behind_revocable_urls() {
        let directory = std::env::temp_dir().join(format!("horus-relay-test-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&directory).await.unwrap();
        let source_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source_port = source_listener.local_addr().unwrap().port();
        let source = Router::new().route(
            "/video.mp4",
            get(|request: Request<Body>| async move {
                assert_eq!(
                    request.headers().get("referer").unwrap(),
                    "https://source.test/"
                );
                assert_eq!(request.headers().get("range").unwrap(), "bytes=1-3");
                Response::builder()
                    .status(206)
                    .header("content-range", "bytes 1-3/6")
                    .header("content-type", "video/mp4")
                    .body(Body::from("bcd"))
                    .unwrap()
            }),
        );
        let source_task = tokio::spawn(async move {
            axum::serve(source_listener, source).await.unwrap();
        });
        let relay = Relay::start(directory.clone()).await.unwrap();
        let id = relay
            .register(MediaSource {
                url: format!("http://127.0.0.1:{source_port}/video.mp4"),
                headers: HashMap::from([("Referer".into(), "https://source.test/".into())]),
            })
            .await
            .unwrap();
        let response = relay
            .client
            .get(relay.local_url(&id))
            .header("Range", "bytes=1-3")
            .header("Origin", "https://receiver.test")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.headers()["content-range"], "bytes 1-3/6");
        assert_eq!(response.headers()["access-control-allow-origin"], "*");
        assert_eq!(response.text().await.unwrap(), "bcd");
        relay.release(&id).await;
        assert_eq!(
            relay
                .client
                .get(relay.local_url(&id))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );

        let file_id = Uuid::new_v4().to_string();
        tokio::fs::write(directory.join(format!("{file_id}.mp4")), "abcdef")
            .await
            .unwrap();
        // Legacy downloads still have an index entry, without an explicit filePath.
        tokio::fs::write(
            directory.join(format!("{file_id}.json")),
            serde_json::to_vec(&serde_json::json!({
                "id": file_id,
                "metadata": { "title": "Offline fixture" },
                "sizeBytes": 6,
                "downloadedAt": 0
            })).unwrap(),
        )
        .await
        .unwrap();
        let offline = register_offline(&relay, file_id.clone(), None)
            .await
            .unwrap();
        let response = relay
            .client
            .get(&offline.url)
            .header("Range", "bytes=2-4")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.text().await.unwrap(), "cde");
        assert_eq!(
            relay
                .client
                .get(format!("http://127.0.0.1:{}/offline/{file_id}", relay.port))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        relay.release(&offline.id).await;
        source_task.abort();
        tokio::fs::remove_file(directory.join(format!("{file_id}.mp4")))
            .await
            .unwrap();
        tokio::fs::remove_file(directory.join(format!("{file_id}.json")))
            .await
            .unwrap();
        tokio::fs::remove_dir(directory).await.unwrap();
    }
    #[tokio::test]
    async fn rewrites_nested_signed_playlists_and_keys_and_releases_group() {
        let state = Relay {
            client: reqwest::Client::new(),
            port: 1234,
            downloads: PathBuf::new(),
            resources: Default::default(),
            shutdown: tokio::sync::watch::channel(false).0,
        };
        let id = state
            .register(MediaSource {
                url: "https://source.test/path/master.m3u8?sig=abc".into(),
                headers: HashMap::from([("Referer".into(), "https://source.test/".into())]),
            })
            .await
            .unwrap();
        let text = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key?sig=k\"\nvideo/part.ts?sig=v\n";
        let rewritten = rewrite_playlist(
            &state,
            text,
            &http_url("https://cdn.test/path/master.m3u8").unwrap(),
            &id,
        )
        .await
        .unwrap();
        assert!(rewritten.contains("URI=\"/media/"));
        assert!(!rewritten.contains("sig="));
        assert!(rewritten.trim_end().ends_with("/resource.ts"));
        assert!(state.resources.read().await.values().any(|r| r.source.url
            == "https://cdn.test/path/video/part.ts?sig=v"
            && r.source.headers.contains_key("Referer")));
        rewrite_playlist(
            &state,
            text,
            &http_url("https://cdn.test/path/master.m3u8").unwrap(),
            &id,
        )
        .await
        .unwrap();
        assert_eq!(state.resources.read().await.len(), 3);
        state.release(&id).await;
        assert!(state.resources.read().await.is_empty());
    }
    #[test]
    fn rejects_non_http_sources() {
        assert!(http_url("file:///etc/passwd").is_err());
        assert!(http_url("https://source.test/media").is_ok());
    }

    #[test]
    fn bundled_ffmpeg_keeps_legacy_lookup() {
        let directory = std::env::temp_dir().join(format!("horus-sidecar-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        assert!(bundled_ffmpeg(&directory).is_none());
        let binary = directory.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
        std::fs::write(&binary, b"fixture").unwrap();
        assert_eq!(bundled_ffmpeg(&directory), Some(binary));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn bundled_ffmpeg_prefers_horus_over_system_name() {
        let directory = std::env::temp_dir().join(format!("horus-sidecar-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let (dedicated, legacy) = if cfg!(windows) {
            ("horus-ffmpeg.exe", "ffmpeg.exe")
        } else {
            ("horus-ffmpeg", "ffmpeg")
        };
        std::fs::write(directory.join(legacy), b"system").unwrap();
        std::fs::write(directory.join(dedicated), b"bundled").unwrap();
        assert_eq!(bundled_ffmpeg(&directory), Some(directory.join(dedicated)));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
