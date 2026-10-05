import type { SearchResult } from './types';

type LibraryMedia = Pick<SearchResult, 'type'> & {
  id: string | number;
  providerId?: SearchResult['providerId'];
};

export function watchedMediaKey(media: LibraryMedia): string {
  const provider = media.providerId ?? (media.type === 'anime' ? 'anime-sama' : 'vidzy');
  return JSON.stringify([provider, media.type, String(media.id)]);
}

export function createWishlist<T extends LibraryMedia>(set: (update: (state: { wishlist: T[] }) => { wishlist: T[] }) => void) {
  const same = (left: T, right: T) => watchedMediaKey(left) === watchedMediaKey(right);
  return {
    wishlist: [] as T[],
    addToWishlist: (media: T) => set(state => ({
      wishlist: state.wishlist.some(item => same(item, media)) ? state.wishlist : [...state.wishlist, media],
    })),
    removeFromWishlist: (media: T) => set(state => ({
      wishlist: state.wishlist.filter(item => !same(item, media)),
    })),
    toggleWishlist: (media: T) => set(state => ({
      wishlist: state.wishlist.some(item => same(item, media))
        ? state.wishlist.filter(item => !same(item, media)) : [...state.wishlist, media],
    })),
  };
}

interface WatchStatus {
  watchedMedia: Record<string, boolean>;
}

export function createWatchStatus(set: (update: (state: WatchStatus) => WatchStatus) => void) {
  return {
    watchedMedia: {} as WatchStatus['watchedMedia'],
    toggleWatched: (media: LibraryMedia) => set(state => {
      const watchedMedia = { ...state.watchedMedia };
      const key = watchedMediaKey(media);
      if (watchedMedia[key]) delete watchedMedia[key];
      else watchedMedia[key] = true;
      return { watchedMedia };
    }),
  };
}

export function groupLibraryMedia<T extends Pick<SearchResult, 'type'>>(items: T[]) {
  return ([
    { type: 'movie', title: 'Films' },
    { type: 'series', title: 'Séries' },
    { type: 'anime', title: 'Animés' },
  ] as const).map(category => ({
    ...category,
    items: items.filter(item => item.type === category.type),
  })).filter(category => category.items.length > 0);
}
