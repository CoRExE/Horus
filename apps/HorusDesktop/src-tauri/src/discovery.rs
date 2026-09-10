use serde::Serialize;
use std::{collections::HashSet, time::Duration};
use tokio::net::UdpSocket;

#[tauri::command]
pub async fn discover_dlna() -> Result<Vec<String>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;
    let request = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 3\r\nST: urn:schemas-upnp-org:service:AVTransport:1\r\n\r\n";
    for _ in 0..2 {
        socket
            .send_to(request.as_bytes(), "239.255.255.250:1900")
            .await
            .map_err(|e| e.to_string())?;
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let mut locations = HashSet::new();
    let mut buffer = [0; 8192];
    while let Ok(Ok((length, _))) =
        tokio::time::timeout_at(deadline, socket.recv_from(&mut buffer)).await
    {
        if let Some(location) = parse_location(&String::from_utf8_lossy(&buffer[..length])) {
            locations.insert(location);
        }
        if locations.len() >= 100 {
            break;
        }
    }
    Ok(locations.into_iter().collect())
}

fn parse_location(packet: &str) -> Option<String> {
    packet
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(key, _)| key.eq_ignore_ascii_case("location"))
        .and_then(|(_, value)| crate::http_url(value.trim()).ok())
        .map(|url| url.to_string())
}

#[derive(Serialize)]
pub struct CastDevice {
    id: String,
    name: String,
    ip: String,
    port: u16,
    kind: String,
}

#[tauri::command]
pub async fn discover_cast() -> Result<Vec<CastDevice>, String> {
    tokio::task::spawn_blocking(|| {
        let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
        let receiver = daemon
            .browse("_googlecast._tcp.local.")
            .map_err(|e| e.to_string())?;
        let start = std::time::Instant::now();
        let mut devices = Vec::new();
        while start.elapsed() < Duration::from_secs(5) {
            if let Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) =
                receiver.recv_timeout(Duration::from_millis(250))
            {
                if let Some(ip) = info.addresses.iter().find(|ip| ip.is_ipv4()) {
                    if !devices.iter().any(|d: &CastDevice| d.id == info.fullname) {
                        devices.push(CastDevice {
                            id: info.fullname.clone(),
                            name: info
                                .txt_properties
                                .get_property_val_str("fn")
                                .unwrap_or(&info.host)
                                .into(),
                            ip: ip.to_string(),
                            port: info.port,
                            kind: "cast".into(),
                        });
                    }
                }
            }
        }
        let _ = daemon.stop_browse("_googlecast._tcp.local.");
        let _ = daemon.shutdown();
        Ok(devices)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_case_insensitive_ssdp_locations_and_rejects_other_schemes() {
        assert_eq!(
            parse_location("HTTP/1.1 200 OK\r\nLoCaTiOn: http://192.168.1.4:8000/device.xml\r\n"),
            Some("http://192.168.1.4:8000/device.xml".into())
        );
        assert!(parse_location("LOCATION: file:///tmp/test").is_none());
    }
}
