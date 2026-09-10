import { beforeEach, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import type { SearchResult, Stream } from "@horus/core";
import App from "../src/App";
import { useLibrary } from "../src/store/library";
import {
  invoke,
  releaseStream,
  type OfflineMedia,
} from "../src/services/native";
import {
  controlDevice,
  deviceStatus,
  discoverDevices,
  loadDevice,
} from "../src/services/devices";
import { providerFor, searchMedia } from "../src/services/providers";

vi.mock("../src/services/providers", () => ({
  providerFor: vi.fn(),
  searchMedia: vi.fn(),
}));
vi.mock("../src/services/devices", () => ({
  controlDevice: vi.fn(),
  deviceStatus: vi.fn(),
  discoverDevices: vi.fn(),
  loadDevice: vi.fn(),
}));
vi.mock("../src/services/native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/native")>()),
  isTauri: () => true,
  invoke: vi.fn(),
  releaseStream: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.1.0"),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

const media: SearchResult = {
  id: "movie",
  title: "Film de test",
  type: "movie",
  providerId: "vidzy",
};
const episode = { id: "film-1", number: 1 };
const stream: Stream = {
  url: "https://fixture.invalid/film.mp4",
  server: "VF 1",
  language: "VF",
};
const downloaded: OfflineMedia = {
  id: "offline-1",
  sizeBytes: 1048576,
  downloadedAt: 1000,
  metadata: { media, episode, title: "Film de test", language: "VF" },
};
const tv = {
  id: "tv-1",
  kind: "cast" as const,
  ip: "192.0.2.10",
  name: "TV de test",
};
let files: OfflineMedia[];

beforeEach(() => {
  localStorage.clear();
  useLibrary.setState({
    apiUrl: "https://catalogue.invalid",
    wishlist: [media],
    history: [],
  });
  files = [];
  vi.mocked(providerFor).mockReturnValue({
    getEpisodes: vi.fn(async () => [episode]),
    getStreams: vi.fn(async () => [stream]),
  } as unknown as ReturnType<typeof providerFor>);
  vi.mocked(searchMedia).mockReset().mockResolvedValue([]);
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    switch (command) {
      case "runtime_info":
        return { platform: "macos", ffmpeg: true } as never;
      case "list_downloads":
        return files as never;
      case "download_media":
        files = [downloaded];
        return downloaded as never;
      case "remove_download":
        files = files.filter((item) => item.id !== (args as { id: string }).id);
        return undefined as never;
      case "offline_stream":
        return {
          id: "offline-session",
          url: "/cached.mp4",
          contentType: "video/mp4",
        } as never;
      case "prepare_stream":
        return {
          id: "online-session",
          url: "/source.mp4",
          contentType: "video/mp4",
        } as never;
      case "cancel_download":
        return undefined as never;
      default:
        throw new Error(`Unexpected IPC: ${command}`);
    }
  });
  vi.mocked(releaseStream).mockReset().mockResolvedValue(undefined);
  vi.mocked(discoverDevices).mockResolvedValue({ devices: [tv], warnings: [] });
  vi.mocked(loadDevice).mockReset().mockResolvedValue(undefined);
  vi.mocked(controlDevice).mockReset().mockResolvedValue(undefined);
  vi.mocked(deviceStatus)
    .mockReset()
    .mockResolvedValue({
      transportState: "PLAYING",
      positionSeconds: 45,
      durationSeconds: 600,
    });
});

