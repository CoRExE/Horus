//! Small, dependency-free parsers: never expose FFmpeg stderr or source URLs.
use std::io;

pub fn write_error(error: io::Error) -> String {
    // ENOSPC is 28 on Unix; Windows uses ERROR_DISK_FULL / HANDLE_DISK_FULL.
    #[cfg(windows)]
    let full = matches!(error.raw_os_error(), Some(39 | 112));
    #[cfg(not(windows))]
    let full = error.raw_os_error() == Some(28);
    if full {
        "Espace disque insuffisant. Libérez de la place ou choisissez un autre dossier.".into()
    } else if error.kind() == io::ErrorKind::PermissionDenied {
        "Écriture refusée. Vérifiez les droits du dossier de destination.".into()
    } else {
        "Impossible d’écrire le téléchargement. Vérifiez le dossier, le disque et ses droits d’accès.".into()
    }
}

#[derive(Default)]
pub struct Diagnostics {
    tail: String,
    pub duration_seconds: Option<f64>,
    disk_full: bool,
    write_failed: bool,
}
impl Diagnostics {
    pub fn feed(&mut self, chunk: &[u8]) {
        let text = self.tail.clone() + &String::from_utf8_lossy(chunk);
        let lower = text.to_ascii_lowercase();
        self.disk_full |= lower.contains("no space left on device")
            || lower.contains("disk full")
            || lower.contains("not enough space on the disk");
        self.write_failed |= lower.contains("permission denied")
            || lower.contains("read-only file system")
            || lower.contains("input/output error")
            || lower.contains("error writing")
            || lower.contains("error opening output");
        if self.duration_seconds.is_none() {
            if let Some(rest) = text.split("Duration: ").nth(1) {
                if let Some((duration, _)) = rest.split_once(',') {
                    self.duration_seconds = parse_duration(duration);
                }
            }
        }
        // A short tail handles markers split across reads, with bounded memory.
        self.tail = text
            .chars()
            .rev()
            .take(256)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
    }
    pub fn message(&self) -> &'static str {
        if self.disk_full {
            "Espace disque insuffisant. Libérez de la place ou choisissez un autre dossier."
        } else if self.write_failed {
            "Écriture du téléchargement impossible. Vérifiez le disque et les droits du dossier de destination."
        } else {
            "Le téléchargement a échoué. Essayez un autre serveur ou vérifiez la compatibilité du flux avec MP4."
        }
    }
}
fn parse_duration(value: &str) -> Option<f64> {
    let parts: Vec<_> = value.trim().split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let seconds = parts[0].parse::<f64>().ok()? * 3600.0
        + parts[1].parse::<f64>().ok()? * 60.0
        + parts[2].parse::<f64>().ok()?;
    (seconds.is_finite() && seconds > 0.0).then_some(seconds)
}
#[derive(Default)]
pub struct Progress {
    pub bytes: u64,
    pub seconds: f64,
    speed: Option<f64>,
}
impl Progress {
    pub fn feed(&mut self, line: &str) -> bool {
        if let Some((key, value)) = line.split_once('=') {
            match key {
                "total_size" => {
                    if let Ok(bytes) = value.parse() {
                        self.bytes = bytes;
                    }
                }
                "out_time_us" => {
                    if let Ok(micros) = value.parse::<f64>() {
                        if micros.is_finite() {
                            self.seconds = (micros / 1_000_000.0).max(0.0);
                        }
                    }
                }
                "speed" => {
                    self.speed = value
                        .trim()
                        .trim_end_matches('x')
                        .parse::<f64>()
                        .ok()
                        .filter(|speed| speed.is_finite() && *speed > 0.0)
                }
                "progress" => return true,
                _ => {}
            }
        }
        false
    }
    pub fn estimate(&self, duration: Option<f64>) -> (Option<f64>, Option<f64>) {
        let Some(duration) = duration.filter(|d| d.is_finite() && *d > 0.0) else {
            return (None, None);
        };
        // Final MP4 faststart/copy still has to complete, so never announce 100% here.
        let percent = (self.seconds / duration * 100.0).clamp(0.0, 99.0);
        let eta = self
            .speed
            .filter(|_| self.seconds > 0.0 && self.seconds < duration)
            .map(|s| (duration - self.seconds) / s)
            .filter(|s| s.is_finite());
        (Some(percent), eta)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_are_bounded_sanitized_and_handle_split_errors() {
        let mut d = Diagnostics::default();
        d.feed(b"https://secret.invalid/token Duration: 00:10:00.00, start: 0\nNo space le");
        d.feed(b"ft on device");
        assert_eq!(d.duration_seconds, Some(600.0));
        assert!(d.message().contains("Espace disque"));
        assert!(!d.message().contains("secret"));
        d.feed(&vec![b'x'; 10000]);
        assert!(d.tail.len() <= 256);
        assert!(d.message().contains("Espace disque"));
    }
    #[test]
    fn unknown_duration_speed_and_invalid_progress_have_no_invented_eta() {
        let mut p = Progress::default();
        p.feed("total_size=1234");
        p.feed("out_time_us=300000000");
        p.feed("speed=2.0x");
        assert_eq!(p.estimate(None), (None, None));
        assert_eq!(p.estimate(Some(600.0)), (Some(50.0), Some(150.0)));
        p.feed("speed=N/A");
        assert_eq!(p.estimate(Some(600.0)).1, None);
        p.feed("total_size=N/A");
        assert_eq!(p.bytes, 1234);
        p.feed("out_time_us=NaN");
        assert_eq!(p.seconds, 300.0);
        p.feed("out_time_us=900000000");
        assert_eq!(p.estimate(Some(600.0)), (Some(99.0), None));
        assert!(p.feed("progress=end"));
        assert!(!p.feed("unknown=0"));
        assert!(parse_duration("N/A").is_none());
    }
    #[test]
    fn write_errors_are_actionable() {
        assert!(
            write_error(io::Error::from(io::ErrorKind::PermissionDenied))
                .contains("Écriture refusée")
        );
        #[cfg(not(windows))]
        assert!(write_error(io::Error::from_raw_os_error(28)).contains("Espace disque"));
        #[cfg(windows)]
        assert!(write_error(io::Error::from_raw_os_error(112)).contains("Espace disque"));
        let mut d = Diagnostics::default();
        d.feed(b"Permission denied");
        assert!(d.message().contains("droits"));
    }
}
