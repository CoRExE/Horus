import { beforeEach, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Player, type Playback } from "../src/components/Player";
import { EpisodePicker } from "../src/components/EpisodePicker";
import { groupEpisodes } from "../src/services/episodes";
import { useState } from "react";
import type { Episode } from "@horus/core";

const fixture = vi.hoisted(() => ({ engine: undefined as any }));
vi.mock("hls.js", () => ({
  default: class {
    static isSupported = () => true;
    static Events = {
      ERROR: "error",
      MANIFEST_PARSED: "manifest",
      AUDIO_TRACKS_UPDATED: "audio",
      AUDIO_TRACK_SWITCHED: "audio-switch",
      SUBTITLE_TRACKS_UPDATED: "subtitles",
      SUBTITLE_TRACK_SWITCH: "subtitle-switch",
    };
    audioTracks: object[] = [];
    subtitleTracks: object[] = [];
    audioTrack = -1;
    subtitleTrack = -1;
    subtitleDisplay = false;
    listeners = new Map<string, Set<(...args: any[]) => void>>();
    constructor() {
      fixture.engine = this;
    }
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    on(event: string, callback: (...args: any[]) => void) {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(callback);
      this.listeners.set(event, listeners);
    }
    off(event: string, callback: (...args: any[]) => void) {
      this.listeners.get(event)?.delete(callback);
    }
    emit(event: string, data = {}) {
      this.listeners.get(event)?.forEach((callback) => callback(event, data));
    }
  },
}));
const playback: Playback = {
  prepared: { id: "one", url: "/one.mp4", contentType: "video/mp4" },
  title: "Premier épisode",
  language: "VF",
  format: "file",
  resumeAt: 0,
};
function player(value = playback) {
  const result = render(
    <Player playback={value} onStop={vi.fn()} onProgress={vi.fn()} />,
  );
  return { ...result, video: result.container.querySelector("video")! };
}
beforeEach(() => {
  fixture.engine = undefined;
});

test("les raccourcis contrôlent lecture, volume et déplacement borné aux plages disponibles", () => {
  const { video } = player();
  Object.defineProperties(video, {
    duration: { configurable: true, value: 100 },
    paused: { configurable: true, value: false },
    seekable: {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 100 },
    },
  });
  fireEvent.keyDown(document, { key: " " });
  expect(video.pause).toHaveBeenCalled();
  Object.defineProperty(video, "paused", { value: true });
  fireEvent.keyDown(document, { key: "k" });
  expect(video.play).toHaveBeenCalled();
  video.currentTime = 95;
  fireEvent.keyDown(document, { key: "ArrowRight" });
  expect(video.currentTime).toBe(100);
  video.currentTime = 5;
  fireEvent.keyDown(document, { key: "ArrowLeft" });
  expect(video.currentTime).toBe(0);
  Object.defineProperty(video, "seekable", {
    value: { length: 1, start: () => 30, end: () => 90 },
  });
  video.currentTime = 30;
  fireEvent.keyDown(document, { key: "ArrowLeft" });
  expect(video.currentTime).toBe(30);
  video.volume = 0.98;
  fireEvent.keyDown(document, { key: "ArrowUp" });
  expect(video.volume).toBe(1);
  video.volume = 0.02;
  fireEvent.keyDown(document, { key: "ArrowDown" });
  expect(video.volume).toBe(0);
  fireEvent.keyDown(document, { key: "m" });
  expect(video.muted).toBe(true);
  fireEvent.keyDown(document, { key: "m", repeat: true });
  expect(video.muted).toBe(true);
});

test("saisie, commandes, dialogues et raccourcis système restent prioritaires", () => {
  const { video } = player();
  const controls = render(
    <>
      <input aria-label="Recherche" />
      <textarea />
      <select aria-label="Choix">
        <option>A</option>
      </select>
      <div contentEditable suppressContentEditableWarning>
        Texte
      </div>
      <button>Action</button>
    </>,
  );
  for (const element of controls.container.querySelectorAll(
    "input, textarea, select, [contenteditable], button",
  )) {
    fireEvent.keyDown(element, { key: " " });
    fireEvent.keyDown(element, { key: "ArrowDown" });
  }
  fireEvent.keyDown(document, { key: " ", ctrlKey: true });
  fireEvent.keyDown(document, { key: "k", isComposing: true });
  const modal = render(<dialog open>Paramètres</dialog>);
  fireEvent.keyDown(document, { key: "k" });
  expect(video.play).not.toHaveBeenCalled();
  expect(video.pause).not.toHaveBeenCalled();
  expect(video.volume).toBe(1);
  modal.unmount();
  fireEvent.keyDown(document, { key: "k" });
  expect(video.play).toHaveBeenCalledTimes(1);
});

