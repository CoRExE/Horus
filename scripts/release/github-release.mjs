import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateVersion, expectedAssets } from './version.mjs';

const [mode, tag, directory] = process.argv.slice(2);
if (!['draft', 'publish'].includes(mode) || !directory) throw new Error('Usage : github-release.mjs draft|publish TAG DIRECTORY');
const release = validateVersion(tag);
const repo = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('GITHUB_REPOSITORY requis.');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const files = expectedAssets(release);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const taggedCommit = execFileSync('git', ['rev-parse', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim();
if (commit !== taggedCommit) throw new Error('Le checkout ne correspond pas au tag.');
const folder = resolve(directory);
const hash = (name) => createHash('sha256').update(readFileSync(resolve(folder, name))).digest('hex');
const checksum = () => files.map((name) => `${hash(name)}  ${name}\n`).join('');
// Query every page; do not use the repository-wide "latest" release.
const pages = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`));
const releases = pages.flat();
const existing = releases.find((item) => item.tag_name === tag);
const published = releases.filter((item) => !item.draft && !item.prerelease && item.tag_name !== tag);
if (release.platform === 'mobile') {
  const codes = published.flatMap((item) => item.assets || []).map((asset) =>
    Number(/^HorusRemote-\d+\.\d+\.\d+-(\d+)-android\.apk$/.exec(asset.name)?.[1] || 0));
  if (codes.some((code) => code >= release.versionCode)) throw new Error('Un APK déjà publié utilise ce versionCode ou un numéro supérieur.');
}
const expected = [...files, 'SHA256SUMS', 'release-info.json'].sort();
if (mode === 'draft') {
  if (existing) throw new Error('Cette release existe déjà. Examiner le brouillon existant avant de relancer ; aucun fichier ne sera écrasé.');
  if (JSON.stringify(readdirSync(folder).sort()) !== JSON.stringify([...files].sort())) throw new Error('Installateurs manquants ou fichiers inattendus.');
  writeFileSync(resolve(folder, 'SHA256SUMS'), checksum());
  writeFileSync(resolve(folder, 'release-info.json'), JSON.stringify({
    ...release, commit,
    assets: files.map((name) => ({ name, sha256: hash(name), size: statSync(resolve(folder, name)).size })),
  }, null, 2) + '\n');
  const previous = published.find((item) => item.tag_name.startsWith(`${release.platform}-v`));
  const args = ['api', '--method', 'POST', `repos/${repo}/releases/generate-notes`, '-f', `tag_name=${tag}`, '-f', `target_commitish=${commit}`];
  if (previous) args.push('-f', `previous_tag_name=${previous.tag_name}`);
  const generated = JSON.parse(gh(...args));
  const install = release.platform === 'desktop'
    ? 'Installateurs macOS arm64 et x64 (signature ad hoc, non notariée), Windows 11 x64 (NSIS non signé, WebView2 requis) et Ubuntu 24.04 x64 (.deb). FFmpeg et ses sources/licences sont inclus. Les essais sur les machines personnelles restent requis avant publication.'
    : `APK Android signé avec le certificat historique, versionCode ${release.versionCode}. Installer par-dessus l’application existante. Ce nouveau binaire désactive EAS Update.`;
  const notes = resolve(folder, '..', 'release-notes.md');
  writeFileSync(notes, `${install}\n\nContrôler les installateurs et leurs sommes SHA-256 avant publication.\n\n${generated.body}\n`);
  gh('release', 'create', tag, ...expected.map((name) => resolve(folder, name)), '--repo', repo, '--verify-tag', '--draft', '--latest=false', '--title', tag, '--notes-file', notes);
  console.log(`Brouillon créé : ${tag}`);
} else {
  if (!existing?.draft) throw new Error('Un brouillon existant est requis.');
  if (existing.prerelease) throw new Error('La publication stable refuse une préversion.');
  if (JSON.stringify(existing.assets.map((asset) => asset.name).sort()) !== JSON.stringify(expected)) throw new Error('Le brouillon ne contient pas les fichiers attendus.');
  gh('release', 'download', tag, '--repo', repo, '--dir', folder);
  const info = JSON.parse(readFileSync(resolve(folder, 'release-info.json'), 'utf8'));
  if (info.tag !== tag || info.commit !== commit || info.platform !== release.platform || info.version !== release.version || info.versionCode !== release.versionCode) throw new Error('Métadonnées différentes du tag/configuration.');
  if (JSON.stringify(info.assets?.map((asset) => asset.name).sort()) !== JSON.stringify([...files].sort())) throw new Error('Liste des installateurs invalide.');
  for (const asset of info.assets) {
    if (asset.sha256 !== hash(asset.name) || asset.size !== statSync(resolve(folder, asset.name)).size) throw new Error(`Fichier altéré : ${asset.name}`);
  }
  if (readFileSync(resolve(folder, 'SHA256SUMS'), 'utf8') !== checksum()) throw new Error('Sommes SHA-256 invalides.');
  gh('release', 'edit', tag, '--repo', repo, '--draft=false', '--latest=false');
  console.log(`Release publiée : ${tag}. Les manifestes de mise à jour relèvent du chantier 4.`);
}
