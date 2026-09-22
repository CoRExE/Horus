import type { SearchResult } from './types';

type LibraryMedia = Pick<SearchResult, 'type'> & {
  id: string | number;
  providerId?: SearchResult['providerId'];
};

export function watchedMediaKey(media: LibraryMedia): string {
  const provider = media.providerId ?? (media.type === 'anime' ? 'anime-sama' : 'vidzy');
  return JSON.stringify([provider, media.type, String(media.id)]);
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
