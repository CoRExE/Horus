import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createCatalogSettings, normalizeCatalogUrl } from '../services/catalogSettings.ts';

test('normaliser une adresse de worker HTTPS ou une API HTTP locale ; refuser les autres saisies', () => {
  assert.equal(normalizeCatalogUrl('  https://catalogue.example/  '), 'https://catalogue.example');
  assert.equal(normalizeCatalogUrl('http://192.168.1.42:8787/'), 'http://192.168.1.42:8787');
  for (const value of ['', 'worker', 'ftp://host', 'javascript:alert(1)', 'https://']) {
    assert.throws(() => normalizeCatalogUrl(value), /URL HTTP ou HTTPS valide/);
  }
});

test('l’ancien stockage reçoit une adresse vide sans perdre ses données ; enregistrer survit au redémarrage', async () => {
  const previous = {
    history: [{ id: '42', title: 'Historique' }],
    wishlist: [{ id: '43', title: 'Favori' }],
    offlineMedia: [{ id: 'offline-44' }],
    pendingOfflineDownload: { episode: { id: '45' }, language: 'VF' },
  };
  type State = Omit<typeof previous, 'pendingOfflineDownload'> & { pendingOfflineDownload: typeof previous.pendingOfflineDownload | null } & ReturnType<typeof createCatalogSettings>;
  let stored = JSON.stringify({ state: previous, version: 0 });
  const storage = createJSONStorage(() => ({
    getItem: async () => stored,
    setItem: async (_key, value) => { stored = value; },
    removeItem: async () => { stored = ''; },
  }));
  const create = () => createStore<State>()(persist(set => ({
    history: [], wishlist: [], offlineMedia: [], pendingOfflineDownload: null,
    ...createCatalogSettings(set),
  }), { name: 'horus-user-storage', storage, skipHydration: true }));
  const first = create();
  await first.persist.rehydrate();
  assert.equal(first.getState().apiUrl, '');
  first.getState().setApiUrl(' https://catalogue.example/ ');
  const saved = JSON.parse(stored).state;
  for (const [key, value] of Object.entries(previous)) assert.deepEqual(saved[key], value);
  assert.equal(saved.apiUrl, 'https://catalogue.example');
  assert.throws(() => first.getState().setApiUrl('incorrect'), /URL HTTP/);
  assert.equal(first.getState().apiUrl, saved.apiUrl, 'Invalid input must not overwrite the current address');
  const reopened = create();
  await reopened.persist.rehydrate();
  assert.equal(reopened.getState().apiUrl, 'https://catalogue.example');
  assert.deepEqual(reopened.getState().history, previous.history);
});
