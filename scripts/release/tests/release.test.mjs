import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseTag, validateVersion, expectedAssets } from '../version.mjs';

const root = resolve(import.meta.dirname, '../../..');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'horus-release-test-'));
  for (const file of ['scripts/release/android-baseline.json', 'apps/HorusRemote/app.json', 'apps/HorusRemote/package.json', 'apps/HorusDesktop/package.json', 'apps/HorusDesktop/src-tauri/tauri.conf.json', 'apps/HorusDesktop/src-tauri/Cargo.toml', 'apps/HorusDesktop/src-tauri/Cargo.lock']) {
    mkdirSync(join(directory, file, '..'), { recursive: true });
    cpSync(join(root, file), join(directory, file));
  }
  return directory;
}
function update(directory, path, change) {
  const file = join(directory, path);
  const content = json(file);
  change(content);
  writeFileSync(file, JSON.stringify(content));
}

test('tags stables distincts ; entrées ambiguës ou injectables refusées', () => {
  assert.deepEqual(parseTag('desktop-v1.2.3'), { tag: 'desktop-v1.2.3', platform: 'desktop', version: '1.2.3' });
  for (const tag of ['v1.2.3', 'mobile-v01.2.3', 'desktop-v1.2.3-beta', '../main', 'mobile-v1.2.3\n', '$(id)', '--help']) assert.throws(() => parseTag(tag));
});

test('les quatre versions Desktop doivent correspondre au tag', () => {
  const directory = fixture();
  const version = json(join(directory, 'apps/HorusDesktop/package.json')).version;
  const tag = `desktop-v${version}`;
  assert.equal(validateVersion(tag, directory).version, version);
  for (const path of ['apps/HorusDesktop/package.json', 'apps/HorusDesktop/src-tauri/tauri.conf.json']) {
    update(directory, path, (config) => { config.version = '9.9.9'; });
    assert.throws(() => validateVersion(tag, directory), /diffère du tag/);
    update(directory, path, (config) => { config.version = version; });
  }
  const lock = join(directory, 'apps/HorusDesktop/src-tauri/Cargo.lock');
  writeFileSync(lock, readFileSync(lock, 'utf8').replace(/(name = "horus-desktop"\nversion = ")[^"]+/, '$19.9.9'));
  assert.throws(() => validateVersion(tag, directory), /Cargo.lock/);
});

test('Android conserve son identifiant et dépasse les compteurs historiques/EAS', () => {
  const directory = fixture();
  const version = json(join(directory, 'apps/HorusRemote/package.json')).version;
  const tag = `mobile-v${version}`;
  const nextCode = json(join(directory, 'apps/HorusRemote/app.json')).expo.android.versionCode;
  assert.equal(validateVersion(tag, directory).versionCode, nextCode);
  for (const code of [24, 14, 25.5, '25', 2100000001]) {
    update(directory, 'apps/HorusRemote/app.json', (config) => { config.expo.android.versionCode = code; });
    assert.throws(() => validateVersion(tag, directory), /versionCode/);
  }
  update(directory, 'apps/HorusRemote/app.json', (config) => { config.expo.android.versionCode = nextCode; config.expo.android.package = 'other.app'; });
  assert.throws(() => validateVersion(tag, directory), /Identifiant/);
});

function githubFixture(platform = 'desktop') {
  const directory = fixture();
  const version = json(join(directory, platform === 'desktop' ? 'apps/HorusDesktop/package.json' : 'apps/HorusRemote/package.json')).version;
  const tag = `${platform}-v${version}`;
  const release = validateVersion(tag, directory);
  const bin = join(directory, 'bin');
  const assets = join(directory, 'assets');
  const remote = join(directory, 'remote');
  mkdirSync(bin); mkdirSync(assets); mkdirSync(remote);
  const names = expectedAssets(release);
  for (const name of names) writeFileSync(join(assets, name), 'installer fixture');
  const stub = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'api' && args.includes('--paginate')) console.log(JSON.stringify([JSON.parse(fs.readFileSync(process.env.MOCK_RELEASES))]));
