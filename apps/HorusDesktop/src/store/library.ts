import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Episode, SearchResult } from "@horus/core";

export const mediaKey = (media: SearchResult) =>
  `${media.providerId}:${media.id}`;
export interface HistoryEntry {
  media: SearchResult;
  episode: Episode;
  position: number;
  duration: number;
  updatedAt: number;
}
export function recordHistory(history: HistoryEntry[], entry: HistoryEntry) {
  return [
    entry,
    ...history.filter((item) => mediaKey(item.media) !== mediaKey(entry.media)),
  ].slice(0, 200);
}

interface Library {
  apiUrl: string;
  wishlist: SearchResult[];
  history: HistoryEntry[];
  setApiUrl: (url: string) => void;
  toggleWishlist: (media: SearchResult) => void;
  remember: (entry: Omit<HistoryEntry, "updatedAt">) => void;
  clearHistory: () => void;
}

export const useLibrary = create<Library>()(
  persist(
    (set) => ({
      apiUrl: import.meta.env?.VITE_HORUS_API_URL ?? "",
      wishlist: [],
      history: [],
      setApiUrl: (apiUrl) => set({ apiUrl }),
      toggleWishlist: (media) =>
        set((state) => ({
          wishlist: state.wishlist.some(
            (item) => mediaKey(item) === mediaKey(media),
          )
            ? state.wishlist.filter(
                (item) => mediaKey(item) !== mediaKey(media),
              )
            : [media, ...state.wishlist],
        })),
      remember: (entry) =>
        set((state) => ({
          history: recordHistory(state.history, {
            ...entry,
            updatedAt: Date.now(),
          }),
        })),
      clearHistory: () => set({ history: [] }),
    }),
    { name: "horus-desktop-library", version: 1 },
  ),
);
