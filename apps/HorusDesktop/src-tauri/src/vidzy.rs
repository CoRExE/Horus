use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSession {
    key: String,
    user_agent: String,
}

fn validate(embed: &str, referer: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(embed).map_err(|_| "Lecteur Vidzy invalide")?;
    let parent = url::Url::parse(referer).map_err(|_| "Référent Vidzy invalide")?;
    if url.scheme() != "https" || url.host_str() != Some("vidzy.cc") ||
        url.port().is_some() || !url.username().is_empty() || url.password().is_some() ||
        !regex::Regex::new(r"^/embed-[A-Za-z0-9]+\.html$").unwrap().is_match(url.path()) ||
        url.query().is_some() || url.fragment().is_some() ||
        parent.scheme() != "https" || parent.host_str() != Some("vidzy.org") {
        return Err("Seuls les lecteurs HTTPS Vidzy sont autorisés".into());
    }
    Ok(url)
}

// Closing on every return also covers a dropped/cancelled command future.
struct SessionWindow(tauri::WebviewWindow);
impl Drop for SessionWindow {
    fn drop(&mut self) { let _ = self.0.close(); }
}

#[tauri::command]
pub async fn resolve_vidzy_session(app: tauri::AppHandle, embed: String, referer: String) -> Result<BrowserSession, String> {
    let url = validate(&embed, &referer)?;
    let allowed = url.clone();
    // No capability includes these randomly named remote windows. The page has
    // no native command permissions. Use a separate ephemeral browser context.
    let browser = tauri::WebviewWindowBuilder::new(
        &app, format!("vidzy-{}", uuid::Uuid::new_v4()), tauri::WebviewUrl::External(url))
        .visible(false).focused(false).incognito(true)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .initialization_script("window.open = () => null;")
        .on_navigation(move |target| target == &allowed)
        .build().map_err(|_| "Impossible d’ouvrir la session Vidzy")?;
    let window = SessionWindow(browser);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    while tokio::time::Instant::now() < deadline {
        let (send, receive) = tokio::sync::oneshot::channel();
        // The callback API is Fn, so protect the single-use sender.
        let sender = std::sync::Mutex::new(Some(send));
        window.0.eval_with_callback(
            "({key: typeof window.__vzgk === 'string' ? window.__vzgk : '', userAgent: navigator.userAgent})",
            move |value| { if let Some(send) = sender.lock().unwrap().take() { let _ = send.send(value); } }
        ).map_err(|_| "Impossible de lire la validation Vidzy")?;
        if let Ok(Ok(value)) = tokio::time::timeout(Duration::from_secs(1), receive).await {
            if let Ok(session) = serde_json::from_str::<BrowserSession>(&value) {
                if !session.key.is_empty() && session.key.len() <= 4096 &&
                    !session.key.chars().any(char::is_control) &&
                    !session.user_agent.is_empty() && session.user_agent.len() <= 2048 &&
                    !session.user_agent.chars().any(char::is_control) {
                    return Ok(session);
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("La validation navigateur Vidzy n’a pas abouti (20 secondes)".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_vidzy_embeds_can_open_a_session() {
        assert!(validate("https://vidzy.cc/embed-abc123.html", "https://vidzy.org/movie/550/vf").is_ok());
        for embed in ["http://vidzy.cc/embed-abc.html", "https://evil.test/embed-abc.html", "https://vidzy.cc@evil.test/embed-abc.html", "https://vidzy.cc:8443/embed-abc.html", "https://vidzy.cc/embed-abc.html?redirect=x", "https://vidzy.cc/other"] {
            assert!(validate(embed, "https://vidzy.org/movie/550/vf").is_err());
        }
    }
}
