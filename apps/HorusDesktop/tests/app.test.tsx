import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Episode, SearchResult, Stream } from "@horus/core";
import App from "../src/App";
import { useLibrary } from "../src/store/library";
import { invoke, releaseStream } from "../src/services/native";
import { providerFor } from "../src/services/providers";

vi.mock("../src/services/providers", () => ({
  providerFor: vi.fn(),
  searchMedia: vi.fn(),
}));
vi.mock("../src/services/native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/native")>()),
  isTauri: () => false,
  invoke: vi.fn(),
  releaseStream: vi.fn(),
}));

const media: SearchResult = {
  id: "series-42",
  title: "Série de test",
  type: "series",
  providerId: "vidzy",
};
const episodes: Episode[] = [
  { id: "episode-1", number: 1, title: "Premier épisode" },
  { id: "episode-2", number: 2, title: "Deuxième épisode" },
];
// La VO intercalée détecte un repli qui oublierait de filtrer la langue.
const streams: Stream[] = [
  { url: "https://fixture.invalid/vf-1.mp4", server: "VF 1", language: "VF" },
  { url: "https://fixture.invalid/vo.mp4", server: "VO", language: "VOSTFR" },
  {
    url: "https://fixture.invalid/vf-2.mp4",
    server: "VF 2",
    language: "French",
  },
];
const getStreams = vi.fn(async (_id: string) => streams);

beforeEach(() => {
  localStorage.clear();
  useLibrary.setState({ apiUrl: "", wishlist: [], history: [] });
  vi.mocked(providerFor).mockReturnValue({
    getEpisodes: vi.fn(async () => episodes),
    getStreams,
  } as unknown as ReturnType<typeof providerFor>);
  let sequence = 0;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command !== "prepare_stream")
      throw new Error(`Unexpected IPC: ${command}`);
    return {
      id: `stream-${++sequence}`,
      url: "/fixture.mp4",
      contentType: "video/mp4",
    } as never;
  });
  vi.mocked(releaseStream).mockResolvedValue(undefined);
});

function remember(episode = episodes[1], savedMedia = media) {
  useLibrary
    .getState()
    .remember({ media: savedMedia, episode, position: 90, duration: 600 });
}

async function openHistory() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Historique" }));
  fireEvent.click(screen.getByRole("button", { name: /^SÉRIE Série de test/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Lire ici" }).hasAttribute("disabled"),
    ).toBe(false),
  );
}

async function play() {
  fireEvent.click(screen.getByRole("button", { name: "Lire ici" }));
  await screen.findByRole("region", { name: "Lecteur" });
  return metadata();
}

function metadata() {
  const video = document.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 600 });
  fireEvent.loadedMetadata(video);
  return video;
}

test("l'historique sélectionne et reprend le bon épisode", async () => {
  remember();
  await openHistory();
  expect((screen.getByLabelText("Épisode") as HTMLSelectElement).value).toBe(
    "episode-2",
  );
  expect(getStreams).toHaveBeenCalledWith("episode-2");
  const video = await play();
  expect(video.currentTime).toBe(90);
  expect(useLibrary.getState().history[0].episode.id).toBe("episode-2");
});

test("un autre épisode ne récupère pas la position de l'épisode précédent", async () => {
  remember();
  await openHistory();
  fireEvent.change(screen.getByLabelText("Épisode"), {
    target: { value: "episode-1" },
  });
  await waitFor(() => expect(getStreams).toHaveBeenLastCalledWith("episode-1"));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Lire ici" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  const video = await play();
  expect(video.currentTime).toBe(0);
  expect(useLibrary.getState().history[0].episode.id).toBe("episode-1");
});

test("la reprise ne mélange pas deux fournisseurs ayant les mêmes identifiants", async () => {
  remember(episodes[1], { ...media, providerId: "anime-sama" });
  useLibrary.getState().toggleWishlist(media);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Ma liste/ }));
  fireEvent.click(screen.getByRole("button", { name: /^SÉRIE Série de test/ }));
  await screen.findByLabelText("Épisode");
  fireEvent.change(screen.getByLabelText("Épisode"), {
    target: { value: "episode-2" },
  });
  await screen.findByRole("button", { name: "Lire ici" });
  const video = await play();
  expect(video.currentTime).toBe(0);
  expect(useLibrary.getState().history).toHaveLength(2);
});

test("le serveur suivant conserve la langue, l'épisode et la progression puis refuse la VO", async () => {
  remember();
  await openHistory();
  const video = await play();
  video.currentTime = 123;
  fireEvent.error(video);
  fireEvent.click(screen.getByRole("button", { name: "Serveur suivant" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke).toHaveBeenLastCalledWith(
    "prepare_stream",
    expect.objectContaining({
      source: { url: streams[2].url, headers: {} },
    }),
  );
  expect(releaseStream).toHaveBeenCalledWith("stream-1");
  await screen.findByRole("region", { name: "Lecteur" });
  const next = metadata();
  expect(next.currentTime).toBe(123);
  expect(useLibrary.getState().history[0].episode.id).toBe("episode-2");
  fireEvent.error(next);
  fireEvent.click(screen.getByRole("button", { name: "Serveur suivant" }));
  await screen.findByText("Aucun autre serveur disponible dans cette langue.");
  expect(invoke).toHaveBeenCalledTimes(2);
});

test("fermer sauvegarde immédiatement avant de libérer le relais et nettoie la vidéo", async () => {
  remember();
  await openHistory();
  const video = await play();
  video.currentTime = 137;
  // Une sauvegarde récente ne doit pas empêcher le flush à la fermeture.
  fireEvent.timeUpdate(video);
  video.currentTime = 139;
  let savedAtRelease: unknown;
  vi.mocked(releaseStream).mockImplementation(async () => {
    savedAtRelease = JSON.parse(localStorage.getItem("horus-desktop-library")!)
      .state.history[0];
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Arrêter et fermer le lecteur" }),
  );
  await waitFor(() =>
    expect(releaseStream).toHaveBeenCalledExactlyOnceWith("stream-1"),
  );
  expect(savedAtRelease).toMatchObject({
    position: 139,
    episode: { id: "episode-2" },
  });
  expect(screen.queryByRole("region", { name: "Lecteur" })).toBeNull();
  expect(video.getAttribute("src")).toBeNull();
  expect(video.pause).toHaveBeenCalled();
  expect(video.load).toHaveBeenCalled();
  const stored = localStorage.getItem("horus-desktop-library");
  video.currentTime = 200;
  fireEvent.timeUpdate(video);
  fireEvent.loadedMetadata(video);
  expect(localStorage.getItem("horus-desktop-library")).toBe(stored);
  expect(video.currentTime).toBe(200);
});
