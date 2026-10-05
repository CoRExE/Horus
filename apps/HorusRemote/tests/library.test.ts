import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createWatchStatus, createWishlist, groupLibraryMedia, watchedMediaKey } from '../../../packages/core/src/library.ts';

const movie = { id: '42', type: 'movie', providerId: 'vidzy', title: 'Film' } as const;
const series = { ...movie, type: 'series', title: 'Série' } as const;
const anime = { ...movie, type: 'anime', providerId: 'anime-sama', title: 'Animé' } as const;

test('les favoris distinguent le film et la série du même ID et conservent les anciennes entrées', async () => {
  type Media = typeof movie | typeof series;
  type State = ReturnType<typeof createWishlist<Media>>;
  let stored = JSON.stringify({ state: { wishlist: [series] }, version: 0 });
  const storage = createJSONStorage(() => ({ getItem: async () => stored, setItem: async (_key, value) => { stored = value; }, removeItem: async () => {} }));
  const store = createStore<State>()(persist(set => createWishlist<Media>(set), { name: 'horus-user-storage', storage, skipHydration: true }));
  await store.persist.rehydrate();
  store.getState().addToWishlist(movie);
  assert.deepEqual(store.getState().wishlist, [series, movie]);
  store.getState().toggleWishlist(movie);
  assert.deepEqual(store.getState().wishlist, [series]);
  store.getState().addToWishlist(movie);
  store.getState().removeFromWishlist(series);
  assert.deepEqual(store.getState().wishlist, [movie]);
  assert.equal(store.getState().wishlist[0].id, '42');
});

test('Ma liste regroupe Films, Séries, Animés sans perdre ni réordonner les titres de chaque catégorie', () => {
  const second = { ...movie, id: '43' };
  const items = [anime, movie, series, second];
  assert.deepEqual(groupLibraryMedia(items).map(group => [group.title, group.items]), [
    ['Films', [movie, second]], ['Séries', [series]], ['Animés', [anime]],
  ]);
  assert.deepEqual(items, [anime, movie, series, second]);
  assert.deepEqual(groupLibraryMedia([]), []);
  assert.deepEqual(groupLibraryMedia([anime]).map(group => group.title), ['Animés']);
});

test('le statut vu migre sans modifier les anciennes listes, persiste et distingue type et fournisseur', async () => {
  const previous = {
    wishlist: [movie, series, anime], history: [{ ...series, lastEpisode: { id: 'ep2', number: 2 } }],
    offlineMedia: [{ id: 'offline' }], pendingOfflineDownload: { episode: { id: 'pending' } }, apiUrl: 'https://catalogue.invalid',
  };
  type State = typeof previous & ReturnType<typeof createWatchStatus>;
  let stored = JSON.stringify({ state: previous, version: 0 });
  const storage = createJSONStorage(() => ({ getItem: async () => stored, setItem: async (_key, value) => { stored = value; }, removeItem: async () => {} }));
  const create = () => createStore<State>()(persist(set => ({
    ...previous, wishlist: [], history: [], offlineMedia: [], ...createWatchStatus(set),
  }), { name: 'horus-user-storage', storage, skipHydration: true }));
  const first = create();
  await first.persist.rehydrate();
  assert.deepEqual(first.getState().watchedMedia, {});
  first.getState().toggleWatched(movie);
  const saved = JSON.parse(stored).state;
  for (const [key, value] of Object.entries(previous)) assert.deepEqual(saved[key], value);
  const reopened = create();
  await reopened.persist.rehydrate();
  assert.deepEqual(reopened.getState().watchedMedia, { [watchedMediaKey(movie)]: true });
  reopened.getState().toggleWatched(anime);
  reopened.getState().toggleWatched(series);
  assert.equal(Object.keys(reopened.getState().watchedMedia).length, 3);
  reopened.getState().toggleWatched({ ...movie, id: 42, providerId: undefined });
  assert.equal(reopened.getState().watchedMedia[watchedMediaKey(movie)], undefined);
  assert.equal(reopened.getState().watchedMedia[watchedMediaKey(anime)], true);
  assert.equal(reopened.getState().watchedMedia[watchedMediaKey(series)], true);
});
