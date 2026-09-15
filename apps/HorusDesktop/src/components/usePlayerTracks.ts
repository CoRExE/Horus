import { useEffect, useRef, useState, type RefObject } from "react";
import type Hls from "hls.js";

interface AudioTrack {
  label: string;
  language: string;
  enabled: boolean;
}
interface AudioTrackList extends EventTarget {
  readonly length: number;
  [index: number]: AudioTrack;
}
type VideoWithTracks = HTMLVideoElement & { audioTracks?: AudioTrackList };
interface TrackOption {
  id: number;
  label: string;
}
const label = (name: string, language: string | undefined, index: number) =>
  [name, language && language !== name ? language : ""]
    .filter(Boolean)
    .join(" · ") || `Piste ${index + 1}`;

export function usePlayerTracks(
  video: RefObject<HTMLVideoElement | null>,
  source: object,
) {
  const engine = useRef<Hls | undefined>(undefined);
  const [audio, setAudio] = useState<TrackOption[]>([]);
  const [subtitles, setSubtitles] = useState<TrackOption[]>([]);
  const [audioId, setAudioId] = useState(-1);
  const [subtitleId, setSubtitleId] = useState(-1);
  const nativeSubtitles = () =>
    Array.from(video.current?.textTracks ?? [])
      .map((track, id) => ({ track, id }))
      .filter(
        ({ track }) => track.kind === "subtitles" || track.kind === "captions",
      );
  const sync = () => {
    const hls = engine.current;
    if (hls) {
      setAudio(
        (hls.audioTracks ?? []).map((track, id) => ({
          id,
          label: label(track.name, track.lang, id),
        })),
      );
      setSubtitles(
        (hls.subtitleTracks ?? []).map((track, id) => ({
          id,
          label: label(track.name, track.lang, id),
        })),
      );
      setAudioId(hls.audioTrack ?? -1);
      setSubtitleId(hls.subtitleDisplay ? hls.subtitleTrack : -1);
    } else {
      const tracks = Array.from(
        (video.current as VideoWithTracks | null)?.audioTracks ?? [],
      );
      setAudio(
        tracks.map((track, id) => ({
          id,
          label: label(track.label, track.language, id),
        })),
      );
      setAudioId(tracks.findIndex((track) => track.enabled));
      const text = nativeSubtitles();
      setSubtitles(
        text.map(({ track, id }) => ({
          id,
          label: label(track.label, track.language, id),
        })),
      );
      setSubtitleId(
        text.find(({ track }) => track.mode === "showing")?.id ?? -1,
      );
    }
  };
  const bindHls = (hls: Hls, eventsByName: typeof Hls.Events) => {
    engine.current = hls;
    const events = [
      eventsByName.MANIFEST_PARSED,
      eventsByName.AUDIO_TRACKS_UPDATED,
      eventsByName.AUDIO_TRACK_SWITCHED,
      eventsByName.SUBTITLE_TRACKS_UPDATED,
      eventsByName.SUBTITLE_TRACK_SWITCH,
    ];
    for (const event of events) hls.on(event, sync);
    sync();
    return () => {
      for (const event of events) hls.off(event, sync);
      if (engine.current === hls) {
        engine.current = undefined;
        setAudio([]);
        setSubtitles([]);
        setAudioId(-1);
        setSubtitleId(-1);
      }
    };
  };
  useEffect(() => {
    setAudio([]);
    setSubtitles([]);
    setAudioId(-1);
    setSubtitleId(-1);
    const element = video.current as VideoWithTracks | null;
    if (!element) return;
    const lists = [element.audioTracks, element.textTracks];
    for (const list of lists)
      for (const event of ["addtrack", "removetrack", "change"])
        list?.addEventListener?.(event, sync);
    element.addEventListener("loadedmetadata", sync);
    return () => {
      for (const list of lists)
        for (const event of ["addtrack", "removetrack", "change"])
          list?.removeEventListener?.(event, sync);
      element.removeEventListener("loadedmetadata", sync);
    };
  }, [source]);
  const chooseAudio = (id: number) => {
    if (!audio.some((track) => track.id === id)) return;
    if (engine.current) engine.current.audioTrack = id;
    else {
      const tracks = (video.current as VideoWithTracks | null)?.audioTracks;
      if (tracks)
        for (let index = 0; index < tracks.length; index++)
          tracks[index].enabled = index === id;
    }
    sync();
  };
  const chooseSubtitle = (id: number) => {
    if (id !== -1 && !subtitles.some((track) => track.id === id)) return;
    if (engine.current) {
      engine.current.subtitleTrack = id;
      engine.current.subtitleDisplay = id !== -1;
    } else
      for (const { track, id: index } of nativeSubtitles())
        track.mode = index === id ? "showing" : "disabled";
    sync();
  };
  return {
    audio,
    subtitles,
    audioId,
    subtitleId,
    chooseAudio,
    chooseSubtitle,
    bindHls,
  };
}
