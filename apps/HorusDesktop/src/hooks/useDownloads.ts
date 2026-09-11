import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  formatRemoteMediaTitle,
  normalizeStreamLanguage,
  type Stream,
} from "@horus/core";
import {
  errorMessage,
  invoke,
  isTauri,
  sourcePayload,
  type OfflineMedia,
} from "../services/native";
import type { MediaDetails as Details, DownloadProgress } from "../types/media";

export function useDownloads({
  setError,
  setNotice,
  setDetailError,
  setDeviceError,
}: {
  setError: (error: string) => void;
  setNotice: (notice: string) => void;
  setDetailError: (error: string) => void;
  setDeviceError: (error: string) => void;
}) {
  const [offline, setOffline] = useState<OfflineMedia[]>([]);
  const [download, setDownload] = useState<DownloadProgress>();
  const downloadRef = useRef<string | undefined>(undefined);
  async function refreshOffline() {
    if (isTauri()) setOffline(await invoke<OfflineMedia[]>("list_downloads"));
  }

  useEffect(() => {
    if (!isTauri()) return;
    void refreshOffline().catch((error) => setError(errorMessage(error)));
    const listener = listen<{ id: string; bytes: number }>(
      "download-progress",
      (event) =>
        setDownload((current) =>
          current?.id === event.payload.id
            ? { ...current, bytes: event.payload.bytes }
            : current,
        ),
    );
    return () => {
      void listener.then((unlisten) => unlisten());
    };
  }, []);
  const downloadMedia = async (
    current: Details,
    stream: Stream,
  ): Promise<OfflineMedia | undefined> => {
    if (!current.episode || downloadRef.current) return;
    const id = crypto.randomUUID();
    const metadata = {
      media: current.media,
      episode: current.episode,
      title: formatRemoteMediaTitle(current.media, current.episode),
      language: normalizeStreamLanguage(stream.language),
    };
    downloadRef.current = id;
    setDownload({ id, title: metadata.title, bytes: 0 });
    setError("");
    setDetailError("");
    try {
      const result = await invoke<OfflineMedia>("download_media", {
        id,
        source: sourcePayload(stream),
        metadata,
      });
      await refreshOffline();
      setNotice("Téléchargement terminé. Le média est disponible hors ligne.");
      return result;
    } catch (error) {
      const message = errorMessage(error);
      setError(message);
      setDetailError(message);
      setDeviceError(message);
    } finally {
      downloadRef.current = undefined;
      setDownload(undefined);
    }
  };

  const cancelDownload = async () => {
    if (download) await invoke("cancel_download", { id: download.id });
  };
  const removeDownload = (id: string) =>
    invoke("remove_download", { id })
      .then(refreshOffline)
      .catch((error) => setError(errorMessage(error)));
  return {
    offline,
    download,
    refreshOffline,
    downloadMedia,
    cancelDownload,
    removeDownload,
  };
}
