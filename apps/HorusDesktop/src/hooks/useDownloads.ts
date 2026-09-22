import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  formatRemoteMediaTitle,
  normalizeStreamLanguage,
  type Stream,
  type Episode,
} from "@horus/core";
import {
  errorMessage,
  invoke,
  isTauri,
  sourcePayload,
  type OfflineMedia,
  type DownloadMetadata,
} from "../services/native";
import { providerFor } from "../services/providers";
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
  source?: ReturnType<typeof sourcePayload>;
  resolveStream?: () => Promise<Stream>;
  cancelled?: boolean;
  nativeStarted?: boolean;
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
      const source = entry.source ?? sourcePayload(await entry.resolveStream!());
      if (!mounted.current || entry.cancelled) return;
      entry.nativeStarted = true;
      result = await invoke<OfflineMedia>("download_media", {
        id: entry.id,
        source,
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
      if (mounted.current && !entry.cancelled) {
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
  const matchesBatch = (entry: Entry, current: Details, stream: Stream) =>
    !!entry.resolveStream && entry.metadata.media.providerId === current.media.providerId &&
    entry.metadata.media.id === current.media.id && entry.metadata.episode.id === current.episode?.id &&
    entry.metadata.language === normalizeStreamLanguage(stream.language);
  const isDownloading = (current: Details, stream?: Stream) => {
    if (!stream) return false;
    const key = keyFor(current, stream);
    return (
      [active.current, ...pending.current].some(entry => entry && (entry.key === key || matchesBatch(entry, current, stream)))
    );
  };
  const downloadMedia = (
    current: Details,
    stream: Stream,
  ): Promise<OfflineMedia | undefined> => {
    if (!current.episode || !mounted.current) return Promise.resolve(undefined);
    const key = keyFor(current, stream);
    const existing = [active.current, ...pending.current].find(
      (e) => e && (e.key === key || matchesBatch(e, current, stream)),
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
  const downloadEpisodes = (current: Details, episodes: Episode[], language: string, preferredServer?: string) => {
    if (!mounted.current) return;
    const targetLanguage = normalizeStreamLanguage(language);
    let added = 0;
    for (const episode of episodes) {
      const matches = (metadata: DownloadMetadata) =>
        metadata.media.providerId === current.media.providerId &&
        metadata.media.id === current.media.id && metadata.episode.id === episode.id &&
        normalizeStreamLanguage(metadata.language) === targetLanguage;
      if (offline.some(item => item.available !== false && matches(item.metadata)) ||
          [active.current, ...pending.current].some(entry => entry && matches(entry.metadata))) continue;
      let resolve!: Entry["resolve"];
      const promise = new Promise<OfflineMedia | undefined>(done => { resolve = done; });
      pending.current.push({
        id: crypto.randomUUID(),
        key: JSON.stringify([current.media.providerId, current.media.id, episode.id, targetLanguage, "batch"]),
        promise, resolve,
        metadata: { media: current.media, episode, title: formatRemoteMediaTitle(current.media, episode), language: targetLanguage },
        resolveStream: async () => {
          // Resolve at the head of the queue so expiring URLs are not cached for the entire season.
          const streams = await providerFor(current.media).getStreams(episode.id, episode);
          const candidates = streams.filter(stream => normalizeStreamLanguage(stream.language) === targetLanguage);
          const stream = candidates.find(stream => stream.server.trim().toLowerCase() === preferredServer?.trim().toLowerCase()) ?? candidates[0];
          if (!stream) throw new Error(`Aucun serveur disponible en ${targetLanguage}.`);
          return stream;
        },
      });
      added++;
    }
    setNotice(added ? `${added} épisode(s) ajouté(s) à la file en ${targetLanguage}.` : "Ces épisodes sont déjà téléchargés ou dans la file.");
    syncQueue();
    void processNext();
  };
  const removeQueued = (id: string) => {
    const entry = pending.current.find((e) => e.id === id);
    pending.current = pending.current.filter((e) => e.id !== id);
    entry?.resolve();
    syncQueue();
  };
  const cancelDownload = async () => {
    const entry = active.current;
    if (!entry) return;
    const id = entry.id;
    setDownload((current) =>
      current?.id === id ? { ...current, phase: "cancelling" } : current,
    );
    if (!entry.nativeStarted) {
      entry.cancelled = true;
      return; // The resolver will finish before the next entry starts.
    }
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
    downloadEpisodes,
    cancelDownload,
    removeDownload,
  };
}
