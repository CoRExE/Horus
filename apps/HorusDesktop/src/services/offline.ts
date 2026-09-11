import type { Stream } from "@horus/core";
import type { MediaDetails as Details } from "../types/media";
import type { OfflineMedia } from "./native";
export const offlineDetails = (item: OfflineMedia): Details => ({
  media: item.metadata.media,
  episodes: [item.metadata.episode],
  episode: item.metadata.episode,
  streams: [],
});
export const offlineSource = (item: OfflineMedia): Stream => ({
  url: "",
  language: item.metadata.language,
  server: "Hors ligne",
  format: "file",
});
