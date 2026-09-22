import { beforeEach, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  getStreams.mockReset().mockResolvedValue(streams);
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

test("l'épisode suivant conserve la langue et commence sans la position du précédent", async () => {
  remember(episodes[0]);
  await openHistory();
  const video = await play();
  video.currentTime = 150;
  fireEvent.click(screen.getByRole("button", { name: "Épisode suivant" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(getStreams).toHaveBeenLastCalledWith("episode-2", episodes[1]);
  expect(releaseStream).toHaveBeenCalledWith("stream-1");
  await waitFor(() =>
    expect(useLibrary.getState().history[0].episode.id).toBe("episode-2"),
  );
  expect(metadata().currentTime).toBe(0);
  expect(invoke).toHaveBeenLastCalledWith(
    "prepare_stream",
    expect.objectContaining({
      source: { url: streams[0].url, headers: {} },
    }),
  );
});

test("l'absence de la langue choisie à l'épisode suivant exige un choix explicite", async () => {
  remember(episodes[0]);
  await openHistory();
  await play();
  getStreams.mockResolvedValueOnce([streams[1]]);
  fireEvent.click(screen.getByRole("button", { name: "Épisode suivant" }));
  await screen.findByText(
    "La piste VF est indisponible. Choisissez une autre langue pour continuer.",
  );
  expect(screen.queryByRole("region", { name: "Lecteur" })).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Lire ici" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "VOSTFR" }));
  await play();
  expect(invoke).toHaveBeenLastCalledWith(
    "prepare_stream",
    expect.objectContaining({
      source: { url: streams[1].url, headers: {} },
    }),
  );
});

test("fermer pendant la résolution de l'épisode suivant ignore la réponse tardive", async () => {
  remember(episodes[0]);
  await openHistory();
  await play();
  let resolve!: (streams: Stream[]) => void;
  getStreams.mockReturnValueOnce(
    new Promise<Stream[]>((done) => {
      resolve = done;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Épisode suivant" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Arrêter et fermer le lecteur" }),
  );
  await act(async () => resolve(streams));
  expect(screen.queryByRole("region", { name: "Lecteur" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("les paramètres conservent le brouillon en naviguant puis enregistrent l'URL", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Paramètres" }));
  fireEvent.change(screen.getByLabelText("Adresse du catalogue"), {
    target: { value: "https://catalogue.invalid/" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Historique" }));
  fireEvent.click(screen.getByRole("button", { name: "Paramètres" }));
  expect(
    (screen.getByLabelText("Adresse du catalogue") as HTMLInputElement).value,
  ).toBe("https://catalogue.invalid/");
  expect(useLibrary.getState().apiUrl).toBe("");
  fireEvent.submit(
    screen.getByRole("button", { name: "Enregistrer" }).closest("form")!,
  );
  expect(useLibrary.getState().apiUrl).toBe("https://catalogue.invalid");
  expect(
    JSON.parse(localStorage.getItem("horus-desktop-library")!).state.apiUrl,
  ).toBe("https://catalogue.invalid");
});

test("la bibliothèque permet encore de retirer un favori et de vider l'historique", () => {
  remember();
  useLibrary.getState().toggleWishlist(media);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Ma liste/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Retirer Série de test de ma liste" }),
  );
  expect(screen.getByText("Votre bibliothèque commence ici")).toBeTruthy();
  expect(useLibrary.getState().wishlist).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Historique" }));
  fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
  expect(useLibrary.getState().history).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Tout sélectionner" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmer la suppression (1)" }),
  );
  expect(useLibrary.getState().history).toEqual([]);
});

test("ouvrir une autre lecture sauvegarde la position avant de libérer la précédente", async () => {
  remember();
  await openHistory();
  const video = await play();
  video.currentTime = 172;
  let positionAtRelease: number | undefined;
  vi.mocked(releaseStream).mockImplementation(async () => {
    positionAtRelease = useLibrary.getState().history[0].position;
  });
  fireEvent.click(screen.getByRole("button", { name: /^SÉRIE Série de test/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Lire ici" }),
  );
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(positionAtRelease).toBe(172);
  await screen.findByRole("region", { name: "Lecteur" });
  expect(metadata().currentTime).toBe(172);
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
  expect(getStreams).toHaveBeenCalledWith("episode-2", episodes[1]);
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
  await waitFor(() => expect(getStreams).toHaveBeenLastCalledWith("episode-1", episodes[0]));
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

test("l'épisode suivant restaure le plein écran navigateur avant de recréer le lecteur", async () => {
  remember(episodes[0]);
  await openHistory();
  const video = await play();
  const container = video.parentElement!;
  container.requestFullscreen = vi.fn(async () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: container,
    });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  document.exitFullscreen = vi.fn(async () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  fireEvent.keyDown(document, { key: "f" });
  await waitFor(() =>
    expect(container.classList.contains("is-fullscreen")).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Épisode suivant" }));
  await waitFor(() =>
    expect(useLibrary.getState().history[0].episode.id).toBe("episode-2"),
  );
  await waitFor(() => expect(document.exitFullscreen).toHaveBeenCalledTimes(1));
  expect(document.fullscreenElement).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
});

const anime: SearchResult = { ...media, id: "anime-42", title: "Animé de test", type: "anime", providerId: "anime-sama" };
const animeStreams: Stream[] = [
  { url: "https://fixture.invalid/sibnet-1.mp4", server: "Sibnet", language: "VOSTFR", quality: "auto" },
  { url: "https://fixture.invalid/sendvid-vf-1.mp4", server: "Sendvid", language: "VF" },
  { url: "https://fixture.invalid/sendvid-1.mp4", server: "Sendvid", language: "VOSTFR", quality: "auto" },
];
async function playAnime() {
  remember(episodes[0], anime);
  getStreams.mockResolvedValue(animeStreams);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Historique" }));
  fireEvent.click(screen.getByRole("button", { name: /^ANIMÉ Animé de test/ }));
  fireEvent.click(await screen.findByRole("button", { name: "VOSTFR" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Lire ici" }).hasAttribute("disabled")).toBe(false));
  return play();
}

test("un animé affiche son serveur et permet d’en changer sans erreur, en gardant la position puis le serveur au prochain épisode", async () => {
  const video = await playAnime();
  expect(screen.getByText("VOSTFR · Serveur : Sibnet")).toBeTruthy();
  const select = screen.getByRole("combobox", { name: "Serveur de lecture" });
  expect(within(select).getAllByRole("option").map(option => option.textContent?.trim())).toEqual(["Sibnet", "Sendvid"]);
  expect(screen.queryByRole("alert")).toBeNull();
  video.currentTime = 143;
  fireEvent.change(select, { target: { value: "1" } });
  await screen.findByText("VOSTFR · Serveur : Sendvid");
  expect(metadata().currentTime).toBe(143);
  expect(releaseStream).toHaveBeenCalledWith("stream-1");
  expect(invoke).toHaveBeenLastCalledWith("prepare_stream", expect.objectContaining({ source: { url: animeStreams[2].url, headers: {} } }));
  const next = [
    { ...animeStreams[1], url: "https://fixture.invalid/sendvid-vf-2.mp4" },
    { ...animeStreams[0], url: "https://fixture.invalid/sibnet-2.mp4" },
    { ...animeStreams[2], server: "sendvid", url: "https://fixture.invalid/sendvid-2.mp4" },
  ];
  getStreams.mockResolvedValueOnce(next);
  fireEvent.click(screen.getByRole("button", { name: "Épisode suivant" }));
  await screen.findByText("VOSTFR · Serveur : sendvid");
  expect(invoke).toHaveBeenLastCalledWith("prepare_stream", expect.objectContaining({ source: { url: next[2].url, headers: {} } }));
  expect(metadata().currentTime).toBe(0);
  expect(useLibrary.getState().history[0].episode.id).toBe(episodes[1].id);
});

test("le serveur choisi après l’échec du premier flux est conservé lors de l’enchaînement automatique d’un animé", async () => {
  const video = await playAnime();
  fireEvent.error(video);
  fireEvent.click(screen.getByRole("button", { name: "Serveur suivant" }));
  await screen.findByText("VOSTFR · Serveur : Sendvid");
  getStreams.mockResolvedValueOnce(animeStreams.map(stream => ({ ...stream, url: stream.url.replace("1.mp4", "2.mp4") })));
  fireEvent.ended(metadata());
  await waitFor(() => expect(useLibrary.getState().history[0].episode.id).toBe(episodes[1].id));
  expect(invoke).toHaveBeenLastCalledWith("prepare_stream", expect.objectContaining({ source: { url: "https://fixture.invalid/sendvid-2.mp4", headers: {} } }));
});

test("si le serveur de l’animé est absent du prochain épisode, le repli reste dans la langue choisie et l’indique", async () => {
  await playAnime();
  fireEvent.change(screen.getByRole("combobox", { name: "Serveur de lecture" }), { target: { value: "1" } });
  await screen.findByText("VOSTFR · Serveur : Sendvid");
  getStreams.mockResolvedValueOnce([animeStreams[1], { ...animeStreams[0], url: "https://fixture.invalid/sibnet-2.mp4" }]);
  fireEvent.click(screen.getByRole("button", { name: "Épisode suivant" }));
  await screen.findByText("Le serveur Sendvid n’est pas disponible pour cet épisode. Lecture sur Sibnet, en VOSTFR.");
  expect(invoke).toHaveBeenLastCalledWith("prepare_stream", expect.objectContaining({ source: { url: "https://fixture.invalid/sibnet-2.mp4", headers: {} } }));
});

test("un animé n’adopte pas une autre langue pour conserver le même serveur", async () => {
  await playAnime();
  getStreams.mockResolvedValueOnce([{ ...animeStreams[0], language: "VF" }]);
  fireEvent.click(screen.getByRole("button", { name: "Épisode suivant" }));
  await screen.findByText("La piste VOSTFR est indisponible. Choisissez une autre langue pour continuer.");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("region", { name: "Lecteur" })).toBeNull();
});


test("la VF d’un animé reste disponible depuis un ancien historique et à l’épisode suivant", async () => {
  const contextualEpisodes = episodes.map((episode, index) => ({
    ...episode,
    sourceContext: { seasonUrl: "https://anime-sama.to/catalogue/fixture/saison1/vostfr/", episodeIndex: index },
  }));
  vi.mocked(providerFor).mockReturnValue({
    getEpisodes: vi.fn(async () => contextualEpisodes),
    getStreams,
  } as unknown as ReturnType<typeof providerFor>);
  remember(episodes[0], anime);
  getStreams.mockResolvedValue(animeStreams);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Historique" }));
  fireEvent.click(screen.getByRole("button", { name: /^ANIMÉ Animé de test/ }));
  fireEvent.click(await screen.findByRole("button", { name: "VF" }));
  await play();
  expect(getStreams).toHaveBeenLastCalledWith(episodes[0].id, contextualEpisodes[0]);
  expect(screen.getByText("VF · Serveur : Sendvid")).toBeTruthy();
  expect(metadata().currentTime).toBe(90);
  getStreams.mockResolvedValueOnce(animeStreams.map(stream => ({ ...stream, url: stream.url.replace("1.mp4", "2.mp4") })));
  fireEvent.click(screen.getByRole("button", { name: "Épisode suivant" }));
  await waitFor(() => expect(getStreams).toHaveBeenLastCalledWith(episodes[1].id, contextualEpisodes[1]));
  await waitFor(() => expect(useLibrary.getState().history[0].episode.id).toBe(episodes[1].id));
  expect(screen.getByText("VF · Serveur : Sendvid")).toBeTruthy();
  expect(invoke).toHaveBeenLastCalledWith("prepare_stream", expect.objectContaining({ source: { url: "https://fixture.invalid/sendvid-vf-2.mp4", headers: {} } }));
});

test("changer de langue pendant la lecture reprend la position, filtre les serveurs et conserve la nouvelle langue au prochain épisode", async () => {
  const video = await playAnime();
  video.currentTime = 183;
  const language = screen.getByRole("combobox", { name: "Langue de lecture" });
  expect(within(language).getAllByRole("option").map(option => option.textContent)).toEqual(["VF", "VOSTFR"]);
  fireEvent.change(language, { target: { value: "VF" } });
  await screen.findByText("VF · Serveur : Sendvid");
  expect(metadata().currentTime).toBe(183);
  expect(useLibrary.getState().history[0].episode.id).toBe(episodes[0].id);
  expect(invoke).toHaveBeenLastCalledWith("prepare_stream", expect.objectContaining({ source: { url: animeStreams[1].url, headers: {} } }));
  const servers = screen.getByRole("combobox", { name: "Serveur de lecture" });
  expect(within(servers).getAllByRole("option").map(option => option.textContent)).toEqual(["Sendvid"]);
  // Returning to VOSTFR prefers Sendvid there, rather than the first source (Sibnet).
  fireEvent.change(screen.getByRole("combobox", { name: "Langue de lecture" }), { target: { value: "VOSTFR" } });
  await screen.findByText("VOSTFR · Serveur : Sendvid");
  expect(metadata().currentTime).toBe(183);
  expect(within(screen.getByRole("combobox", { name: "Serveur de lecture" })).getAllByRole("option")).toHaveLength(2);
  fireEvent.change(screen.getByRole("combobox", { name: "Langue de lecture" }), { target: { value: "VF" } });
  await screen.findByText("VF · Serveur : Sendvid");
  metadata();
  const nextStreams = animeStreams.map(stream => ({ ...stream, url: stream.url.replace("1.mp4", "2.mp4") }));
  getStreams.mockResolvedValueOnce(nextStreams);
  fireEvent.click(screen.getByRole("button", { name: "Épisode suivant" }));
  await waitFor(() => expect(useLibrary.getState().history[0].episode.id).toBe(episodes[1].id));
  expect(screen.getByText("VF · Serveur : Sendvid")).toBeTruthy();
  expect(invoke).toHaveBeenLastCalledWith("prepare_stream", expect.objectContaining({ source: { url: nextStreams[1].url, headers: {} } }));
  expect(metadata().currentTime).toBe(0);
});
