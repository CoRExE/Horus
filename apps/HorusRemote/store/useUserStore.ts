import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Episode } from '@horus/core';

export interface MediaItem {
  id: string | number;
  title: string;
  imageUrl: string;
  type: 'movie' | 'series';
}

export interface HistoryItem extends MediaItem {
  timestamp: number;
  lastEpisode?: Episode;
}

interface UserStore {
  history: HistoryItem[];
  wishlist: MediaItem[];
  addToWishlist: (media: MediaItem) => void;
  removeFromWishlist: (mediaId: string | number) => void;
  toggleWishlist: (media: MediaItem) => void;
  addToHistory: (media: MediaItem, episodeDetails?: { lastEpisode?: Episode }) => void;
  clearHistory: () => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set, get) => ({
      history: [],
      wishlist: [],

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
    }),
    {
      name: 'horus-user-storage', // Clé unique pour AsyncStorage
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
