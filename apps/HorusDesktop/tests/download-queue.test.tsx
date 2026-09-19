import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useDownloads } from "../src/hooks/useDownloads";
import { invoke, type OfflineMedia } from "../src/services/native";
import { DownloadSettings } from "../src/components/DownloadSettings";
import { DownloadsScreen } from "../src/screens/DownloadsScreen";
import { DownloadActivity } from "../src/components/DownloadActivity";
import type { MediaDetails } from "../src/types/media";

vi.mock("../src/services/native", async (original) => ({
  ...(await original<typeof import("../src/services/native")>()),
  isTauri: () => true,
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));
const details = (id: string): MediaDetails => ({
  media: { id, title: id, type: "movie", providerId: "vidzy" },
  episode: { id, number: 1 },
  episodes: [],
  streams: [],
});
const stream = {
  url: "https://fixture.invalid/media",
  server: "A",
  language: "VF",
};
const callbacks = {
  setError: vi.fn(),
  setNotice: vi.fn(),
  setDetailError: vi.fn(),
  setDeviceError: vi.fn(),
};
const calls: {
  id: string;
  resolve: (value: OfflineMedia) => void;
  reject: (reason: Error) => void;
}[] = [];
const item = (id: string): OfflineMedia => ({
  id,
  metadata: {
    media: details(id).media,
    episode: details(id).episode!,
    title: id,
    language: "VF",
  },
  sizeBytes: 100,
  downloadedAt: 0,
});
beforeEach(() => {
  calls.length = 0;
  Object.values(callbacks).forEach((callback) => callback.mockClear());
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "list_downloads") return [] as never;
      if (command === "get_download_directory") return "/old" as never;
      if (command === "set_download_directory")
        return ((args as { directory: string }).directory ??
          "/default") as never;
      if (command === "download_media")
        return new Promise<never>((resolve, reject) => {
          calls.push({
            id: (args as { id: string }).id,
            resolve: resolve as never,
            reject,
          });
        });
      if (command === "cancel_download") return undefined as never;
      throw new Error(`Unexpected IPC ${command}`);
    });
});

test("la file respecte l’ordre, déduplique et retire une demande sans la télécharger", async () => {
  const { result } = renderHook(() => useDownloads(callbacks));
  let first!: ReturnType<typeof result.current.downloadMedia>;
  let duplicate!: typeof first;
  let removed!: typeof first;
  let last!: typeof first;
  act(() => {
    first = result.current.downloadMedia(details("A"), stream);
    duplicate = result.current.downloadMedia(details("A"), stream);
    removed = result.current.downloadMedia(details("B"), stream);
    last = result.current.downloadMedia(details("C"), stream);
  });
  expect(first).toBe(duplicate);
  expect(calls).toHaveLength(1);
  expect(result.current.queue.map((e) => e.title)).toEqual(["B", "C"]);
  act(() => result.current.removeQueued(result.current.queue[0].id));
  await expect(removed).resolves.toBeUndefined();
  await act(async () => calls[0].resolve(item("A")));
  expect(calls).toHaveLength(2);
  expect(result.current.download?.title).toBe("C");
  expect(result.current.queue).toEqual([]);
  await act(async () => calls[1].resolve(item("C")));
  await expect(first).resolves.toMatchObject({ id: "A" });
  await expect(last).resolves.toMatchObject({ id: "C" });
  expect(result.current.download).toBeUndefined();
});

test("annuler attend le nettoyage natif avant de démarrer le suivant ; un échec ne bloque pas la file", async () => {
  const { result } = renderHook(() => useDownloads(callbacks));
  act(() => {
    void result.current.downloadMedia(details("A"), stream);
    void result.current.downloadMedia(details("B"), stream);
    void result.current.downloadMedia(details("C"), stream);
  });
  await act(() => result.current.cancelDownload());
  expect(calls).toHaveLength(1);
  expect(result.current.download?.phase).toBe("cancelling");
  await act(async () => calls[0].reject(new Error("Téléchargement annulé")));
  expect(calls).toHaveLength(2);
  await act(async () =>
    calls[1].reject(new Error("Espace disque insuffisant")),
  );
  expect(callbacks.setError).toHaveBeenCalledWith(
    "B : Espace disque insuffisant",
  );
  expect(result.current.download?.title).toBe("C");
  await act(async () => calls[2].resolve(item("C")));
});

test("la fermeture abandonne les demandes en attente et annule l’actif sans démarrage tardif", async () => {
  const { result, unmount } = renderHook(() => useDownloads(callbacks));
  let first!: Promise<OfflineMedia | undefined>;
  let next!: typeof first;
  act(() => {
    first = result.current.downloadMedia(details("A"), stream);
    next = result.current.downloadMedia(details("B"), stream);
  });
  unmount();
  await expect(first).resolves.toBeUndefined();
  await expect(next).resolves.toBeUndefined();
  expect(invoke).toHaveBeenCalledWith("cancel_download", { id: calls[0].id });
  await act(async () => calls[0].resolve(item("A")));
  expect(calls).toHaveLength(1);
  expect(callbacks.setNotice).not.toHaveBeenCalled();
});

test("une erreur de liste après succès conserve le résultat attendu par la diffusion TV", async () => {
  const { result } = renderHook(() => useDownloads(callbacks));
  await act(async () => {});
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args) =>
    command === "list_downloads"
      ? Promise.reject(new Error("Liste indisponible"))
      : original(command, args),
  );
  let completion!: Promise<OfflineMedia | undefined>;
  act(() => {
    completion = result.current.downloadMedia(details("A"), stream);
  });
  await act(async () => calls[0].resolve(item("A")));
  await expect(completion).resolves.toMatchObject({ id: "A" });
  expect(callbacks.setError).toHaveBeenCalledWith("Liste indisponible");
});

