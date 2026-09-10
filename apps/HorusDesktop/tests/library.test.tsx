import { beforeEach, expect, test } from "vitest";
import type { SearchResult } from "@horus/core";
import { useLibrary } from "../src/store/library";

const media: SearchResult = {
  id: "42",
  providerId: "vidzy",
  title: "Bibliothèque de test",
  type: "series",
};
const entry = {
  media,
  episode: { id: "ep-2", number: 2 },
  position: 120,
  duration: 600,
};

beforeEach(() => {
  localStorage.clear();
  useLibrary.setState({ apiUrl: "", wishlist: [], history: [] });
});

test("favoris, historique et URL API sont restaurés depuis le stockage persistant", async () => {
  const library = useLibrary.getState();
  library.setApiUrl("https://catalogue.invalid");
  library.toggleWishlist(media);
  library.remember(entry);
  const stored = localStorage.getItem("horus-desktop-library")!;
  expect(JSON.parse(stored)).toMatchObject({
    version: 1,
    state: {
      apiUrl: "https://catalogue.invalid",
      wishlist: [media],
      history: [entry],
    },
  });

  // Oublier l'état en mémoire puis charger uniquement ce qui avait été écrit.
  useLibrary.setState({ apiUrl: "", wishlist: [], history: [] });
  localStorage.setItem("horus-desktop-library", stored);
  await useLibrary.persist.rehydrate();
  expect(useLibrary.getState()).toMatchObject(JSON.parse(stored).state);
  expect(useLibrary.getState().history[0].updatedAt).toBeGreaterThan(0);
});

test("le format version 1 existant reste lisible et les suppressions sont persistées", async () => {
  localStorage.setItem(
    "horus-desktop-library",
    JSON.stringify({
      version: 1,
      state: {
        apiUrl: "https://existing.invalid",
        wishlist: [media],
        history: [{ ...entry, updatedAt: 1234 }],
      },
    }),
  );
  await useLibrary.persist.rehydrate();
  expect(useLibrary.getState().history[0]).toEqual({
    ...entry,
    updatedAt: 1234,
  });
  useLibrary.getState().toggleWishlist(media);
  useLibrary.getState().clearHistory();
  expect(
    JSON.parse(localStorage.getItem("horus-desktop-library")!).state,
  ).toEqual({
    apiUrl: "https://existing.invalid",
    wishlist: [],
    history: [],
  });
});