async function openFilm() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Ma liste/ }));
  fireEvent.click(screen.getByRole("button", { name: /^FILM Film de test/ }));
  const dialog = await screen.findByRole("dialog", { name: "Film de test" });
  await waitFor(() =>
    expect(
      within(dialog)
        .getByRole("button", { name: "Télécharger" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  return dialog;
}

async function openTV() {
  const dialog = await openFilm();
  fireEvent.click(within(dialog).getByRole("button", { name: "Diffuser" }));
  return screen.findByRole("dialog", { name: "Choisir un téléviseur" });
}

test("un téléchargement conserve ses métadonnées, se lit hors ligne et peut être supprimé après fermeture", async () => {
  const dialog = await openFilm();
  fireEvent.click(within(dialog).getByRole("button", { name: "Télécharger" }));
  await screen.findByText(
    "Téléchargement terminé. Le média est disponible hors ligne.",
  );
  expect(invoke).toHaveBeenCalledWith(
    "download_media",
    expect.objectContaining({
      source: { url: stream.url, headers: {} },
      metadata: expect.objectContaining({ media, episode, language: "VF" }),
    }),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Fermer" }));
  fireEvent.click(screen.getByRole("button", { name: "Téléchargements" }));
  fireEvent.click(await screen.findByRole("button", { name: "Lire" }));
  await screen.findByRole("region", { name: "Lecteur" });
  expect(invoke).toHaveBeenCalledWith("offline_stream", {
    id: downloaded.id,
    receiver: null,
  });
  expect(screen.queryByRole("button", { name: "Épisode suivant" })).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Supprimer Film de test" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Arrêter et fermer le lecteur" }),
  );
  await waitFor(() =>
    expect(releaseStream).toHaveBeenCalledWith("offline-session"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Supprimer Film de test" }),
  );
  await screen.findByText("À emporter avec vous");
  expect(invoke).toHaveBeenCalledWith("remove_download", { id: downloaded.id });
});

test("la progression concerne seulement le téléchargement actif et l'annulation libère l'interface", async () => {
  const dialog = await openFilm();
  const defaultInvoke = vi.mocked(invoke).getMockImplementation()!;
  let rejectDownload!: (error: Error) => void;
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "download_media")
      return new Promise((_resolve, reject) => {
        rejectDownload = reject;
      });
    if (command === "cancel_download")
      rejectDownload(new Error("Téléchargement annulé"));
    return defaultInvoke(command, args);
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Télécharger" }));
  const downloadCall = vi
    .mocked(invoke)
    .mock.calls.find(([cmd]) => cmd === "download_media")!;
  const id = (downloadCall[1] as { id: string }).id;
  const onProgress = vi.mocked(listen).mock.calls[0][1] as (event: {
    payload: { id: string; bytes: number };
  }) => void;
  act(() => onProgress({ payload: { id: "other", bytes: 1048576 } }));
  expect(screen.getByText(/0 Mo téléchargés/)).toBeTruthy();
  act(() => onProgress({ payload: { id, bytes: 1048576 } }));
  expect(screen.getByText(/1 Mo téléchargés/)).toBeTruthy();
  expect(
    within(dialog)
      .getByRole("button", { name: "Télécharger" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull(),
  );
  expect(invoke).toHaveBeenCalledWith("cancel_download", { id });
  expect(
    within(dialog)
      .getByRole("button", { name: "Télécharger" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(invoke).not.toHaveBeenCalledWith("offline_stream", expect.anything());
});

test("télécharger puis diffuser utilise le fichier conservé et libère le relais même si l'arrêt TV échoue", async () => {
  const dialog = await openTV();
  fireEvent.change(within(dialog).getByLabelText("Mode de diffusion"), {
    target: { value: "download" },
  });
  fireEvent.click(
    await within(dialog).findByRole("button", { name: /TV de test/ }),
  );
  await screen.findByText("Lecture en cours sur votre téléviseur");
  expect(invoke).toHaveBeenCalledWith("offline_stream", {
    id: downloaded.id,
    receiver: tv.ip,
  });
  expect(loadDevice).toHaveBeenCalledWith(
    tv,
    expect.objectContaining({ id: "offline-session" }),
    expect.any(String),
  );
  let savedAtStop = 0;
  const order: string[] = [];
  vi.mocked(controlDevice).mockImplementation(async (_device, action) => {
    if (action === "stop") {
      savedAtStop = JSON.parse(localStorage.getItem("horus-desktop-library")!)
        .state.history[0].position;
      order.push("stop");
      throw new Error("TV déconnectée");
    }
  });
  vi.mocked(releaseStream).mockImplementation(async () => {
    order.push("release");
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Arrêter et fermer le lecteur" }),
  );
  await screen.findByText("Arrêt TV non confirmé : TV déconnectée");
  await waitFor(() => expect(order).toEqual(["stop", "release"]));
  expect(savedAtStop).toBe(45);
  expect(files).toEqual([downloaded]);
  expect(screen.queryByRole("region", { name: "Lecteur" })).toBeNull();
});

test("un échec de démarrage TV libère le flux préparé sans créer d'historique", async () => {
  vi.mocked(loadDevice).mockRejectedValueOnce(new Error("Démarrage refusé"));
  const dialog = await openTV();
  fireEvent.click(
    await within(dialog).findByRole("button", { name: /TV de test/ }),
  );
  await waitFor(() =>
    expect(releaseStream).toHaveBeenCalledWith("online-session"),
  );
  expect(within(dialog).getByText("Démarrage refusé")).toBeTruthy();
  expect(useLibrary.getState().history).toEqual([]);
  expect(screen.queryByRole("region", { name: "Lecteur" })).toBeNull();
});

test("changer de section ignore les résultats d'une recherche encore en cours", async () => {
  let resolve!: (media: SearchResult[]) => void;
  vi.mocked(searchMedia).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<App />);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Rechercher un titre" }),
    { target: { value: "Film" } },
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Rechercher" }).closest("form")!,
  );
  fireEvent.click(screen.getByRole("button", { name: "Animés" }));
  await act(async () => resolve([media]));
  expect(screen.queryByText("Film de test")).toBeNull();
  expect(
    (
      screen.getByRole("textbox", {
        name: "Rechercher un titre",
      }) as HTMLInputElement
    ).value,
  ).toBe("");
  expect(screen.queryByText("Recherche en cours…")).toBeNull();
});
