import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Episode, SearchResult } from "@horus/core";
import { createWatchStatus, watchedMediaKey } from "@horus/core";

export const mediaKey = (media: SearchResult) =>
  watchedMediaKey(media);
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

interface Library extends ReturnType<typeof createWatchStatus> {
  apiUrl: string;
  wishlist: SearchResult[];
  history: HistoryEntry[];
  setApiUrl: (url: string) => void;
  toggleWishlist: (media: SearchResult) => void;
  remember: (entry: Omit<HistoryEntry, "updatedAt">) => void;
  clearHistory: () => void;
  removeFromHistory: (keys: string[]) => void;
}

export const useLibrary = create<Library>()(
  persist(
    (set) => ({
      ...createWatchStatus(set),
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
      removeFromHistory: (keys) => {
        const selected = new Set(keys);
        set((state) => ({
          history: state.history.filter(
            (item) => !selected.has(mediaKey(item.media)),
          ),
        }));
      },
    }),
    { name: "horus-desktop-library", version: 1 },
  ),
);
