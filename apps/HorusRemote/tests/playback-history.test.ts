import assert from 'node:assert/strict';
import test from 'node:test';
import type { VideoPlayer } from 'expo-video';
import { trackPlaybackHistory } from '../services/playbackHistory.ts';

function fixture() {
  const listeners = new Map<string, Set<(event?: any) => void>>();
  const player = {
    currentTime: 0, duration: 0, playing: false, timeUpdateEventInterval: 0,
    addListener: (name: string, callback: (event?: any) => void) => {
      const list = listeners.get(name) ?? new Set();
      list.add(callback); listeners.set(name, list);
      return { remove: () => list.delete(callback) };
    },
  };
  const progress: number[][] = [];
  let starts = 0;
  const track = (resumeAt = 120) => trackPlaybackHistory(player as unknown as VideoPlayer, {
    resumeAt, started: () => { starts++; }, progress: (position, duration) => progress.push([position, duration]),
  });
  return { player, progress, track, starts: () => starts, listeners, emit: (name: string, event?: any) => listeners.get(name)?.forEach(fn => fn(event)) };
}

test('attend les métadonnées, restaure une fois, sauvegarde aux pauses et à la fermeture puis désabonne', () => {
  const f = fixture(); const tracker = f.track();
  f.emit('playingChange', { isPlaying: true });
  f.emit('timeUpdate');
  assert.deepEqual(f.progress, []);
  f.player.duration = 600; f.emit('sourceLoad');
  assert.equal(f.player.currentTime, 120);
  f.player.currentTime = 150; f.emit('timeUpdate');
  f.emit('statusChange', { status: 'readyToPlay' });
  assert.equal(f.player.currentTime, 150);
  f.player.currentTime = 153; f.emit('playingChange', { isPlaying: false });
  assert.deepEqual(f.progress.at(-1), [153, 600]);
  f.emit('playingChange', { isPlaying: true });
  assert.equal(f.starts(), 1);
  f.player.currentTime = 155; tracker.dispose();
  assert.deepEqual(f.progress.at(-1), [155, 600]);
  assert.equal(f.player.timeUpdateEventInterval, 0);
  assert.equal([...f.listeners.values()].every(list => list.size === 0), true);
});

test('une fin de lecture reste terminée même si le lecteur remet sa position à zéro', () => {
  const f = fixture(); f.player.duration = 600; f.player.playing = true;
  const tracker = f.track(599);
  assert.equal(f.player.currentTime, 0);
  f.player.currentTime = 600; f.emit('playToEnd');
  f.player.currentTime = 0; tracker.dispose();
  assert.deepEqual(f.progress.at(-1), [600, 600]);
});

test('fermeture avant lecture sans écriture ; fermeture après libération native conserve la dernière progression', () => {
  const unopened = fixture(); unopened.player.duration = 600;
  unopened.track().dispose(); assert.deepEqual(unopened.progress, []);
  const f = fixture(); f.player.duration = 600; f.player.playing = true;
  const tracker = f.track(0); f.player.currentTime = 45; f.emit('timeUpdate');
  Object.defineProperty(f.player, 'currentTime', { get: () => { throw new Error('released'); } });
  tracker.dispose();
  assert.deepEqual(f.progress.at(-1), [45, 600]);
});
