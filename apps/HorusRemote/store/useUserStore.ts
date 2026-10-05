import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createCatalogSettings } from '../services/catalogSettings';
import { createHistory } from '../services/history';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createWatchStatus, createWishlist, Episode, ProviderId, SearchResult } from '@horus/core';

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
  position?: number;
  duration?: number;
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
  language?: string;
  media: MediaItem;
  episode: Episode;
  quality: 720 | 1080;
  requestedAt: number;
}

interface UserStore extends ReturnType<typeof createCatalogSettings>, ReturnType<typeof createWatchStatus>, ReturnType<typeof createHistory>, ReturnType<typeof createWishlist<MediaItem>> {
  offlineMedia: OfflineMediaItem[];
  pendingOfflineDownload: PendingOfflineDownload | null;
  addOfflineMedia: (item: OfflineMediaItem) => void;
  removeOfflineMedia: (id: string) => void;
  setPendingOfflineDownload: (download: PendingOfflineDownload | null) => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      ...createWatchStatus(set),
      ...createHistory(set),
      ...createCatalogSettings(set),
      ...createWishlist<MediaItem>(set),
      offlineMedia: [],
      pendingOfflineDownload: null,

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
