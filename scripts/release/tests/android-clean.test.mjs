import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { cleanAndroid } from '../clean-android.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'horus-clean-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function file(root, relative) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, 'fixture');
  return target;
}

test('retire les sorties Android et CMake, préserve sources, configuration, clés et dépendances', t => {
  const root = fixture(t);
  const outputs = ['android/build', 'android/app/build', 'android/.cxx', 'android/app/.cxx', 'modules/local-video-proxy/android/build', 'modules/local-video-proxy/android/.cxx'];
  for (const path of outputs) file(root, `${path}/generated`);
  const preserved = ['android/app/src/main/AndroidManifest.xml', 'android/app/debug.keystore', 'android/local.properties', 'android/gradlew', 'android/.gradle/cache', '.env', 'credentials.json', 'credentials/android/keystore.jks', 'modules/local-video-proxy/android/src/main/source.kt', 'node_modules/package/index.js'];
  for (const path of preserved) file(root, path);
  assert.deepEqual(cleanAndroid(root), outputs);
  for (const path of outputs) assert.equal(existsSync(join(root, path)), false);
  for (const path of preserved) assert.equal(readFileSync(join(root, path), 'utf8'), 'fixture');
  assert.deepEqual(cleanAndroid(root), []);
});

test('fonctionne avant tout prebuild sans créer de projet Android', t => {
  const root = fixture(t);
  assert.deepEqual(cleanAndroid(root), []);
  assert.equal(existsSync(join(root, 'android')), false);
});

test('ne suit pas les liens symboliques vers des fichiers externes', t => {
  const root = fixture(t);
  const outside = fixture(t);
  const kept = file(outside, 'build/keep');
  symlinkSync(outside, join(root, 'android'), 'junction');
  assert.throws(() => cleanAndroid(root), /dossier parent lié/);
  assert.equal(readFileSync(kept, 'utf8'), 'fixture');
  rmSync(join(root, 'android'));
  mkdirSync(join(root, 'android'));
  symlinkSync(join(outside, 'build'), join(root, 'android/build'), 'junction');
  assert.deepEqual(cleanAndroid(root), ['android/build']);
  assert.equal(readFileSync(kept, 'utf8'), 'fixture');
});
