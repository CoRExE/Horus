import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Episode, ProviderId, SearchResult } from '@horus/core';

export interface MediaItem {
  id: string | number;
  title: string;
  imageUrl: string;
  type: SearchResult['type'];
  providerId?: ProviderId;
}

export interface HistoryItem extends MediaItem {
  timestamp: number;
  lastEpisode?: Episode;
}

export interface OfflineMediaItem {
  id: string;
  media: MediaItem;
  episode: Episode;
  title: string;
  language: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds?: number;
  seekable: boolean;
  downloadedAt: number;
}

export interface PendingOfflineDownload {
  media: MediaItem;
  episode: Episode;
  quality: 720 | 1080;
  requestedAt: number;
}

interface UserStore {
  history: HistoryItem[];
  wishlist: MediaItem[];
  offlineMedia: OfflineMediaItem[];
  pendingOfflineDownload: PendingOfflineDownload | null;
  addToWishlist: (media: MediaItem) => void;
  removeFromWishlist: (mediaId: string | number) => void;
  toggleWishlist: (media: MediaItem) => void;
  addToHistory: (media: MediaItem, episodeDetails?: { lastEpisode?: Episode }) => void;
  clearHistory: () => void;
  addOfflineMedia: (item: OfflineMediaItem) => void;
  removeOfflineMedia: (id: string) => void;
  setPendingOfflineDownload: (download: PendingOfflineDownload | null) => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set, get) => ({
      history: [],
      wishlist: [],
      offlineMedia: [],
      pendingOfflineDownload: null,

      addToWishlist: (media) => {
        const { wishlist } = get();
        if (!wishlist.some((item) => item.id === media.id)) {
          set({ wishlist: [...wishlist, media] });
        }
      },

      removeFromWishlist: (mediaId) => {
        set((state) => ({
          wishlist: state.wishlist.filter((item) => item.id !== mediaId),
        }));
      },

      toggleWishlist: (media) => {
        const { wishlist, addToWishlist, removeFromWishlist } = get();
        const isInWishlist = wishlist.some((item) => item.id === media.id);
        if (isInWishlist) {
          removeFromWishlist(media.id);
        } else {
          addToWishlist(media);
        }
      },

      addToHistory: (media, episodeDetails) => {
        set((state) => {
          // Retire l'élément s'il existe déjà pour éviter les doublons
          const filteredHistory = state.history.filter((item) => item.id !== media.id);
          
          const newHistoryItem: HistoryItem = {
            ...media,
            timestamp: Date.now(),
            ...(episodeDetails && { lastEpisode: episodeDetails.lastEpisode }),
          };

          // On place l'élément le plus récent en premier
          return {
            history: [newHistoryItem, ...filteredHistory],
          };
        });
      },

      clearHistory: () => {
        set({ history: [] });
      },

      addOfflineMedia: (item) => {
        set((state) => ({
          offlineMedia: [
            item,
            ...state.offlineMedia.filter(existing =>
              existing.media.id !== item.media.id || existing.episode.id !== item.episode.id
            ),
          ],
        }));
      },

      removeOfflineMedia: (id) => {
        set((state) => ({
          offlineMedia: state.offlineMedia.filter(item => item.id !== id),
        }));
      },

      setPendingOfflineDownload: (download) => {
        set({ pendingOfflineDownload: download });
      },
    }),
    {
      name: 'horus-user-storage', // Clé unique pour AsyncStorage
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
