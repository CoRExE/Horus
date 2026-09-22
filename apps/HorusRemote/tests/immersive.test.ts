import assert from 'node:assert/strict';
import test from 'node:test';
import { setupImmersiveNavigation } from '../services/immersiveLifecycle.ts';

test('la navigation est masquée au démarrage, au retour actif et au focus ; les abonnements sont retirés', () => {
  const callbacks = new Map<string, (state?: string) => void>();
  let hides = 0;
  const remove = setupImmersiveNavigation((event, callback) => {
    callbacks.set(event, callback);
    return () => { callbacks.delete(event); };
  }, () => { hides++; });
  assert.equal(hides, 1);
  callbacks.get('change')?.('background');
  assert.equal(hides, 1);
  callbacks.get('change')?.('active');
  callbacks.get('focus')?.();
  assert.equal(hides, 3);
  remove();
  assert.equal(callbacks.size, 0);
});