test("un fichier absent reste supprimable, sans lecture ni Cast ; le dossier est enregistré explicitement", async () => {
  const playOffline = vi.fn();
  const castOffline = vi.fn();
  const removeDownload = vi.fn();
  const removeQueued = vi.fn();
  const openDownloadSettings = vi.fn();
  const { unmount } = render(
    <DownloadsScreen
      offline={[
        { ...item("Absent"), available: false, filePath: "/disque/absent.mp4" },
      ]}
      starting={false}
      openDownloadSettings={openDownloadSettings}
      queue={[{ id: "pending", title: "Suivant", bytes: 0 }]}
      removeQueued={removeQueued}
      playOffline={playOffline}
      castOffline={castOffline}
      removeDownload={removeDownload}
    />,
  );
  expect(screen.queryByLabelText("Dossier de destination")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Dossier de téléchargement" }),
  );
  expect(openDownloadSettings).toHaveBeenCalledOnce();
  expect(screen.getByText(/Fichier introuvable/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Lire" }));
  fireEvent.click(screen.getByRole("button", { name: "Diffuser Absent" }));
  expect(playOffline).not.toHaveBeenCalled();
  expect(castOffline).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Supprimer Absent" }));
  expect(removeDownload).toHaveBeenCalledWith("Absent");
  fireEvent.click(
    screen.getByRole("button", { name: "Retirer Suivant de la file" }),
  );
  expect(removeQueued).toHaveBeenCalledWith("pending");
  unmount();
  render(<DownloadSettings busy={false} />);
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Dossier de destination") as HTMLInputElement)
        .value,
    ).toBe("/old"),
  );
  fireEvent.change(screen.getByLabelText("Dossier de destination"), {
    target: { value: "/nouveau" },
  });
  expect(invoke).not.toHaveBeenCalledWith(
    "set_download_directory",
    expect.anything(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Enregistrer le dossier" }),
  );
  await screen.findByText(/Dossier enregistré/);
  expect(invoke).toHaveBeenCalledWith("set_download_directory", {
    directory: "/nouveau",
  });
});

test("la progression inconnue n’invente ni total ni durée ; les estimations disponibles sont visibles", () => {
  const cancelDownload = vi.fn();
  const { rerender } = render(
    <DownloadActivity
      download={{ id: "a", title: "Film", bytes: 1048576, phase: "preparing" }}
      cancelDownload={cancelDownload}
    />,
  );
  expect(screen.queryByText(/restantes/)).toBeNull();
  rerender(
    <DownloadActivity
      download={{
        id: "a",
        title: "Film",
        bytes: 1048576,
        bytesPerSecond: 1048576,
        percent: 50,
        etaSeconds: 90,
        phase: "downloading",
      }}
      cancelDownload={cancelDownload}
    />,
  );
  expect(screen.getByText(/1 Mo\/s.*50 %.*2 min restantes/)).toBeTruthy();
});

test("l’état de téléchargement distingue les épisodes et les langues de la fiche", async () => {
  const { result } = renderHook(() => useDownloads(callbacks));
  act(() => {
    void result.current.downloadMedia(details("A"), stream);
  });
  expect(result.current.isDownloading(details("A"), stream)).toBe(true);
  expect(result.current.isDownloading(details("B"), stream)).toBe(false);
  expect(
    result.current.isDownloading(details("A"), {
      ...stream,
      language: "VOSTFR",
    }),
  ).toBe(false);
  act(() => {
    void result.current.downloadMedia(details("A"), {
      ...stream,
      language: "VOSTFR",
    });
  });
  expect(result.current.queue).toHaveLength(1);
  await act(async () => calls[0].resolve(item("A")));
  await act(async () => calls[1].resolve(item("A-vostfr")));
});

test("une liste ancienne ne remplace pas une actualisation récente", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  const listing: ((items: OfflineMedia[]) => void)[] = [];
  vi.mocked(invoke).mockImplementation((command, args) =>
    command === "list_downloads"
      ? new Promise((resolve) => listing.push(resolve as never))
      : original(command, args),
  );
  const { result } = renderHook(() => useDownloads(callbacks));
  let refresh!: Promise<void>;
  act(() => {
    refresh = result.current.refreshOffline();
  });
  await act(async () => {
    listing[1]([item("Récent")]);
    await refresh;
  });
  await act(async () => listing[0]([]));
  expect(result.current.offline[0].id).toBe("Récent");
});

test("le dossier est verrouillé pendant le traitement et un refus d’écriture reste visible", async () => {
  const { rerender } = render(<DownloadSettings busy />);
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Dossier de destination") as HTMLInputElement)
        .value,
    ).toBe("/old"),
  );
  expect(
    screen.getByLabelText("Dossier de destination").hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Dossier par défaut" }));
  expect(invoke).not.toHaveBeenCalledWith(
    "set_download_directory",
    expect.anything(),
  );
  rerender(<DownloadSettings busy={false} />);
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args) =>
    command === "set_download_directory"
      ? Promise.reject(new Error("Écriture refusée"))
      : original(command, args),
  );
  fireEvent.change(screen.getByLabelText("Dossier de destination"), {
    target: { value: "/refusé" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Enregistrer le dossier" }),
  );
  await screen.findByText("Écriture refusée");
  expect(
    screen
      .getByRole("button", { name: "Enregistrer le dossier" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
