import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import type Hls from "hls.js";
import { PlaybackRange } from "./PlaybackRange";
import { usePlayerFullscreen } from "./usePlayerFullscreen";
import { usePlayerShortcuts } from "./usePlayerShortcuts";
import { usePlayerTracks } from "./usePlayerTracks";
import { usePlaybackAwake } from "./usePlaybackAwake";
import { resumePosition } from "../services/playback";
import {
  Cast,
  Maximize,
  Minimize,
  Pause,
  Play,
  Square,
  SkipForward,
  X,
} from "lucide-react";
import { formatPlaybackTime, type Stream } from "@horus/core";
import { controlDevice, deviceStatus } from "../services/devices";
import {
  errorMessage,
  isTauri,
  type Device,
  type PlaybackStatus,
  type PreparedStream,
} from "../services/native";

export interface Playback {
  prepared: PreparedStream;
  title: string;
  language: string;
  server?: string;
  format: "hls" | "file";
  device?: Device;
  resumeAt: number;
}

export interface PlayerHandle {
  flushProgress: () => void;
}

export function Player({
  ref,
  playback,
  onStop,
  onProgress,
  onNext,
  onRetry,
  languageOptions,
  onLanguageChange,
  serverOptions,
  selectedServer,
  onServerChange,
  serverBusy = false,
}: {
  ref?: Ref<PlayerHandle>;
  playback: Playback;
  onStop: () => void;
  onProgress: (position: number, duration: number, flush?: boolean) => void;
  onNext?: () => void;
  onRetry?: () => void;
  languageOptions?: string[];
  onLanguageChange?: (language: string) => void;
  serverOptions?: Stream[];
  selectedServer?: Stream;
  onServerChange?: (stream: Stream) => void;
  serverBusy?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const { container, fullscreen, toggle, exit } = usePlayerFullscreen((error) =>
    setError(`Impossible de changer le plein écran : ${errorMessage(error)}`),
  );
  const tracks = usePlayerTracks(video, playback);
  const [status, setStatus] = useState<PlaybackStatus>();
  const remoteInactive = ["PAUSED_PLAYBACK", "STOPPED", "NO_MEDIA_PRESENT"].includes(
    status?.transportState ?? "",
  );
  const awakeWarning = usePlaybackAwake(
    video,
    playback,
    playback.device ? (remoteInactive ? "inactive" : "remote") : "local",
  );
  usePlayerShortcuts(video, !playback.device, toggle, (error) =>
    setError(errorMessage(error)),
  );
  const [busy, setBusy] = useState(false);
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;

  useEffect(() => {
    if (playback.device) void exit();
  }, [playback.device]);

  useEffect(() => {
    const saveProgress = progressRef.current;
    setError("");
    setStatus(undefined);
    if (playback.device) {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout>;
      const poll = async () => {
        try {
          const status = await deviceStatus(playback.device!);
          if (!cancelled) {
            setStatus(status);
            setError("");
            progressRef.current(status.positionSeconds, status.durationSeconds);
          }
        } catch (error) {
          if (!cancelled) setError(errorMessage(error));
        }
        if (!cancelled) timer = setTimeout(poll, 2000);
      };
      void poll();
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    const element = video.current!;
    let hls: Hls | undefined;
    let unbindTracks: (() => void) | undefined;
    let cancelled = false;
    const ready = () => {
      const position = resumePosition(playback.resumeAt, element.duration);
      if (position > 0) element.currentTime = position;
      void element
        .play()
        .catch(() => setError("Appuyez sur Lecture pour démarrer la vidéo."));
    };
    const failed = () =>
      setError("Ce flux ne peut pas être lu. Essayez un autre serveur.");
    element.addEventListener("loadedmetadata", ready, { once: true });
    element.addEventListener("error", failed);
    if (playback.format === "hls") {
      void import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            element.src = playback.prepared.url;
            return;
          }
          hls = new Hls();
          unbindTracks = tracks.bindHls(hls, Hls.Events);
          hls.loadSource(playback.prepared.url);
          hls.attachMedia(element);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              setError(
                "Le flux HLS est indisponible ou incompatible. Essayez un autre serveur.",
              );
              element.pause();
              unbindTracks?.();
              hls?.destroy();
            }
          });
        })
        .catch(() => {
          if (!cancelled) setError("Le lecteur HLS n’a pas pu être chargé.");
        });
    } else {
      element.src = playback.prepared.url;
    }
    return () => {
      cancelled = true;
      if (element.currentTime > 0)
        saveProgress(
          element.currentTime,
          Number.isFinite(element.duration) ? element.duration : 0,
          true,
        );
      element.removeEventListener("loadedmetadata", ready);
      element.removeEventListener("error", failed);
      unbindTracks?.();
      hls?.destroy();
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [playback]);

  const flushProgress = () => {
    const element = video.current;
    if (element && element.currentTime > 0)
      onProgress(
        element.currentTime,
        Number.isFinite(element.duration) ? element.duration : 0,
        true,
      );
    else if (playback.device && status && status.positionSeconds > 0)
      onProgress(status.positionSeconds, status.durationSeconds, true);
  };
  useImperativeHandle(ref, () => ({ flushProgress }));
  const stop = () => {
    flushProgress();
    onStop();
  };
  const next = () => {
    flushProgress();
    onNext?.();
  };

  const command = async (
    action: "play" | "pause" | "seek" | "volume",
    value?: number,
  ) => {
    if (!playback.device) return;
    setBusy(true);
    try {
      await controlDevice(playback.device, action, value);
      setStatus(await deviceStatus(playback.device));
      setError("");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const languagePicker = languageOptions && languageOptions.length > 1 && onLanguageChange ? (
    <label>
      Langue
      <select
        aria-label="Langue de lecture"
        value={playback.language}
        disabled={serverBusy}
        onChange={(event) => {
          const language = event.target.value;
          if (language !== playback.language && languageOptions.includes(language)) {
            flushProgress();
            onLanguageChange(language);
          }
        }}
      >
        {languageOptions.map((language) => (
          <option key={language} value={language}>{language}</option>
        ))}
      </select>
    </label>
  ) : null;

  const serverPicker = serverOptions?.length && onServerChange ? (
    <label>
      Serveur
      <select
        aria-label="Serveur de lecture"
        value={selectedServer ? serverOptions.indexOf(selectedServer) : -1}
        disabled={serverBusy || serverOptions.length < 2}
        onChange={(event) => {
          const stream = serverOptions[Number(event.target.value)];
          if (stream && stream !== selectedServer) {
            flushProgress();
            onServerChange(stream);
          }
        }}
      >
        {serverOptions.map((stream, index) => (
          <option key={index} value={index}>
            {stream.server}
            {stream.quality && !["auto", "unknown"].includes(stream.quality)
              ? ` · ${stream.quality}` : ""}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  return (
    <section className="player-panel" aria-label="Lecteur">
      <header>
        <div>
          <span className="eyebrow">
            {playback.device
              ? `DIFFUSION · ${playback.device.name}`
              : "LECTURE SUR CET ORDINATEUR"}
          </span>
          <h2>{playback.title}</h2>
          <span className="muted">
            {playback.language}
            {playback.server ? ` · Serveur : ${playback.server}` : ""}
          </span>
        </div>
        <div className="player-actions">
          {!playback.device && (
            <button
              className="icon-button"
              aria-label="Passer en plein écran"
              title="Plein écran (F ou double-clic sur la vidéo)"
              onClick={() => void toggle()}
            >
              <Maximize />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Arrêter et fermer le lecteur"
            onClick={stop}
          >
            <X />
          </button>
        </div>
      </header>
      {playback.device ? (
        <div className="remote-player">
          <Cast size={48} />
          {(languagePicker || serverPicker) && (
            <div className="track-picker">{languagePicker}{serverPicker}</div>
          )}
          <p>
            {status?.transportState === "PLAYING"
              ? "Lecture en cours sur votre téléviseur"
              : status?.transportState === "PAUSED_PLAYBACK"
                ? "Lecture en pause"
                : status?.transportState === "STOPPED"
                  ? "Lecture arrêtée"
                  : "Connexion au téléviseur…"}
          </p>
          <div className="transport">
            <button
              disabled={busy}
              onClick={() =>
                void command(
                  status?.transportState === "PLAYING" ? "pause" : "play",
                )
              }
              aria-label={
                status?.transportState === "PLAYING" ? "Pause" : "Lecture"
              }
            >
              {status?.transportState === "PLAYING" ? <Pause /> : <Play />}
            </button>
            <button onClick={stop} aria-label="Arrêter">
              <Square />
            </button>
          </div>
          <label className="range-label">
            {formatPlaybackTime(status?.positionSeconds ?? 0)} /{" "}
            {formatPlaybackTime(status?.durationSeconds ?? 0)}
            <PlaybackRange
              label="Position de lecture"
              max={status?.durationSeconds || 1}
              value={status?.positionSeconds ?? 0}
              disabled={
                busy ||
                !status?.durationSeconds ||
                playback.prepared.contentType === "video/mp2t"
              }
              onCommit={(value) => void command("seek", value)}
            />
          </label>
          {status?.volume !== undefined && (
            <label className="range-label">
              Volume
              <PlaybackRange
                label="Volume"
                max={100}
                value={status.volume}
                disabled={busy}
                onCommit={(value) => void command("volume", value)}
              />
            </label>
          )}
        </div>
      ) : (
        <div
          ref={container}
          className={`local-player${fullscreen ? " is-fullscreen" : ""}`}
        >
          <video
            ref={video}
            controls
            controlsList={isTauri() ? "nofullscreen" : undefined}
            playsInline
            onDoubleClick={() => void toggle()}
            onTimeUpdate={(event) => {
              const element = event.currentTarget;
              if (element.currentTime > 0)
                onProgress(
                  element.currentTime,
                  Number.isFinite(element.duration) ? element.duration : 0,
                );
            }}
            onPause={flushProgress}
            onSeeked={flushProgress}
            onEnded={next}
          />
          {(languagePicker || serverPicker || tracks.audio.length > 1 || tracks.subtitles.length > 0) && (
            <div className="track-picker">
              {languagePicker}
              {serverPicker}
              {tracks.audio.length > 1 && (
                <label>
                  Piste audio
                  <select
                    aria-label="Piste audio"
                    value={tracks.audioId}
                    onChange={(event) =>
                      tracks.chooseAudio(Number(event.target.value))
                    }
                  >
                    {tracks.audioId === -1 && (
                      <option value={-1} disabled>
                        Automatique
                      </option>
                    )}
                    {tracks.audio.map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {tracks.subtitles.length > 0 && (
                <label>
                  Sous-titres
                  <select
                    aria-label="Sous-titres"
                    value={tracks.subtitleId}
                    onChange={(event) =>
                      tracks.chooseSubtitle(Number(event.target.value))
                    }
                  >
                    <option value={-1}>Désactivés</option>
                    {tracks.subtitles.map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {fullscreen && (
            <button
              className="fullscreen-exit icon-button"
              aria-label="Quitter le plein écran"
              title="Quitter le plein écran (Échap)"
              onClick={() => void exit()}
            >
              <Minimize />
            </button>
          )}
        </div>
      )}
      {!playback.device && (
        <p className="player-shortcuts muted">
          Espace / K : lecture ou pause · ← / → : 10 s · ↑ / ↓ : volume · M :
          muet · F : plein écran · Échap : quitter le plein écran
        </p>
      )}
      {awakeWarning && (
        <p className="notice" role="status">
          {awakeWarning}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}{" "}
          {onRetry && (
            <button
              onClick={() => {
                flushProgress();
                onRetry();
              }}
            >
              Serveur suivant
            </button>
          )}
        </p>
      )}
      {onNext && (
        <button className="secondary next-button" onClick={next}>
          <SkipForward size={17} /> Épisode suivant
        </button>
      )}
    </section>
  );
}
