import { XMLParser } from "fast-xml-parser";
import { formatDlnaTime, parseDlnaTime } from "@horus/core";
import {
  invoke,
  nativeText,
  type Device,
  type PlaybackStatus,
  type PreparedStream,
} from "./native";

const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  ignoreAttributes: false,
});
export const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function parseDevice(xml: string, location: string): Device | undefined {
  const root = parser.parse(xml).root;
  const base = root?.URLBase || location;
  const visit = (node: any): Device | undefined => {
    const raw = node?.serviceList?.service;
    const services = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    const transport = services.find((item: any) =>
      item.serviceType?.includes(":AVTransport:"),
    );
    const rendering = services.find((item: any) =>
      item.serviceType?.includes(":RenderingControl:"),
    );
    if (transport?.controlURL)
      return {
        id: node.UDN || location,
        name: node.friendlyName || "Téléviseur DLNA",
        kind: "dlna",
        ip: new URL(location).hostname,
        controlUrl: new URL(transport.controlURL, base).href,
        renderingControlUrl: rendering?.controlURL
          ? new URL(rendering.controlURL, base).href
          : undefined,
      };
    const children = node?.deviceList?.device;
    for (const child of children
      ? Array.isArray(children)
        ? children
        : [children]
      : []) {
      const found = visit(child);
      if (found) return found;
    }
  };
  return visit(root?.device);
}

export async function discoverDevices(): Promise<{
  devices: Device[];
  warnings: string[];
}> {
  const results = await Promise.allSettled([
    invoke<Device[]>("discover_cast"),
    invoke<string[]>("discover_dlna").then(async (locations) => {
      const devices = await Promise.allSettled(
        locations.map(async (location) => {
          const response = await nativeText(location, { timeoutMs: 5000 });
          return parseDevice(response.body, location);
        }),
      );
      return devices.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      );
    }),
  ]);
  return {
    devices: [
      ...new Map(
        results
          .flatMap((result) =>
            result.status === "fulfilled" ? result.value : [],
          )
          .map((device) => [device.id, device]),
      ).values(),
    ],
    warnings: results.flatMap((result, i) =>
      result.status === "rejected"
        ? [`${i === 0 ? "Chromecast" : "DLNA"} : ${String(result.reason)}`]
        : [],
    ),
  };
}

async function soap(
  device: Device,
  action: string,
  args: Record<string, string> = {},
  rendering = false,
) {
  const service = rendering ? "RenderingControl" : "AVTransport";
  const controlUrl = rendering ? device.renderingControlUrl : device.controlUrl;
  if (!controlUrl)
    throw new Error("Cette commande n’est pas disponible sur ce téléviseur.");
  const urn = `urn:schemas-upnp-org:service:${service}:1`;
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${urn}"><InstanceID>0</InstanceID>${Object.entries(
    args,
  )
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join("")}</u:${action}></s:Body></s:Envelope>`;
  const response = await nativeText(controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPAction: `"${urn}#${action}"`,
    },
    body,
    timeoutMs: 5000,
  });
  if (response.status >= 400)
    throw new Error(
      `Le téléviseur a refusé ${action} (HTTP ${response.status}).`,
    );
  return (
    parser.parse(response.body)?.Envelope?.Body?.[`${action}Response`] ?? {}
  );
}

export async function loadDevice(
  device: Device,
  stream: PreparedStream,
  title: string,
): Promise<void> {
  if (device.kind === "cast") {
    await invoke("cast_load", {
      ip: device.ip,
      port: device.port ?? 8009,
      url: stream.url,
      contentType: stream.contentType,
      title,
    });
    return;
  }
  const metadata = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="1" parentID="0" restricted="1"><dc:title>${escapeXml(title)}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:${stream.contentType}:*">${escapeXml(stream.url)}</res></item></DIDL-Lite>`;
  await soap(device, "SetAVTransportURI", {
    CurrentURI: stream.url,
    CurrentURIMetaData: metadata,
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 700 + attempt * 300));
    try {
      await soap(device, "Play", { Speed: "1" });
      const state = await soap(device, "GetTransportInfo");
      if (state.CurrentTransportState === "PLAYING") return;
      lastError = new Error(
        `Le téléviseur reste en état ${state.CurrentTransportState}.`,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Le téléviseur n’a pas démarré la lecture.");
}

export async function deviceStatus(device: Device): Promise<PlaybackStatus> {
  if (device.kind === "cast")
    return invoke("cast_control", { action: "status", value: null });
  const [transport, position, volume, mute] = await Promise.allSettled([
    soap(device, "GetTransportInfo"),
    soap(device, "GetPositionInfo"),
    device.renderingControlUrl
      ? soap(device, "GetVolume", { Channel: "Master" }, true)
      : Promise.resolve({}),
    device.renderingControlUrl
      ? soap(device, "GetMute", { Channel: "Master" }, true)
      : Promise.resolve({}),
  ]);
  if (transport.status === "rejected" && position.status === "rejected")
    throw new Error("Le téléviseur ne répond plus.");
  return {
    transportState:
      transport.status === "fulfilled"
        ? transport.value.CurrentTransportState
        : "UNKNOWN",
    positionSeconds:
      position.status === "fulfilled"
        ? parseDlnaTime(position.value.RelTime)
        : 0,
    durationSeconds:
      position.status === "fulfilled"
        ? parseDlnaTime(position.value.TrackDuration)
        : 0,
    volume:
      volume.status === "fulfilled" && volume.value.CurrentVolume !== undefined
        ? Number(volume.value.CurrentVolume)
        : undefined,
    muted:
      mute.status === "fulfilled" && mute.value.CurrentMute !== undefined
        ? mute.value.CurrentMute === "1"
        : undefined,
  };
}

export async function controlDevice(
  device: Device,
  action: "play" | "pause" | "stop" | "seek" | "volume" | "mute",
  value?: number,
) {
  if (device.kind === "cast")
    return invoke("cast_control", { action, value: value ?? null });
  if (action === "seek") {
    try {
      return await soap(device, "Seek", {
        Unit: "REL_TIME",
        Target: formatDlnaTime(value ?? 0),
      });
    } catch {
      return soap(device, "Seek", {
        Unit: "ABS_TIME",
        Target: formatDlnaTime(value ?? 0),
      });
    }
  }
  if (action === "volume")
    return soap(
      device,
      "SetVolume",
      {
        Channel: "Master",
        DesiredVolume: String(
          Math.round(Math.max(0, Math.min(100, value ?? 50))),
        ),
      },
      true,
    );
  if (action === "mute")
    return soap(
      device,
      "SetMute",
      { Channel: "Master", DesiredMute: value ? "1" : "0" },
      true,
    );
  return soap(
    device,
    { play: "Play", pause: "Pause", stop: "Stop" }[action],
    action === "play" ? { Speed: "1" } : {},
  );
}
