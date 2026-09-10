use rust_cast::{
    channels::{
        connection::ConnectionChannel,
        heartbeat::HeartbeatChannel,
        media::{GenericMediaMetadata, Media, MediaChannel, Metadata, StatusEntry, StreamType},
        receiver::{CastDeviceApp, ReceiverChannel},
    },
    message_manager::MessageManager,
};
use rustls::{ClientConfig, ClientConnection, StreamOwned};
use serde::Serialize;
use std::{
    net::{Ipv4Addr, SocketAddr, TcpStream},
    sync::{Arc, Mutex},
    time::Duration,
};

type Transport = StreamOwned<ClientConnection, TcpStream>;
struct Connection {
    media: MediaChannel<'static, Transport>,
    receiver: ReceiverChannel<'static, Transport>,
    heartbeat: HeartbeatChannel<'static, Transport>,
    destination: String,
    session: i32,
    duration: f32,
}

#[derive(Default, Clone)]
pub struct CastSession(Arc<Mutex<Option<Connection>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    transport_state: String,
    position_seconds: f32,
    duration_seconds: f32,
    volume: Option<f32>,
    muted: Option<bool>,
}

impl Connection {
    fn status(&mut self, entry: StatusEntry) -> PlaybackStatus {
        self.session = entry.media_session_id;
        if let Some(duration) = entry.media.and_then(|m| m.duration) {
            self.duration = duration;
        }
        PlaybackStatus {
            transport_state: match entry.player_state.to_string().as_str() {
                "PLAYING" => "PLAYING",
                "PAUSED" => "PAUSED_PLAYBACK",
                "BUFFERING" => "TRANSITIONING",
                _ => "STOPPED",
            }
            .into(),
            position_seconds: entry.current_time.unwrap_or(0.0),
            duration_seconds: self.duration,
            volume: None,
            muted: None,
        }
    }
}

#[tauri::command]
pub async fn cast_load(
    ip: String,
    port: u16,
    url: String,
    content_type: String,
    title: String,
    state: tauri::State<'_, CastSession>,
) -> Result<PlaybackStatus, String> {
    crate::http_url(&url)?;
    let ip: Ipv4Addr = ip.parse().map_err(|_| "Adresse Chromecast invalide")?;
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        // Cast receivers use self-signed device certificates. This exception is
        // confined to the user-selected Cast socket; media HTTPS stays verified.
        let config = ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(rust_cast::NoCertificateVerification {}))
            .with_no_client_auth();
        let socket =
            TcpStream::connect_timeout(&SocketAddr::from((ip, port)), Duration::from_secs(5))
                .map_err(|e| e.to_string())?;
        socket
            .set_read_timeout(Some(Duration::from_secs(8)))
            .map_err(|e| e.to_string())?;
        socket
            .set_write_timeout(Some(Duration::from_secs(8)))
            .map_err(|e| e.to_string())?;
        let tls = ClientConnection::new(
            Arc::new(config),
            rustls::pki_types::ServerName::IpAddress(ip.into()),
        )
        .map_err(|e| e.to_string())?;
        let manager = Arc::new(MessageManager::new(StreamOwned::new(tls, socket)));
        let connection = ConnectionChannel::new("sender-0", manager.clone());
        let heartbeat = HeartbeatChannel::new("sender-0", "receiver-0", manager.clone());
        let receiver = ReceiverChannel::new("sender-0", "receiver-0", manager.clone());
        let media = MediaChannel::new("sender-0", manager);
        connection
            .connect("receiver-0")
            .map_err(|e| e.to_string())?;
        heartbeat.ping().map_err(|e| e.to_string())?;
        let app = receiver
            .launch_app(&CastDeviceApp::DefaultMediaReceiver)
            .map_err(|e| e.to_string())?;
        connection
            .connect(app.transport_id.clone())
            .map_err(|e| e.to_string())?;
        let status = media
            .load(
                app.transport_id.clone(),
                app.session_id,
                &Media {
                    content_id: url,
                    content_type,
                    stream_type: StreamType::Buffered,
                    duration: None,
                    metadata: Some(Metadata::Generic(GenericMediaMetadata {
                        title: Some(title),
                        ..Default::default()
                    })),
                },
            )
            .map_err(|e| e.to_string())?;
        let entry = status
            .entries
            .into_iter()
            .next()
            .ok_or("Chromecast n’a pas chargé le média")?;
        let mut client = Connection {
            media,
            receiver,
            heartbeat,
            destination: app.transport_id,
            session: entry.media_session_id,
            duration: 0.0,
        };
        let status = client.status(entry);
        *guard = Some(client);
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cast_control(
    action: String,
    value: Option<f32>,
    state: tauri::State<'_, CastSession>,
) -> Result<PlaybackStatus, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        let client = guard.as_mut().ok_or("Aucune session Chromecast")?;
        // Polling also answers receiver heartbeats, including while playback is paused.
        client.heartbeat.pong().map_err(|e| e.to_string())?;
        let destination = client.destination.clone();
        let entry = match action.as_str() {
            "play" => client.media.play(destination, client.session),
            "pause" => client.media.pause(destination, client.session),
            "stop" => client.media.stop(destination, client.session),
            "seek" => client.media.seek(
                destination,
                client.session,
                Some(value.filter(|v| v.is_finite()).unwrap_or(0.0).max(0.0)),
                None,
            ),
            "status" | "volume" | "mute" => {
                if action == "volume" {
                    client
                        .receiver
                        .set_volume(
                            value
                                .filter(|v| v.is_finite())
                                .unwrap_or(50.0)
                                .clamp(0.0, 100.0)
                                / 100.0,
                        )
                        .map_err(|e| e.to_string())?;
                }
                if action == "mute" {
                    client
                        .receiver
                        .set_volume(value == Some(1.0))
                        .map_err(|e| e.to_string())?;
                }
                Ok(client
                    .media
                    .get_status(destination, Some(client.session))
                    .map_err(|e| e.to_string())?
                    .entries
                    .into_iter()
                    .next()
                    .ok_or("Lecture terminée")?)
            }
            _ => return Err("Commande Chromecast inconnue".into()),
        }
        .map_err(|e| e.to_string())?;
        let mut result = client.status(entry);
        if let Ok(status) = client.receiver.get_status() {
            result.volume = status.volume.level.map(|v| v * 100.0);
            result.muted = status.volume.muted;
        }
        if action == "stop" {
            *guard = None;
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
