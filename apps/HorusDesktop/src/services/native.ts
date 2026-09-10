import { invoke, isTauri } from "@tauri-apps/api/core";
import axios, { AxiosError, AxiosHeaders, type AxiosAdapter } from "axios";
import type { Stream } from "@horus/core";

export { invoke, isTauri };
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

interface TextResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}
export async function nativeText(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {},
) {
  if (!isTauri())
    throw new Error(
      "Cette fonction nécessite l’application de bureau. Lancez pnpm desktop.",
    );
  return invoke<TextResponse>("http_text", {
    url,
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    body: options.body ?? null,
    timeoutMs: options.timeoutMs ?? 15000,
  });
}

// Configure only the desktop Axios instance graph. Providers and their parsing
// remain shared with mobile; the native transport preserves Referer/User-Agent.
const nativeAdapter: AxiosAdapter = async (config) => {
  const headers = Object.fromEntries(
    Object.entries(config.headers.toJSON())
      .filter(([, v]) => v !== undefined && v !== null && v !== false)
      .map(([k, v]) => [k, String(v)]),
  );
  try {
    const result = await nativeText(axios.getUri(config), {
      method: config.method,
      headers,
      body: config.data,
      timeoutMs: config.timeout,
    });
    const response = {
      data: result.body,
      status: result.status,
      statusText: result.statusText,
      headers: new AxiosHeaders(result.headers),
      config,
    };
    if (config.validateStatus && !config.validateStatus(result.status))
      throw new AxiosError(
        `HTTP ${result.status}`,
        AxiosError.ERR_BAD_RESPONSE,
        config,
        undefined,
        response,
      );
    return response;
  } catch (error) {
    if (axios.isAxiosError(error)) throw error;
    throw new AxiosError(errorMessage(error), AxiosError.ERR_NETWORK, config);
  }
};
export function configureNativeHttp() {
  axios.defaults.adapter = nativeAdapter;
}

export interface PreparedStream {
  id: string;
  url: string;
  contentType: string;
}
export const sourcePayload = (stream: Stream) => ({
  url: stream.url,
  headers: stream.headers ?? {},
});
export const releaseStream = (id: string) => invoke("release_stream", { id });

export interface DownloadMetadata {
  media: import("@horus/core").SearchResult;
  episode: import("@horus/core").Episode;
  title: string;
  language: string;
}
export interface OfflineMedia {
  id: string;
  metadata: DownloadMetadata;
  sizeBytes: number;
  downloadedAt: number;
}
export interface PlaybackStatus {
  transportState: string;
  positionSeconds: number;
  durationSeconds: number;
  volume?: number;
  muted?: boolean;
}
export interface Device {
  id: string;
  kind: "dlna" | "cast";
  name: string;
  ip: string;
  port?: number;
  controlUrl?: string;
  renderingControlUrl?: string;
}
