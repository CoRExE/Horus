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
  type DownloadMetadata,
} from "../services/native";
import type { MediaDetails as Details, DownloadProgress } from "../types/media";

const keyFor = (current: Details, stream: Stream) =>
  JSON.stringify([
    current.media.providerId,
    current.media.id,
    current.episode?.id,
    normalizeStreamLanguage(stream.language),
    stream.url,
  ]);
interface Entry {
  id: string;
  key: string;
  source: ReturnType<typeof sourcePayload>;
  metadata: DownloadMetadata;
  promise: Promise<OfflineMedia | undefined>;
  resolve: (result?: OfflineMedia) => void;
}

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
  const [queue, setQueue] = useState<DownloadProgress[]>([]);
  const active = useRef<Entry | undefined>(undefined);
  const pending = useRef<Entry[]>([]);
  const mounted = useRef(true);
  const listingGeneration = useRef(0);
  const syncQueue = () =>
    setQueue(
      pending.current.map((e) => ({
        id: e.id,
        title: e.metadata.title,
        bytes: 0,
      })),
    );
  async function refreshOffline() {
    if (isTauri()) {
      const generation = ++listingGeneration.current;
      const items = await invoke<OfflineMedia[]>("list_downloads");
      if (mounted.current && generation === listingGeneration.current)
        setOffline(items);
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (!isTauri()) return;
    void refreshOffline().catch((error) => {
      if (mounted.current) setError(errorMessage(error));
    });
    const listener = listen<Omit<DownloadProgress, "title">>(
      "download-progress",
      (event) => {
        if (!mounted.current) return;
        setDownload((current) =>
          current?.id === event.payload.id
            ? {
                ...current,
                ...event.payload,
                phase:
                  current.phase === "cancelling"
                    ? "cancelling"
                    : (event.payload.phase ?? "downloading"),
              }
            : current,
        );
      },
    );
    void listener.catch((error) => {
      if (mounted.current) setError(errorMessage(error));
    });
    return () => {
      mounted.current = false;
      pending.current.splice(0).forEach((entry) => entry.resolve());
      if (active.current) {
        active.current.resolve();
        void invoke("cancel_download", { id: active.current.id }).catch(
          () => {},
        );
      }
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const processNext = async () => {
    if (active.current || !mounted.current) return;
    const entry = pending.current.shift();
    syncQueue();
    if (!entry) return;
    active.current = entry;
    setDownload({
      id: entry.id,
      title: entry.metadata.title,
      bytes: 0,
      phase: "preparing",
    });
    let result: OfflineMedia | undefined;
    try {
      result = await invoke<OfflineMedia>("download_media", {
        id: entry.id,
        source: entry.source,
        metadata: entry.metadata,
      });
      if (mounted.current) {
        setNotice(
          "Téléchargement terminé. Le média est disponible hors ligne.",
        );
        // A listing error must not turn a completed download into a failure for Cast.
        await refreshOffline().catch((error) => setError(errorMessage(error)));
      }
    } catch (error) {
      if (mounted.current) {
        const message = errorMessage(error);
        if (message === "Application en cours de fermeture") {
          pending.current.splice(0).forEach((entry) => entry.resolve());
          syncQueue();
        } else if (message.includes("Téléchargement annulé"))
          setNotice(message);
        else {
          setError(`${entry.metadata.title} : ${message}`);
          setDetailError(message);
          setDeviceError(message);
        }
      }
    } finally {
      active.current = undefined;
      if (mounted.current) {
        setDownload(undefined);
        entry.resolve(result);
        void processNext();
      }
    }
  };
  const isDownloading = (current: Details, stream?: Stream) => {
    if (!stream) return false;
    const key = keyFor(current, stream);
    return (
      active.current?.key === key || pending.current.some((e) => e.key === key)
    );
  };
  const downloadMedia = (
    current: Details,
    stream: Stream,
  ): Promise<OfflineMedia | undefined> => {
    if (!current.episode || !mounted.current) return Promise.resolve(undefined);
    const key = keyFor(current, stream);
    const existing = [active.current, ...pending.current].find(
      (e) => e?.key === key,
    );
    if (existing) return existing.promise;
    let resolve!: Entry["resolve"];
    const promise = new Promise<OfflineMedia | undefined>((done) => {
      resolve = done;
    });
    pending.current.push({
      id: crypto.randomUUID(),
      key,
      source: sourcePayload(stream),
      promise,
      resolve,
      metadata: {
        media: current.media,
        episode: current.episode,
        title: formatRemoteMediaTitle(current.media, current.episode),
        language: normalizeStreamLanguage(stream.language),
      },
    });
    setError("");
    setDetailError("");
    syncQueue();
    void processNext();
    return promise;
  };
  const removeQueued = (id: string) => {
    const entry = pending.current.find((e) => e.id === id);
    pending.current = pending.current.filter((e) => e.id !== id);
    entry?.resolve();
    syncQueue();
  };
  const cancelDownload = async () => {
    const id = active.current?.id;
    if (!id) return;
    setDownload((current) =>
      current?.id === id ? { ...current, phase: "cancelling" } : current,
    );
    try {
      await invoke("cancel_download", { id });
    } catch (error) {
      setDownload((current) =>
        current?.id === id ? { ...current, phase: "downloading" } : current,
      );
      setError(errorMessage(error));
    }
  };
  const removeDownload = (id: string) =>
    invoke("remove_download", { id })
      .then(refreshOffline)
      .catch((error) => setError(errorMessage(error)));
  return {
    offline,
    download,
    queue,
    isDownloading,
    removeQueued,
    refreshOffline,
    downloadMedia,
    cancelDownload,
    removeDownload,
  };
}
