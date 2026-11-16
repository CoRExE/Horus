use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSession {
    key: String,
    user_agent: String,
}

// The relay's HTTP client is not a browser, so media requests say what they
// are. Vidzy serves its decoy manifest and junk segments to clients that claim
// a Chromium user agent without being Chromium: forwarding the WebView2 agent
// (Edge) broke Windows, while the WebKit agents of macOS and Linux passed.
// The gate token is not tied to the agent that obtained it.
fn relay_user_agent(version: &str) -> String {
    format!("HorusDesktop/{version}")
}

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 4096 && !key.chars().any(char::is_control)
}

fn is_vidzy_host(host: &str) -> bool {
    host == "vidzy.cc" || host.ends_with(".vidzy.cc")
        || host == "vidzy.org" || host.ends_with(".vidzy.org")
}

fn validate(embed: &str, referer: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(embed).map_err(|_| "Lecteur Vidzy invalide")?;
    let parent = url::Url::parse(referer).map_err(|_| "Référent Vidzy invalide")?;
    let embed_host = url.host_str().unwrap_or("");
    let parent_host = parent.host_str().unwrap_or("");
    if url.scheme() != "https" || !is_vidzy_host(embed_host) ||
        url.port().is_some() || !url.username().is_empty() || url.password().is_some() ||
        !regex::Regex::new(r"^/embed-[A-Za-z0-9]+\.html$").unwrap().is_match(url.path()) ||
        url.query().is_some() || url.fragment().is_some() ||
        parent.scheme() != "https" || !is_vidzy_host(parent_host) {
        return Err("Seuls les lecteurs HTTPS Vidzy sont autorisés".into());
    }
    Ok(url)
}

// Runs before the embed's own scripts. Like the Android validator, the session
// window only computes the gate token and never loads media: on Chromium
// webviews (WebView2) video.js would otherwise preload the stream for nothing.
const SESSION_SCRIPT: &str = r#"(() => {
  window.open = () => null;
  try {
    Object.defineProperty(window, 'videojs', { get: () => undefined, set: () => {}, configurable: false });
  } catch (_) {}
  const media = (value) => {
    try {
      const path = new URL(String(value), location.href).pathname;
      return /^\/(hls2|v)\//.test(path) || /\.(m3u8|ts|m4s|mp4)$/i.test(path);
    } catch (_) { return false; }
  };
  const fetch = window.fetch;
  window.fetch = function (input, init) {
    const url = input && typeof input === 'object' && 'url' in input ? input.url : input;
    return media(url) ? Promise.reject(new TypeError('media blocked')) : fetch.call(this, input, init);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return open.call(this, method, media(url) ? 'data:text/plain,' : url, ...rest);
  };
  const source = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    get() { return source.get.call(this); },
    set(value) { if (!media(value)) source.set.call(this, value); },
  });
  HTMLMediaElement.prototype.play = () => Promise.resolve();
})();"#;

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
        .initialization_script(SESSION_SCRIPT)
        .on_navigation(move |target| target == &allowed)
        .build().map_err(|_| "Impossible d’ouvrir la session Vidzy")?;
    let window = SessionWindow(browser);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    while tokio::time::Instant::now() < deadline {
        let (send, receive) = tokio::sync::oneshot::channel();
        // The callback API is Fn, so protect the single-use sender.
        let sender = std::sync::Mutex::new(Some(send));
        window.0.eval_with_callback(
            "typeof window.__vzgk === 'string' ? window.__vzgk : ''",
            move |value| { if let Some(send) = sender.lock().unwrap().take() { let _ = send.send(value); } }
        ).map_err(|_| "Impossible de lire la validation Vidzy")?;
        if let Ok(Ok(value)) = tokio::time::timeout(Duration::from_secs(1), receive).await {
            if let Ok(key) = serde_json::from_str::<String>(&value) {
                if valid_key(&key) {
                    let version = app.package_info().version.to_string();
                    return Ok(BrowserSession { key, user_agent: relay_user_agent(&version) });
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
    fn relay_names_itself_instead_of_a_browser() {
        assert_eq!(relay_user_agent("0.1.17"), "HorusDesktop/0.1.17");
        assert!(!relay_user_agent("0.1.17").contains("Chrome"));
        assert!(valid_key("abc.1794841264.86400"));
        assert!(!valid_key("") && !valid_key("a\nb") && !valid_key(&"a".repeat(4097)));
    }

    #[test]
    fn only_vidzy_embeds_can_open_a_session() {
        assert!(validate("https://vidzy.cc/embed-abc123.html", "https://vidzy.org/movie/550/vf").is_ok());
        // Subdomains of both vidzy.cc and vidzy.org are accepted.
        assert!(validate("https://v6.vidzy.cc/embed-abc123.html", "https://vidzy.org/movie/550/vf").is_ok());
        assert!(validate("https://vidzy.cc/embed-abc123.html", "https://u14.vidzy.org/movie/550/vf").is_ok());
        assert!(validate("https://v6.vidzy.org/embed-abc123.html", "https://vidzy.org/movie/550/vf").is_ok());
        for embed in ["http://vidzy.cc/embed-abc.html", "https://evil.test/embed-abc.html", "https://vidzy.cc@evil.test/embed-abc.html", "https://vidzy.cc:8443/embed-abc.html", "https://vidzy.cc/embed-abc.html?redirect=x", "https://vidzy.cc/other", "https://vidzy.cc.evil.test/embed-abc.html", "https://vidzy.org.evil.test/embed-abc.html", "https://evilvidzy.cc/embed-abc.html", "https://evilvidzy.org/embed-abc.html"] {
            assert!(validate(embed, "https://vidzy.org/movie/550/vf").is_err());
        }
    }
}
