import { useRef, useState } from "react";
import {
  formatRemoteMediaTitle,
  inferStreamFormat,
  normalizeStreamLanguage,
  type Stream,
} from "@horus/core";
import { providerFor } from "../services/providers";
import { controlDevice, loadDevice } from "../services/devices";
import {
  errorMessage,
  invoke,
  releaseStream,
  sourcePayload,
  type Device,
  type PreparedStream,
} from "../services/native";
import { useLibrary, mediaKey } from "../store/library";
import type { MediaDetails as Details, Playing } from "../types/media";
import type { PlayerHandle } from "../components/Player";

export function usePlayback({
  setError,
  setNotice,
  setDetailError,
  setDeviceError,
  closeDetails,
  closeCast,
  showEpisode,
}: {
  setError: (error: string) => void;
  setNotice: (notice: string) => void;
  setDetailError: (error: string) => void;
  setDeviceError: (error: string) => void;
  closeDetails: () => void;
  closeCast: () => void;
  showEpisode: (details: Details, language: string) => void;
}) {
  const [playing, setPlaying] = useState<Playing>();
  const playingRef = useRef<Playing | undefined>(undefined);
  const playerRef = useRef<PlayerHandle>(null);
  const [starting, setStarting] = useState(false);
  const playbackGeneration = useRef(0);
  const lastProgressSave = useRef(0);
  const changingServer = useRef(false);
  const stopPlayback = async () => {
    ++playbackGeneration.current;
    const current = playingRef.current;
    // Sauver avant d'invalider la session, y compris quand une autre lecture
    // remplace le lecteur sans passer par son bouton de fermeture.
    if (current) playerRef.current?.flushProgress();
    playingRef.current = undefined;
    setPlaying(undefined);
    if (current) {
      try {
        if (current.device) await controlDevice(current.device, "stop");
      } catch (error) {
        setError(`Arrêt TV non confirmé : ${errorMessage(error)}`);
      } finally {
        await releaseStream(current.prepared.id);
      }
    }
  };

  const startPlayback = async (
    current: Details,
    stream: Stream,
    device?: Device,
    offlineId?: string,
  ) => {
    if (!current.episode) return;
    setStarting(true);
    setError("");
    setDetailError("");
    setDeviceError("");
    let prepared: PreparedStream | undefined;
    try {
      await stopPlayback();
      const generation = ++playbackGeneration.current;
      const format = offlineId ? "file" : inferStreamFormat(stream);
      prepared = offlineId
        ? await invoke<PreparedStream>("offline_stream", {
            id: offlineId,
            receiver: device?.ip ?? null,
          })
        : await invoke<PreparedStream>("prepare_stream", {
            source: sourcePayload(stream),
            format,
            receiver: device?.ip ?? null,
            bridge: device?.kind === "dlna" && format === "hls",
          });
      if (generation !== playbackGeneration.current) {
        await releaseStream(prepared.id);
        return;
      }
      const title = formatRemoteMediaTitle(current.media, current.episode);
      if (device) await loadDevice(device, prepared, title);
      if (generation !== playbackGeneration.current) {
        if (device) await controlDevice(device, "stop");
        await releaseStream(prepared.id);
        return;
      }
      const previous = useLibrary
        .getState()
        .history.find(
          (item) =>
            mediaKey(item.media) === mediaKey(current.media) &&
            item.episode.id === current.episode!.id,
        );
      if (
        device &&
        previous &&
        previous.position > 0 &&
        prepared.contentType !== "video/mp2t"
      ) {
        await controlDevice(device, "seek", previous.position).catch(() =>
          setNotice(
            "La reprise à la position précédente n’est pas disponible sur ce téléviseur.",
          ),
        );
      }
      const playback: Playing = {
        prepared,
        title,
        language: normalizeStreamLanguage(stream.language),
        server: offlineId ? undefined : stream.server,
        format,
        device,
        resumeAt: previous?.position ?? 0,
        media: current.media,
        episode: current.episode,
        stream,
        episodes: current.episodes,
        alternatives: current.streams,
        offlineId,
      };
      playingRef.current = playback;
      setPlaying(playback);
      lastProgressSave.current = 0;
      useLibrary.getState().remember({
        media: current.media,
        episode: current.episode,
        position: previous?.position ?? 0,
        duration: previous?.duration ?? 0,
      });
      closeDetails();
      closeCast();
    } catch (error) {
      if (prepared) await releaseStream(prepared.id).catch(() => {});
      const message = errorMessage(error);
      setError(message);
      setDetailError(message);
      setDeviceError(message);
    } finally {
      setStarting(false);
    }
  };

  const playNext = async () => {
    const current = playingRef.current;
    if (!current || starting) return;
    const next =
      current.episodes[
        current.episodes.findIndex((item) => item.id === current.episode.id) + 1
      ];
    if (!next) return;
    setStarting(true);
    try {
      const streams = await providerFor(current.media).getStreams(next.id, next);
      if (playingRef.current !== current) return;
      const sameLanguage = streams.filter(
        (item) => normalizeStreamLanguage(item.language) === current.language,
      );
      const sameServer =
        current.media.type === "anime"
          ? sameLanguage.filter(
              (item) => item.server.trim().toLowerCase() ===
                current.stream.server.trim().toLowerCase(),
            )
          : [];
      const stream =
        sameServer.find((item) => item.quality === current.stream.quality) ??
        sameServer[0] ?? sameLanguage[0];
      if (!stream) {
        await stopPlayback();
        showEpisode(
          {
            media: current.media,
            episodes: current.episodes,
            episode: next,
            streams,
          },
          current.language,
        );
        return;
      }
      await startPlayback(
        {
          media: current.media,
          episodes: current.episodes,
          episode: next,
          streams,
        },
        stream,
        current.device,
      );
      if (
        current.media.type === "anime" && sameServer.length === 0 &&
        playingRef.current?.episode.id === next.id
      ) {
        setNotice(
          `Le serveur ${current.stream.server} n’est pas disponible pour cet épisode. Lecture sur ${stream.server}, en ${current.language}.`,
        );
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  const progress = (position: number, duration: number, flush = false) => {
    if (
      !playing ||
      playingRef.current !== playing ||
      (!flush && Date.now() - lastProgressSave.current < 5000)
    )
      return;
    lastProgressSave.current = Date.now();
    useLibrary.getState().remember({
      media: playing.media,
      episode: playing.episode,
      position,
      duration,
    });
  };

  const changeSource = async (stream: Stream) => {
    const current = playingRef.current;
    if (
      !current || current.offlineId || starting || changingServer.current ||
      stream === current.stream || !current.alternatives.includes(stream)
    ) return;
    changingServer.current = true;
    try {
      await startPlayback(
        {
          media: current.media,
          episodes: current.episodes,
          episode: current.episode,
          streams: current.alternatives,
        },
        stream,
        current.device,
      );
    } finally {
      changingServer.current = false;
    }
  };

  const changeServer = async (stream: Stream) => {
    if (normalizeStreamLanguage(stream.language) !== playingRef.current?.language) return;
    await changeSource(stream);
  };

  const changeLanguage = async (language: string) => {
    const current = playingRef.current;
    const targetLanguage = normalizeStreamLanguage(language);
    if (!current || current.offlineId || targetLanguage === current.language) return;
    const candidates = current.alternatives.filter(
      stream => normalizeStreamLanguage(stream.language) === targetLanguage,
    );
    const sameServer = candidates.filter(
      stream => stream.server.trim().toLowerCase() === current.stream.server.trim().toLowerCase(),
    );
    const stream = sameServer.find(stream => stream.quality === current.stream.quality)
      ?? sameServer[0] ?? candidates[0];
    if (stream) await changeSource(stream);
  };

  const retryPlayback = async () => {
    if (!playing || playing.offlineId) return;
    const alternatives = playing.alternatives.filter(
      (item) => normalizeStreamLanguage(item.language) === playing.language,
    );
    const next = alternatives[alternatives.indexOf(playing.stream) + 1];
    if (next) await changeServer(next);
    else setError("Aucun autre serveur disponible dans cette langue.");
  };
  const nextEpisode =
    playing &&
    !playing.offlineId &&
    playing.episodes[
      playing.episodes.findIndex((item) => item.id === playing.episode.id) + 1
    ];

  return {
    playerRef,
    playing,
    starting,
    startPlayback,
    stopPlayback,
    playNext,
    retryPlayback,
    changeServer,
    changeLanguage,
    progress,
    nextEpisode,
  };
}
