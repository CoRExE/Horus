import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createHistory, historyMediaKey, historyResumeAt, resumeHistoryOnRemote, resumePosition } from '../services/history.ts';
import type { HistoryItem } from '../store/useUserStore';

const movie = { id: '42', type: 'movie', providerId: 'vidzy', title: 'Film', imageUrl: '' } as const;
const series = { ...movie, type: 'series', title: 'Série' } as const;
const anime = { ...movie, type: 'anime', providerId: 'anime-sama', title: 'Animé' } as const;
const episode = { id: 'ep2', number: 2 };

test('la reprise TV demande la position mémorisée seulement si le flux permet le seek ; un refus ne bloque pas la lecture', async () => {
  const history: HistoryItem[] = [{ ...series, timestamp: 1, lastEpisode: episode, position: 40, duration: 100 }];
  const positions: number[] = [];
  const seek = async (position: number) => { positions.push(position); };
  await resumeHistoryOnRemote(history, series, episode, true, seek);
  assert.deepEqual(positions, [40]);
  await resumeHistoryOnRemote(history, series, episode, false, seek);
  await resumeHistoryOnRemote(history, series, { id: 'next', number: 3 }, true, seek);
  assert.deepEqual(positions, [40]);
  const notice = await resumeHistoryOnRemote(history, series, episode, true, async () => { throw new Error('Seek unsupported'); });
  assert.match(notice!, /La lecture reste disponible/);
});

test('la suppression ciblée persiste sans modifier Ma Liste, Vu et les téléchargements ; les anciens historiques restent lisibles', async () => {
  const previous = { history: [movie, series, anime].map((item, index) => ({ ...item, timestamp: index, lastEpisode: episode })), wishlist: [movie], watchedMedia: { marker: true }, offlineMedia: [{ id: 'download' }], apiUrl: 'https://catalogue.invalid' };
  type State = Omit<typeof previous, 'history'> & ReturnType<typeof createHistory>;
  let stored = JSON.stringify({ state: previous, version: 0 });
  const storage = createJSONStorage(() => ({ getItem: async () => stored, setItem: async (_key, value) => { stored = value; }, removeItem: async () => {} }));
  const create = () => createStore<State>()(persist(set => ({ ...previous, ...createHistory(set) }), { name: 'horus-user-storage', storage, skipHydration: true }));
  const first = create();
  await first.persist.rehydrate();
  assert.deepEqual(first.getState().history, previous.history);
  first.getState().removeFromHistory([]);
  assert.equal(first.getState().history.length, 3);
  first.getState().removeFromHistory([historyMediaKey(movie), historyMediaKey(anime)]);
  assert.deepEqual(first.getState().history, [previous.history[1]]);
  const saved = JSON.parse(stored).state;
  for (const key of ['wishlist', 'watchedMedia', 'offlineMedia', 'apiUrl'] as const) assert.deepEqual(saved[key], previous[key]);
  const reopened = create();
  await reopened.persist.rehydrate();
  assert.deepEqual(reopened.getState().history, [previous.history[1]]);
  reopened.getState().updateHistoryProgress(movie, episode, 30, 100);
  assert.equal(reopened.getState().history.length, 1, 'A delayed update must not recreate a deleted entry');
  reopened.getState().removeFromHistory(reopened.getState().history.map(historyMediaKey));
  assert.deepEqual(reopened.getState().history, []);
});

test('la progression reprend le même épisode sans effacer sa position au démarrage ; un autre épisode repart de zéro', () => {
  const store = createStore<ReturnType<typeof createHistory>>(set => createHistory(set));
  store.getState().addToHistory(series, { lastEpisode: episode });
  store.getState().updateHistoryProgress(series, episode, 120, 600);
  store.getState().addToHistory(series, { lastEpisode: episode });
  assert.equal(historyResumeAt(store.getState().history, series, episode), 120);
  const next = { id: 'ep3', number: 3 };
  assert.equal(historyResumeAt(store.getState().history, series, next), 0);
  store.getState().addToHistory(series, { lastEpisode: next });
  store.getState().updateHistoryProgress(series, episode, 400, 600);
  assert.equal(store.getState().history[0].position, 0, 'Late progress from the previous episode must be ignored');
  store.getState().updateHistoryProgress(series, next, NaN, 600);
  assert.equal(store.getState().history[0].position, 0);
  store.getState().updateHistoryProgress(series, next, 598, 600);
  assert.equal(historyResumeAt(store.getState().history, series, next), 0);
});

test('les anciennes clés infèrent leur fournisseur sans confondre types, et les films sans épisode peuvent reprendre', () => {
  assert.equal(historyMediaKey({ id: 12, type: 'movie' }), historyMediaKey({ id: '12', type: 'movie', providerId: 'french-stream' }));
  assert.equal(historyMediaKey({ id: '/catalogue/test', type: 'anime' }), historyMediaKey({ id: '/catalogue/test', type: 'anime', providerId: 'anime-sama' }));
  const history: HistoryItem[] = [{ ...movie, timestamp: 1, position: 40, duration: 100 }];
  assert.equal(historyResumeAt(history, movie, episode), 40);
  assert.equal(historyResumeAt(history, series, episode), 0);
  assert.equal(resumePosition(0, 100), 0);
  assert.equal(resumePosition(98, 100), 0);
  assert.equal(resumePosition(50, 0), 0);
  assert.equal(resumePosition(8, 10), 8);
});
