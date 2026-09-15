mod cast;
mod discovery;
mod downloads;
mod power;
mod relay;

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};
use tauri::Manager;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MediaSource {
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

pub fn http_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "URL invalide")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Seules les URL HTTP et HTTPS sont autorisées".into());
    }
    Ok(url)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponse {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
}

#[tauri::command]
async fn http_text(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    state: tauri::State<'_, relay::Relay>,
) -> Result<HttpResponse, String> {
    let url = http_url(&url)?;
    let method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "HEAD" => reqwest::Method::HEAD,
        _ => return Err("Méthode HTTP non prise en charge".into()),
    };
    let mut request = state
        .client
        .request(method, url)
        .timeout(Duration::from_millis(
            timeout_ms.unwrap_or(15_000).clamp(1_000, 60_000),
        ));
    for (key, value) in headers {
        request = request.header(key, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }
    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(k, v)| Some((k.to_string(), v.to_str().ok()?.into())))
        .collect();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 10 * 1024 * 1024 {
            return Err("Réponse texte trop volumineuse".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").into(),
        headers,
        body: String::from_utf8_lossy(&bytes).into(),
    })
}

#[tauri::command]
fn runtime_info() -> serde_json::Value {
    serde_json::json!({ "platform": std::env::consts::OS, "architecture": std::env::consts::ARCH, "ffmpeg": relay::ffmpeg_path().is_ok() })
}

#[tauri::command]
async fn open_release_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "URL invalide")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !regex::Regex::new(r"^/CoRExE/Horus/releases/download/desktop-v\d+\.\d+\.\d+/HorusDesktop-[A-Za-z0-9.\-]+$").unwrap().is_match(parsed.path())
    {
        return Err("Seuls les installateurs Horus sur GitHub sont autorisés".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = tokio::process::Command::new("/usr/bin/open");
    #[cfg(target_os = "linux")]
    let mut command = tokio::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = tokio::process::Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    let status = command
        .arg(url)
        .status()
        .await
        .map_err(|error| format!("Impossible d’ouvrir le navigateur : {error}"))?;
    if !status.success() {
        return Err("Le navigateur n’a pas pu être ouvert".into());
    }
    Ok(())
}

pub fn run() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?.join("downloads");
            std::fs::create_dir_all(&data_dir)?;
            downloads::clean_partial_files(&data_dir);
            let relay = tauri::async_runtime::block_on(relay::Relay::start(data_dir))?;
            app.manage(relay);
            app.manage(downloads::Jobs::default());
            app.manage(cast::CastSession::default());
            app.manage(power::PlaybackPower::new()?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            http_text,
            runtime_info,
            open_release_url,
            power::set_playback_awake,
            relay::prepare_stream,
            relay::release_stream,
            discovery::discover_dlna,
            discovery::discover_cast,
            cast::cast_load,
            cast::cast_control,
            downloads::download_media,
            downloads::cancel_download,
            downloads::list_downloads,
            downloads::remove_download,
            downloads::offline_stream
        ])
        .build(tauri::generate_context!())
        .expect("Impossible de démarrer Horus Desktop")
        .run(|app, event| {
            static CLOSING: std::sync::atomic::AtomicBool =
                std::sync::atomic::AtomicBool::new(false);
            if matches!(
                &event,
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::Destroyed,
                    ..
                }
            ) {
                app.state::<power::PlaybackPower>().shutdown();
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                app.state::<power::PlaybackPower>().shutdown();
                if !CLOSING.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_exit();
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        app.state::<downloads::Jobs>().cancel_all();
                        app.state::<relay::Relay>().stop();
                        let _ = cast::cast_control(
                            "stop".into(),
                            None,
                            app.state::<cast::CastSession>(),
                        )
                        .await;
                        for _ in 0..100 {
                            if app.state::<downloads::Jobs>().is_empty() {
                                break;
                            }
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                        app.exit(0);
                    });
                }
            }
        });
}