else if (args[0] === 'api') console.log(JSON.stringify({body:'Generated notes'}));
else if (args[0] === 'release' && args[1] === 'download') {
 const dest=args[args.indexOf('--dir')+1];
 for (const name of fs.readdirSync(process.env.MOCK_REMOTE)) fs.copyFileSync(path.join(process.env.MOCK_REMOTE,name),path.join(dest,name));
}
`;
  writeFileSync(join(bin, 'gh'), stub); chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nprintf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n"\n'); chmodSync(join(bin, 'git'), 0o755);
  const listings = join(directory, 'releases.json'); writeFileSync(listings, '[]');
  const calls = join(directory, 'calls.jsonl'); writeFileSync(calls, '');
  const run = (mode, folder = assets) => spawnSync(process.execPath, [join(root, 'scripts/release/github-release.mjs'), mode, tag, folder], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'owner/repo', MOCK_CALLS: calls, MOCK_RELEASES: listings, MOCK_REMOTE: remote },
  });
  const markDraft = () => {
    for (const name of [...names, 'SHA256SUMS', 'release-info.json']) cpSync(join(assets, name), join(remote, name));
    writeFileSync(listings, JSON.stringify([{ tag_name: tag, draft: true, prerelease: false, assets: [...names, 'SHA256SUMS', 'release-info.json'].map((name) => ({ name })) }]));
  };
  const publishFolder = () => { const folder=mkdtempSync(join(directory, 'publish-')); return folder; };
  return { directory, assets, names, remote, tag, listings, calls, run, markDraft, publishFolder };
}

test('un seul installateur macOS interdit la création du brouillon', () => {
  const fixture = githubFixture();
  const folder = mkdtempSync(join(fixture.directory, 'incomplete-'));
  cpSync(join(fixture.assets, fixture.names[0]), join(folder, fixture.names[0]));
  assert.notEqual(fixture.run('draft', folder).status, 0);
  assert.ok(!readFileSync(fixture.calls, 'utf8').includes('"create"'));
});

test('un checkout différent du tag bloque toute opération GitHub', () => {
  const fixture = githubFixture();
  writeFileSync(join(fixture.directory, 'bin/git'), '#!/bin/sh\nif [ "$2" = HEAD ]; then echo aaaaaa; else echo bbbbbb; fi\n');
  const result = fixture.run('draft');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout ne correspond pas au tag/);
  assert.equal(readFileSync(fixture.calls, 'utf8'), '');
});

test('brouillon complet puis publication explicite avec sommes vérifiées, sans latest global', () => {
  const fixture = githubFixture();
  const draft = fixture.run('draft');
  assert.equal(draft.status, 0, draft.stderr);
  const calls = readFileSync(fixture.calls, 'utf8');
  assert.ok(calls.includes('"--draft"'));
  assert.ok(!calls.includes('"edit"'));
  fixture.markDraft();
  const publish = fixture.run('publish', fixture.publishFolder());
  assert.equal(publish.status, 0, publish.stderr);
  assert.ok(readFileSync(fixture.calls, 'utf8').includes('"--draft=false","--latest=false"'));
});

test('un fichier altéré bloque la publication et une release existante ne peut être écrasée', () => {
  const fixture = githubFixture();
  assert.equal(fixture.run('draft').status, 0);
  fixture.markDraft();
  assert.notEqual(fixture.run('draft').status, 0);
  writeFileSync(join(fixture.remote, fixture.names[0]), 'tampered');
  const publish = fixture.run('publish', fixture.publishFolder());
  assert.notEqual(publish.status, 0);
  assert.match(publish.stderr, /Fichier altéré/);
  assert.ok(!readFileSync(fixture.calls, 'utf8').includes('"edit"'));
});

test('un versionCode déjà publié bloque un nouveau brouillon Android', () => {
  const fixture = githubFixture('mobile');
  const code = json(join(fixture.directory, 'apps/HorusRemote/app.json')).expo.android.versionCode;
  writeFileSync(fixture.listings, JSON.stringify([{tag_name:'mobile-v1.3.0', draft:false, prerelease:false, assets:[{name:`HorusRemote-1.3.0-${code}-android.apk`}]}]));
  const result = fixture.run('draft');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /versionCode/);
});

test('EAS Update désactivé uniquement pour les nouveaux builds Android de release', async () => {
  const { default: config } = await import('../../../apps/HorusRemote/app.config.js');
  const original = process.env.HORUS_ANDROID_RELEASE;
  try {
    delete process.env.HORUS_ANDROID_RELEASE;
    assert.equal(config({config:{updates:{url:'https://example.test'}}}).updates.enabled, undefined);
    process.env.HORUS_ANDROID_RELEASE = '1';
    assert.equal(config({config:{updates:{url:'https://example.test'}}}).updates.enabled, false);
  } finally {
    if (original === undefined) delete process.env.HORUS_ANDROID_RELEASE;
    else process.env.HORUS_ANDROID_RELEASE = original;
  }
});

test('le build Android refuse les identifiants absents avant de générer le projet', () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('HORUS_ANDROID_')) delete env[key];
  const result = spawnSync(process.execPath, [join(root, 'scripts/release/build-android.mjs')], { cwd: tmpdir(), env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Variable requise : HORUS_ANDROID_KEYSTORE/);
});
