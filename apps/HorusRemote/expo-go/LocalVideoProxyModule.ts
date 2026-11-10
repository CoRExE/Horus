// Expo Go substitute for the custom LocalVideoProxy module (selected by metro.config.js
// when HORUS_EXPO_GO=1). It lets the UI render; local relay, TV cache and offline
// playback stay unavailable.
const unavailable = (feature: string) => () =>
  Promise.reject(new Error(`${feature} nécessite un build natif (indisponible dans Expo Go).`));
const noop = () => Promise.resolve();

export default {
  resolveVidzySession: unavailable('La session Vidzy'),
  startServer: unavailable('Le relais vidéo local'),
  stopServer: noop,
  getLastError: () => Promise.resolve(null),
  setTvNotificationMode: noop,
  updateTvPlaybackState: noop,
  updateTvCacheProgress: noop,
  cacheMedia: unavailable('Le cache média TV'),
  cancelCache: noop,
  removeCachedMedia: noop,
  persistCachedMedia: noop,
  getOfflineMediaUri: unavailable('La lecture hors ligne'),
  removeOfflineMedia: noop,
  listOfflineMediaIds: () => Promise.resolve([] as string[]),
  clearCache: noop,
  acquireMulticastLock: noop,
  releaseMulticastLock: noop,
  exitApp: noop,
  addListener: () => ({ remove() {} }),
  removeAllListeners: () => {},
};