test("les pistes HLS suivent le manifeste, changent explicitement et disparaissent au changement de source", async () => {
  const result = player({ ...playback, format: "hls" });
  await waitFor(() => expect(fixture.engine).toBeDefined());
  const engine = fixture.engine;
  engine.audioTracks = [
    { name: "Français", lang: "fr" },
    { name: "Original", lang: "en" },
  ];
  engine.subtitleTracks = [{ name: "Français", lang: "fr" }];
  engine.audioTrack = 0;
  act(() => engine.emit("manifest"));
  fireEvent.change(screen.getByLabelText("Piste audio"), {
    target: { value: "1" },
  });
  expect(engine.audioTrack).toBe(1);
  fireEvent.change(screen.getByLabelText("Sous-titres"), {
    target: { value: "0" },
  });
  expect(engine.subtitleTrack).toBe(0);
  expect(engine.subtitleDisplay).toBe(true);
  fireEvent.change(screen.getByLabelText("Sous-titres"), {
    target: { value: "-1" },
  });
  expect(engine.subtitleTrack).toBe(-1);
  expect(engine.subtitleDisplay).toBe(false);
  result.rerender(
    <Player
      playback={{ ...playback, title: "Suivant" }}
      onStop={vi.fn()}
      onProgress={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("Piste audio")).toBeNull();
  expect(screen.queryByLabelText("Sous-titres")).toBeNull();
  expect(engine.destroy).toHaveBeenCalledTimes(1);
  act(() => engine.emit("audio"));
  expect(screen.queryByLabelText("Piste audio")).toBeNull();
});

test("le lecteur propose uniquement les pistes natives exposées, sans toucher aux métadonnées", () => {
  const { video } = player();
  const audio = Object.assign(new EventTarget(), {
    length: 2,
    0: { label: "VF", language: "fr", enabled: true },
    1: { label: "VO", language: "en", enabled: false },
  });
  const text = Object.assign(new EventTarget(), {
    length: 2,
    0: { kind: "metadata", mode: "hidden", label: "ID3", language: "" },
    1: {
      kind: "subtitles",
      mode: "disabled",
      label: "Français",
      language: "fr",
    },
  });
  Object.defineProperties(video, {
    audioTracks: { value: audio },
    textTracks: { value: text },
  });
  fireEvent.loadedMetadata(video);
  expect(screen.queryByText("ID3")).toBeNull();
  fireEvent.change(screen.getByLabelText("Piste audio"), {
    target: { value: "1" },
  });
  expect(audio[0].enabled).toBe(false);
  expect(audio[1].enabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Sous-titres"), {
    target: { value: "1" },
  });
  expect(text[1].mode).toBe("showing");
  expect(text[0].mode).toBe("hidden");
  fireEvent.change(screen.getByLabelText("Sous-titres"), {
    target: { value: "-1" },
  });
  expect(text[1].mode).toBe("disabled");
  expect(text[0].mode).toBe("hidden");
});

const episodes: Episode[] = [
  { id: "vidzy::tv::42::1::1", number: 1, title: "Saison 1 - Épisode 1" },
  { id: "vidzy::tv::42::1::2", number: 2, title: "Saison 1 - Épisode 2" },
  { id: "vidzy::tv::42::2::1", number: 1, title: "Saison 2 - Épisode 1" },
];
test("la saison de reprise est sélectionnée et changer de saison choisit son premier épisode", () => {
  const chosen = vi.fn();
  function Picker() {
    const [episode, setEpisode] = useState(episodes[2]);
    return (
      <EpisodePicker
        episodes={episodes}
        selected={episode}
        disabled={false}
        onChoose={(value) => {
          chosen(value);
          setEpisode(value);
        }}
      />
    );
  }
  render(<Picker />);
  expect((screen.getByLabelText("Saison") as HTMLSelectElement).value).toBe(
    "Saison 2",
  );
  expect((screen.getByLabelText("Épisode") as HTMLSelectElement).value).toBe(
    episodes[2].id,
  );
  expect(screen.queryByRole("option", { name: "Épisode 2" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Saison"), {
    target: { value: "Saison 1" },
  });
  expect(chosen).toHaveBeenLastCalledWith(episodes[0]);
  fireEvent.change(screen.getByLabelText("Épisode"), {
    target: { value: episodes[1].id },
  });
  expect(chosen).toHaveBeenLastCalledWith(episodes[1]);
});

test("les animés conservent leurs arcs, films et identifiants, sans inventer de saison pour les épisodes inconnus", () => {
  const source = [
    {
      id: "Saison 1::https://test/1",
      number: 1,
      title: "Saison 1 - Épisode 1",
    },
    { id: "Film::https://test/2", number: 1, title: "Film - Épisode 1" },
    { id: "unknown", number: 3, title: "Spécial" },
  ];
  const groups = groupEpisodes(source);
  expect(groups.map((group) => group.name)).toEqual([
    "Saison 1",
    "Film",
    "Tous les épisodes",
  ]);
  expect(groups.flatMap((group) => group.episodes)).toEqual(source);
});
