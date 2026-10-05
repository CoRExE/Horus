import type { Episode } from '@horus/core';
import type { HistoryItem, MediaItem } from '../store/useUserStore';

export function historyMediaKey(media: Pick<MediaItem, 'id' | 'type' | 'providerId'>) {
  const id = String(media.id);
  const provider = media.providerId ?? (id.includes('catalogue') ? 'anime-sama'
    : media.type !== 'anime' && /^\d+$/.test(id) ? 'french-stream' : 'all-anime');
  return JSON.stringify([provider, media.type, id]);
}

export function sameHistoryEpisode(entry: HistoryItem, episode?: Episode) {
  return entry.type === 'movie' || Boolean(episode && entry.lastEpisode?.id === episode.id);
}

export function resumePosition(position = 0, duration = 0) {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || position <= 0 || duration <= 0) return 0;
  return position < duration - Math.min(5, duration * 0.05) ? position : 0;
}

export function historyResumeAt(history: HistoryItem[], media: Pick<MediaItem, 'id' | 'type' | 'providerId'>, episode: Episode) {
  const entry = history.find(item => historyMediaKey(item) === historyMediaKey(media));
  return entry && sameHistoryEpisode(entry, episode) ? resumePosition(entry.position, entry.duration) : 0;
}

export async function resumeHistoryOnRemote(history: HistoryItem[], media: Pick<MediaItem, 'id' | 'type' | 'providerId'>, episode: Episode, canSeek: boolean, seek: (position: number) => Promise<unknown>) {
  const position = historyResumeAt(history, media, episode);
  if (!canSeek || !position) return undefined;
  try { await seek(position); }
  catch { return 'La TV n’a pas accepté la reprise à la position mémorisée. La lecture reste disponible.'; }
  return undefined;
}

interface HistoryState { history: HistoryItem[] }
export function createHistory(set: (update: (state: HistoryState) => HistoryState) => void) {
  return {
    history: [] as HistoryItem[],
    addToHistory: (media: MediaItem, details?: { lastEpisode?: Episode }) => set(state => {
      const key = historyMediaKey(media);
      const previous = state.history.find(item => historyMediaKey(item) === key);
      const keepPosition = previous && sameHistoryEpisode(previous, details?.lastEpisode);
      const entry: HistoryItem = {
        ...media, timestamp: Date.now(), lastEpisode: details?.lastEpisode,
        position: keepPosition ? previous.position : 0,
        duration: keepPosition ? previous.duration : 0,
      };
      return { history: [entry, ...state.history.filter(item => historyMediaKey(item) !== key)] };
    }),
    updateHistoryProgress: (media: Pick<MediaItem, 'id' | 'type' | 'providerId'>, episode: Episode, position: number, duration: number) => set(state => {
      if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration <= 0) return state;
      // A delayed progress event must not recreate a deleted entry or replace a newer episode.
      return { history: state.history.map(item => historyMediaKey(item) === historyMediaKey(media) && sameHistoryEpisode(item, episode)
        ? { ...item, position: Math.min(position, duration), duration } : item) };
    }),
    removeFromHistory: (keys: string[]) => set(state => {
      const selected = new Set(keys);
      return { history: state.history.filter(item => !selected.has(historyMediaKey(item))) };
    }),
    clearHistory: () => set(() => ({ history: [] })),
  };
}
