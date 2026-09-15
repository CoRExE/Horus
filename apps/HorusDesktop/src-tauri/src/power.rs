use std::sync::mpsc::{self, Sender};
use tokio::sync::oneshot;

struct Request {
    active: bool,
    shutdown: bool,
    reply: Option<oneshot::Sender<Result<(), String>>>,
}

pub struct PlaybackPower {
    sender: Sender<Request>,
}

impl PlaybackPower {
    pub fn new() -> std::io::Result<Self> {
        let (sender, receiver) = mpsc::channel::<Request>();
        // Windows execution state belongs to a thread. Create AND release the
        // guard on this worker, never on an arbitrary async-runtime thread.
        std::thread::Builder::new()
            .name("horus-playback-power".into())
            .spawn(move || {
                let mut guard = None;
                for request in receiver {
                    let result = if request.active && guard.is_none() {
                        keepawake::Builder::default()
                            .display(true)
                            .idle(true)
                            .sleep(false)
                            .reason("Lecture vidéo Horus")
                            .app_name("Horus Desktop")
                            .app_reverse_domain("io.github.corexe.horus.desktop")
                            .create()
                            .map(|lock| guard = Some(lock))
                            .map_err(|error| error.to_string())
                    } else if !request.active {
                        // A desktop session may vanish while releasing its D-Bus
                        // cookie. Keep the worker alive if the backend panics.
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            drop(guard.take());
                        }))
                        .map_err(|_| "Impossible de libérer le maintien éveillé".into())
                    } else {
                        Ok(())
                    };
                    if let Some(reply) = request.reply {
                        let _ = reply.send(result);
                    }
                    if request.shutdown {
                        break;
                    }
                }
            })?;
        Ok(Self { sender })
    }

    pub fn shutdown(&self) {
        let _ = self.sender.send(Request {
            active: false,
            shutdown: true,
            reply: None,
        });
    }
}

#[tauri::command]
pub async fn set_playback_awake(
    active: bool,
    state: tauri::State<'_, PlaybackPower>,
) -> Result<(), String> {
    let (reply, result) = oneshot::channel();
    state
        .sender
        .send(Request {
            active,
            shutdown: false,
            reply: Some(reply),
        })
        .map_err(|_| "Gestion de la veille indisponible")?;
    result.await.map_err(|_| "Gestion de la veille arrêtée")?
}
