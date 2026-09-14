import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareVersions, assetName, parseUpdateManifest, RELEASE_BASE_URL } from '../../packages/core/src/updates.ts';
import { parseTag } from './version.mjs';

// All channels are regenerated together; a mobile release cannot erase Desktop.
export async function generateManifests(releases, readMetadata) {
  const stable = releases.flatMap((release) => {
    if (release.draft || release.prerelease || !release.published_at) return [];
    try { return [{ ...release, parsed: parseTag(release.tag_name) }]; } catch { return []; }
  }).sort((a, b) => compareVersions(b.parsed.version, a.parsed.version));
  const output = {};
  for (const application of ['desktop', 'mobile']) {
    const release = stable.find((item) => item.parsed.platform === application);
    if (!release) continue; // No stable release: its endpoint stays unavailable (404).
    const { info, sums, commit } = await readMetadata(release);
    const { version, tag } = release.parsed;
    if (info.tag !== tag || info.platform !== application || info.version !== version || !/^[a-f0-9]{40}$/.test(commit) || info.commit !== commit) {
      throw new Error(`Métadonnées incohérentes pour ${tag}.`);
    }
    const platforms = application === 'desktop' ? ['macos', 'windows', 'linux'] : ['android'];
    const expectedNames = platforms.flatMap((platform) =>
      (platform === 'macos' ? ['arm64', 'x64'] : platform === 'android' ? ['universal'] : ['x64'])
        .map((arch) => assetName(platform, version, arch, info.versionCode)));
    if (!Array.isArray(info.assets) || JSON.stringify(info.assets.map((a) => a.name).sort()) !== JSON.stringify([...expectedNames].sort())) {
      throw new Error(`Installateurs manquants dans ${tag}.`);
    }
    if (!Array.isArray(release.assets) || JSON.stringify(release.assets.map((a) => a.name).sort()) !== JSON.stringify([...expectedNames, 'SHA256SUMS', 'release-info.json'].sort())) {
      throw new Error(`Fichiers de release incomplets ou inattendus dans ${tag}.`);
    }
    const expectedSums = expectedNames.map((name) => {
      const item = info.assets.find((a) => a.name === name);
      return `${item.sha256}  ${name}\n`;
    }).join('');
    if (sums !== expectedSums) throw new Error(`SHA256SUMS incohérent pour ${tag}.`);
    for (const platform of platforms) {
      const architectures = platform === 'macos' ? ['arm64', 'x64'] : platform === 'android' ? ['universal'] : ['x64'];
      const manifest = {
        schemaVersion: 1, application, platform, version,
        ...(application === 'mobile' ? { versionCode: info.versionCode } : {}),
        tag, publishedAt: release.published_at, notes: String(release.body || '').slice(0, 16000),
        releaseUrl: `${RELEASE_BASE_URL}/tag/${tag}`,
        assets: architectures.map((architecture) => {
          const name = assetName(platform, version, architecture, info.versionCode);
          const item = info.assets.find((a) => a.name === name);
          const remote = release.assets.find((a) => a.name === name);
          // GitHub computes this digest on upload. No installer download or rebuild.
          if (remote.state !== 'uploaded' || remote.size !== item.size || remote.digest !== `sha256:${item.sha256}` || remote.browser_download_url !== `${RELEASE_BASE_URL}/download/${tag}/${name}`) {
            throw new Error(`Fichier indisponible ou altéré : ${name}`);
          }
          return { architecture, name, url: remote.browser_download_url, sha256: item.sha256, size: item.size };
        }),
      };
      output[platform] = parseUpdateManifest(manifest, platform);
    }
  }
  return output;
}

export async function publishDirectory(directory) {
  const repo = process.env.GITHUB_REPOSITORY || 'CoRExE/Horus';
  if (repo !== 'CoRExE/Horus') throw new Error('Les manifestes ciblent le dépôt CoRExE/Horus.');
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`)).flat();
  const manifests = await generateManifests(releases, async (release) => {
    const read = (name) => {
      const asset = release.assets.find((a) => a.name === name);
      if (!asset || asset.state !== 'uploaded' || asset.size > 128000) throw new Error(`Métadonnées absentes ou trop volumineuses : ${name}`);
      return gh('api', `repos/${repo}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream');
    };
    let object = JSON.parse(gh('api', `repos/${repo}/git/ref/tags/${release.tag_name}`)).object;
    for (let depth = 0; object.type === 'tag' && depth < 5; depth++) object = JSON.parse(gh('api', `repos/${repo}/git/tags/${object.sha}`)).object;
    if (object.type !== 'commit') throw new Error('Tag sans commit identifiable.');
    return { info: JSON.parse(read('release-info.json')), sums: read('SHA256SUMS'), commit: object.sha };
  });
  const root = resolve(directory);
  mkdirSync(resolve(root, 'updates'), { recursive: true });
  for (const platform of ['android', 'macos', 'windows', 'linux']) {
    if (!manifests[platform]) rmSync(resolve(root, 'updates', `${platform}.json`), { force: true });
  }
  for (const [platform, manifest] of Object.entries(manifests)) {
    writeFileSync(resolve(root, 'updates', `${platform}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(resolve(root, 'index.html'), '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Mises à jour Horus</title><h1>Mises à jour Horus</h1><p><a href="https://github.com/CoRExE/Horus/releases">Versions et installateurs</a></p></html>\n');
  console.log(`Manifestes générés : ${Object.keys(manifests).join(', ')}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage : node scripts/release/update-manifests.mjs DOSSIER');
  await publishDirectory(process.argv[2]);
}
