import assert from 'node:assert/strict';
import test from 'node:test';
import { runDownloadBatch } from '../services/downloadBatch.ts';

test('le lot attend la fin de chaque opération et poursuit après un échec sans changer l’ordre', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started: number[] = [];
  const progress: number[] = [];
  const result = runDownloadBatch([1, 2, 3], async episode => {
    started.push(episode);
    if (episode === 1) await gate;
    if (episode === 2) return 'VF indisponible';
  }, () => false, (_episode, index) => progress.push(index));
  assert.deepEqual(started, [1]);
  release();
  assert.deepEqual(await result, { completed: 2, failures: [{ item: 2, error: 'VF indisponible' }], cancelled: false });
  assert.deepEqual(started, [1, 2, 3]);
  assert.deepEqual(progress, [1, 2, 3]);
});

test('annuler pendant le nettoyage ne démarre aucun épisode restant', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let cancelled = false;
  const started: number[] = [];
  const result = runDownloadBatch([1, 2, 3], async episode => {
    started.push(episode);
    await gate;
    return 'Annulé';
  }, () => cancelled, () => {});
  cancelled = true;
  release();
  assert.deepEqual(await result, { completed: 0, failures: [], cancelled: true });
  assert.deepEqual(started, [1]);
});

test('une exception ne bloque pas les suivants ; un lot déjà annulé ne télécharge rien', async () => {
  const result = await runDownloadBatch([1, 2], async episode => {
    if (episode === 1) throw new Error('Serveur indisponible');
    return undefined;
  }, () => false, () => {});
  assert.equal(result.completed, 1);
  assert.deepEqual(result.failures, [{ item: 1, error: 'Serveur indisponible' }]);
  await runDownloadBatch([1], async () => assert.fail('Unexpected download'), () => true, () => assert.fail('Unexpected progress'));
});
