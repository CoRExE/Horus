import assert from 'node:assert/strict';
import test from 'node:test';
import { assetName, compareVersions, parseUpdateManifest, selectUpdate, createUpdateChecker, desktopUpdateTarget, UPDATE_INTERVAL, RELEASE_BASE_URL } from '../../../packages/core/src/updates.ts';
import { generateManifests } from '../update-manifests.mjs';

const hash = 'a'.repeat(64);
function manifest(platform = 'macos', version = '0.2.0', code = 26) {
  const application = platform === 'android' ? 'mobile' : 'desktop';
  const tag = `${application}-v${version}`;
  return { schemaVersion: 1, application, platform, version,
    ...(platform === 'android' ? { versionCode: code } : {}),
    tag, publishedAt: '2026-09-14T00:00:00Z', notes: 'Nouveautés', releaseUrl: `${RELEASE_BASE_URL}/tag/${tag}`,
    assets: (platform === 'macos' ? ['arm64', 'x64'] : platform === 'android' ? ['universal'] : ['x64']).map((architecture) => {
      const name = assetName(platform, version, architecture, code);
      return { architecture, name, url: `${RELEASE_BASE_URL}/download/${tag}/${name}`, sha256: hash, size: 100 };
    }),
  };
}

test('comparaison numérique des versions et sélection des quatre plateformes', () => {
  assert.equal(compareVersions('1.10.0', '1.9.99'), 1);
  for (const version of ['1.2.0-beta', '01.2.0', '1.2', '9007199254740992.0.0']) assert.throws(() => compareVersions(version, '1.0.0'));
  for (const platform of ['macos', 'windows', 'linux', 'android']) {
    const m = manifest(platform, '1.5.0');
    for (const asset of m.assets) {
      const target = { platform, architecture: asset.architecture, version: '1.4.1', versionCode: 25 };
      assert.equal(selectUpdate(m, target).name, asset.name);
      assert.equal(selectUpdate(m, { ...target, version: '1.5.0', versionCode: 26 }), undefined);
      assert.equal(selectUpdate(m, { ...target, version: '1.6.0', versionCode: 30 }), undefined);
    }
  }
  assert.equal(desktopUpdateTarget('macos', 'aarch64', '0.1.1').architecture, 'arm64');
  assert.equal(desktopUpdateTarget('windows', 'x86_64', '0.1.1').architecture, 'x64');
  assert.equal(desktopUpdateTarget('linux', 'aarch64', '0.1.1'), undefined);
  assert.equal(desktopUpdateTarget('macos', undefined, '0.1.1'), undefined);
});

test('Android exige un versionCode supérieur même lorsque le nom de version augmente', () => {
  const target = { platform: 'android', architecture: 'universal', version: '1.4.1', versionCode: 25 };
  assert.ok(selectUpdate(manifest('android', '1.4.1', 26), target));
  assert.equal(selectUpdate(manifest('android', '1.5.0', 25), target), undefined);
  assert.equal(selectUpdate(manifest('android', '1.4.0', 26), target), undefined);
});

test('un manifeste ambigu, incomplet ou provenant d’une autre application est refusé', () => {
  const changes = [
    (m) => { m.application = 'mobile'; }, (m) => { m.platform = 'windows'; },
    (m) => { m.schemaVersion = 2; }, (m) => { m.version = '0.2.0-beta'; },
    (m) => { m.tag = 'mobile-v0.2.0'; }, (m) => { m.assets.pop(); },
    (m) => { m.assets[1] = m.assets[0]; }, (m) => { m.assets[0].sha256 = 'bad'; },
    (m) => { m.assets[0].url = 'https://example.com/install.dmg'; },
    (m) => { m.assets[0].url += '?redirect=bad'; }, (m) => { m.assets[0].size = 0; },
    (m) => { m.releaseUrl = 'javascript:alert(1)'; }, (m) => { m.notes = 42; },
  ];
  for (const change of changes) { const m = manifest(); change(m); assert.throws(() => parseUpdateManifest(m, 'macos')); }
  assert.throws(() => parseUpdateManifest(manifest('android'), 'macos'));
});

