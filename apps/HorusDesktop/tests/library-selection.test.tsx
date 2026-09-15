import { beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { SearchResult } from "@horus/core";
import { LibraryScreen } from "../src/screens/LibraryScreen";
import { useLibrary } from "../src/store/library";

const movie: SearchResult = {
  id: "42",
  providerId: "vidzy",
  type: "movie",
  title: "Le film",
};
const series: SearchResult = {
  id: "43",
  providerId: "vidzy",
  type: "series",
  title: "La série",
};
// The same source id on another provider must not be deleted together.
const anime: SearchResult = {
  id: "42",
  providerId: "anime-sama",
  type: "anime",
  title: "L’animé",
};
const openMedia = vi.fn().mockResolvedValue(undefined);
function remember(media: SearchResult) {
  useLibrary
    .getState()
    .remember({
      media,
      episode: { id: `${media.id}-episode`, number: 2 },
      position: 35,
      duration: 100,
    });
}
function Library({
  section = "history",
}: {
  section?: "wishlist" | "history";
}) {
  const library = useLibrary();
  return (
    <LibraryScreen section={section} library={library} openMedia={openMedia} />
  );
}
beforeEach(() => {
  localStorage.clear();
  useLibrary.setState({
    apiUrl: "https://catalogue.invalid",
    wishlist: [series, movie, anime],
    history: [],
  });
  [movie, series, anime].forEach(remember);
});

test("Ma liste sépare films, séries et animés tout en conservant l'ouverture et les favoris", () => {
  render(<Library section="wishlist" />);
  for (const [title, media] of [
    ["Films", movie],
    ["Séries", series],
    ["Animés", anime],
  ] as const) {
    const category = within(screen.getByRole("region", { name: title }));
    expect(category.getByRole("heading", { level: 3 }).textContent).toBe(
      media.title,
    );
    expect(category.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  }
  fireEvent.click(
    within(screen.getByRole("region", { name: "Films" })).getByRole("button", {
      name: /^FILM Le film/,
    }),
  );
  expect(openMedia).toHaveBeenCalledWith(movie, undefined);
  fireEvent.click(
    screen.getByRole("button", { name: "Retirer Le film de ma liste" }),
  );
  expect(useLibrary.getState().wishlist).toEqual([series, anime]);
  expect(screen.queryByRole("region", { name: "Films" })).toBeNull();
});

test("sélectionner ne lit ni ne supprime le contenu ; confirmer supprime uniquement les titres cochés et persiste le résultat", async () => {
  render(<Library />);
  const remaining = useLibrary
    .getState()
    .history.filter((item) => item.media !== movie);
  fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
  const confirm = screen.getByRole("button", {
    name: "Confirmer la suppression (0)",
  }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Sélectionner Le film" }),
  );
  expect(openMedia).not.toHaveBeenCalled();
  expect(useLibrary.getState().history).toHaveLength(3);
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmer la suppression (1)" }),
  );
  expect(useLibrary.getState().history).toEqual(remaining);
  expect(screen.queryByRole("checkbox")).toBeNull();
  const saved = localStorage.getItem("horus-desktop-library")!;
  expect(JSON.parse(saved)).toMatchObject({
    version: 1,
    state: {
      history: remaining,
      wishlist: [series, movie, anime],
      apiUrl: "https://catalogue.invalid",
    },
  });
  await act(async () => {
    useLibrary.setState({ history: [] });
    localStorage.setItem("horus-desktop-library", saved);
    await useLibrary.persist.rehydrate();
  });
  expect(useLibrary.getState().history).toEqual(remaining);
  fireEvent.click(screen.getByRole("button", { name: /^ANIMÉ L’animé/ }));
  expect(openMedia).toHaveBeenCalledWith(anime, remaining[0].episode);
});

test("tout sélectionner et tout désélectionner permettent aussi d'exclure un titre avant confirmation", () => {
  render(<Library />);
  fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
  fireEvent.click(screen.getByRole("button", { name: "Tout sélectionner" }));
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Tout désélectionner" }));
  expect(screen.getAllByRole("checkbox", { checked: false })).toHaveLength(3);
  expect(
    (
      screen.getByRole("button", {
        name: "Confirmer la suppression (0)",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Tout sélectionner" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Sélectionner La série" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmer la suppression (2)" }),
  );
  expect(useLibrary.getState().history.map((entry) => entry.media)).toEqual([
    series,
  ]);
});

test("annuler ou changer d'onglet abandonne la sélection sans changer les données", () => {
  const result = render(<Library />);
  const original = localStorage.getItem("horus-desktop-library");
  fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
  fireEvent.click(screen.getByRole("button", { name: "Tout sélectionner" }));
  fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
  expect(screen.getAllByRole("checkbox", { checked: false })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Tout sélectionner" }));
  result.rerender(<Library section="wishlist" />);
  result.rerender(<Library section="history" />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(localStorage.getItem("horus-desktop-library")).toBe(original);
});

test("un titre apparu après Tout sélectionner n'est pas supprimé sans avoir été coché", () => {
  const added: SearchResult = {
    ...movie,
    id: "new",
    title: "Nouvelle lecture",
  };
  render(<Library />);
  fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
  fireEvent.click(screen.getByRole("button", { name: "Tout sélectionner" }));
  act(() => remember(added));
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Sélectionner Nouvelle lecture",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmer la suppression (3)" }),
  );
  expect(useLibrary.getState().history.map((entry) => entry.media)).toEqual([
    added,
  ]);
});
