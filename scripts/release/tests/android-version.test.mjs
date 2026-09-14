import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function fixture(t, code = 25) {
  const directory = mkdtempSync(join(tmpdir(), 'horus-android-version-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = JSON.parse(readFileSync(join(root, 'apps/HorusRemote/.release-it.json')));
  config.git = false;
  config.plugins = Object.fromEntries(Object.entries(config.plugins).map(([name, options]) =>
    [resolve(root, 'apps/HorusRemote', name), options]));
  const app = JSON.parse(readFileSync(join(root, 'apps/HorusRemote/app.json')));
  app.expo.version = '1.4.1';
  app.expo.android.versionCode = code;
  const manifest = { name: 'horus-version-fixture', version: app.expo.version, private: true };
  for (const [file, value] of Object.entries({ 'app.json': app, 'package.json': manifest, '.release-it.json': config })) {
    writeFileSync(join(directory, file), JSON.stringify(value));
  }
  return {
    app,
    manifest,
    read: (file) => JSON.parse(readFileSync(join(directory, file))),
    run: (version) => spawnSync(process.execPath, [join(root, 'node_modules/release-it/bin/release-it.js'), version, '--ci'], {
      cwd: directory, encoding: 'utf8', timeout: 30000,
    }),
  };
}

test('release-it synchronise Expo et package.json sans bloc iOS et conserve les réglages Android', (t) => {
  const f = fixture(t);
  assert.equal(Object.hasOwn(f.app.expo, 'ios'), false);
  const run = f.run('1.4.2');
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const expected = structuredClone(f.app);
  expected.expo.version = '1.4.2';
  expected.expo.android.versionCode = 26;
  assert.deepEqual(f.read('app.json'), expected);
  assert.deepEqual(f.read('package.json'), { ...f.manifest, version: '1.4.2' });
});

test('release-it refuse un compteur Android invalide sans modifier les fichiers', (t) => {
  for (const code of [null, '25', 0, 1.5, 2100000000]) {
    const f = fixture(t, code);
    const run = f.run('1.4.2');
    assert.notEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /versionCode Android invalide/);
    assert.deepEqual(f.read('app.json'), f.app);
    assert.deepEqual(f.read('package.json'), f.manifest);
  }
});

test('release-it refuse une préversion non distribuable par les workflows', (t) => {
  const f = fixture(t);
  const run = f.run('1.4.2-beta.1');
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}\n${run.stderr}`, /version stable/);
  assert.deepEqual(f.read('app.json'), f.app);
  assert.deepEqual(f.read('package.json'), f.manifest);
});