test('vérification quotidienne persistée, manuelle forcée et appels simultanés regroupés', async () => {
  const storage = new Map(); let time = 100000; let requests = 0;
  const options = { target: { platform: 'macos', architecture: 'arm64', version: '0.1.1' },
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => { storage.set(key, value); }, now: () => time,
    request: async () => { requests++; return { status: 200, body: JSON.stringify(manifest()) }; },
  };
  const checker = createUpdateChecker(options);
  const [a, b] = await Promise.all([checker.check(), checker.check(true)]);
  assert.equal(a.kind, 'available'); assert.deepEqual(a, b); assert.equal(requests, 1);
  assert.equal((await createUpdateChecker(options).check()).kind, 'skipped');
  await checker.check(true); assert.equal(requests, 2);
  time += UPDATE_INTERVAL;
  await checker.check(); assert.equal(requests, 3);
  time -= 2 * UPDATE_INTERVAL; // A clock correction must not block checks forever.
  await checker.check(); assert.equal(requests, 4);
});

test('réseau absent, HTTP en erreur et JSON invalide ne bloquent pas le client', async () => {
  for (const request of [async () => { throw Error('offline'); }, async () => ({ status: 404, body: '' }), async () => ({ status: 200, body: 'invalid' })]) {
    const checker = createUpdateChecker({ target: { platform: 'linux', architecture: 'x64', version: '0.1.1' },
      getItem: async () => { throw Error('storage'); }, setItem: async () => { throw Error('storage'); }, request });
    assert.equal((await checker.check()).kind, 'unavailable');
  }
});

test('une requête bloquée expire sans attendre réellement dix secondes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const checker = createUpdateChecker({ target: { platform: 'linux', architecture: 'x64', version: '0.1.1' },
    getItem: async () => null, setItem: async () => {},
    request: () => { started(); return new Promise(() => {}); } });
  const pending = checker.check();
  await ready;
  t.mock.timers.tick(10001);
  assert.equal((await pending).kind, 'unavailable');
});

function published(application, version) {
  const manifests = (application === 'desktop' ? ['macos', 'windows', 'linux'] : ['android']).map((p) => manifest(p, version));
  const assets = manifests.flatMap((m) => m.assets);
  const tag = manifests[0].tag;
  const info = { tag, platform: application, version, ...(application === 'mobile' ? { versionCode: 26 } : {}), commit: 'b'.repeat(40),
    assets: assets.map(({ name, sha256, size }) => ({ name, sha256, size })) };
  return { tag_name: tag, draft: false, prerelease: false, published_at: '2026-09-14T00:00:00Z', body: 'Notes',
    assets: [...assets.map((a) => ({ name: a.name, digest: `sha256:${a.sha256}`, size: a.size, state: 'uploaded', browser_download_url: a.url })), { name: 'SHA256SUMS' }, { name: 'release-info.json' }],
    metadata: { info, commit: info.commit, sums: assets.map((a) => `${a.sha256}  ${a.name}\n`).join('') } };
}

test('les manifestes conservent les deux applications et ignorent brouillons et préversions', async () => {
  const desktop = published('desktop', '1.10.0'); const mobile = published('mobile', '1.4.1');
  const releases = [published('desktop', '1.9.0'), desktop, mobile,
    { ...published('mobile', '2.0.0'), draft: true }, { ...published('desktop', '3.0.0'), prerelease: true }];
  const result = await generateManifests(releases, async (release) => release.metadata);
  assert.deepEqual(Object.keys(result), ['macos', 'windows', 'linux', 'android']);
  assert.equal(result.macos.version, '1.10.0'); assert.equal(result.android.version, '1.4.1');
  assert.equal(result.windows.assets[0].name, 'HorusDesktop-1.10.0-windows-x64.exe');
});

test('une release incomplète ou altérée bloque toute régénération', async () => {
  for (const change of [
    (r) => r.assets.pop(), (r) => { r.assets[0].digest = `sha256:${'c'.repeat(64)}`; },
    (r) => { r.assets[0].size++; }, (r) => { r.metadata.commit = 'd'.repeat(40); },
    (r) => { r.metadata.sums = ''; }, (r) => { r.metadata.info.assets.pop(); },
  ]) {
    const releases = [published('desktop', '0.2.0'), published('mobile', '1.4.1')]; change(releases[0]);
    await assert.rejects(generateManifests(releases, async (release) => release.metadata));
  }
  const androidOnly = await generateManifests([{ ...published('desktop', '0.2.0'), prerelease: true }, published('mobile', '1.4.1')], async (release) => release.metadata);
  assert.deepEqual(Object.keys(androidOnly), ['android']);
  assert.deepEqual(await generateManifests([], async (release) => release.metadata), {});
});
