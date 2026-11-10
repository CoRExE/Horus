// Expo Go substitute for react-native-google-cast (selected by metro.config.js when
// HORUS_EXPO_GO=1): no Cast device is ever discovered or connected.
const unavailable = () =>
  Promise.reject(new Error('Google Cast nécessite un build natif (indisponible dans Expo Go).'));

export enum MediaPlayerState {
  BUFFERING = 'buffering',
  IDLE = 'idle',
  LOADING = 'loading',
  PAUSED = 'paused',
  PLAYING = 'playing',
}

export enum MediaPlayerIdleReason {
  CANCELLED = 'cancelled',
  ERROR = 'error',
  FINISHED = 'finished',
  INTERRUPTED = 'interrupted',
}

export class RemoteMediaClient {}

export const CastContext = {
  getSessionManager: () => ({
    startSession: unavailable,
    endCurrentSession: () => Promise.resolve(),
  }),
};

export const useCastSession = () => null;
export const useDevices = () => [];
export const useRemoteMediaClient = () => null;
