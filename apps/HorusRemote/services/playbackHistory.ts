import type { VideoPlayer } from 'expo-video';
import { resumePosition } from './history.ts';

export function trackPlaybackHistory(player: VideoPlayer, options: {
  resumeAt: number;
  started: () => void;
  progress: (position: number, duration: number) => void;
}) {
  let started = false;
  let restored = false;
  let awaitingSeek = false;
  let ended = false;
  let lastProgress: { position: number; duration: number } | undefined;
  const restore = () => {
    if (restored || !(player.duration > 0)) return;
    restored = true;
    const position = resumePosition(options.resumeAt, player.duration);
    if (position > 0) {
      try {
        player.currentTime = position;
        awaitingSeek = true;
      } catch {
        // Unsupported seeks must not prevent playback.
      }
    }
  };
  const start = () => {
    ended = false;
    restore();
    if (!started) { started = true; options.started(); }
  };
  const flush = () => {
    if (!started || !restored) return;
    try {
      if (awaitingSeek && player.currentTime === 0) return;
      awaitingSeek = false;
      const duration = player.duration;
      const position = ended ? duration : player.currentTime;
      if (Number.isFinite(position) && position >= 0 && Number.isFinite(duration) && duration > 0) {
        lastProgress = { position, duration };
      }
    } catch {
      // Expo may already have released the native player during unmount.
    }
    if (lastProgress) options.progress(lastProgress.position, lastProgress.duration);
  };
  const interval = player.timeUpdateEventInterval;
  player.timeUpdateEventInterval = 5;
  const subscriptions = [
    player.addListener('sourceLoad', restore),
    player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') restore(); if (status === 'error') flush(); }),
    player.addListener('playingChange', ({ isPlaying }) => { if (isPlaying) start(); else flush(); }),
    player.addListener('timeUpdate', () => { restore(); flush(); }),
    player.addListener('playToEnd', () => { ended = true; flush(); }),
  ];
  restore();
  if (player.playing) start();
  return {
    flush,
    dispose: () => {
      flush();
      subscriptions.forEach(subscription => subscription.remove());
      try { player.timeUpdateEventInterval = interval; } catch { /* Native player already released. */ }
    },
  };
}
