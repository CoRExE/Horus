import type { Episode, SearchResult, Stream } from "@horus/core";
import type { Playback } from "../components/Player";
import type { Device, OfflineMedia } from "../services/native";
import type { useLibrary } from "../store/library";

export type Section =
  | "catalogue"
  | "anime"
  | "wishlist"
  | "history"
  | "downloads"
  | "settings";
export type LibraryState = ReturnType<typeof useLibrary.getState>;
export interface MediaDetails {
  media: SearchResult;
  episodes: Episode[];
  episode?: Episode;
  streams: Stream[];
}
export interface Playing extends Playback {
  media: SearchResult;
  episode: Episode;
  stream: Stream;
  episodes: Episode[];
  alternatives: Stream[];
  offlineId?: string;
}
export interface RuntimeInfo {
  platform: string;
  architecture?: string;
  ffmpeg: boolean;
}
export interface DownloadProgress {
  id: string;
  title: string;
  bytes: number;
  phase?: "preparing" | "downloading" | "finalizing" | "cancelling";
  bytesPerSecond?: number;
  percent?: number;
  etaSeconds?: number;
}
export interface CastTarget {
  details: MediaDetails;
  stream: Stream;
  offlineId?: string;
}
export type StartPlayback = (
  details: MediaDetails,
  stream: Stream,
  device?: Device,
  offlineId?: string,
) => Promise<void>;
export type DownloadMedia = (
  details: MediaDetails,
  stream: Stream,
) => Promise<OfflineMedia | undefined>;
