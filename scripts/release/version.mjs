import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseTag(tag) {
  const match = /^(desktop|mobile)-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag);
  if (!match) throw new Error('Tag attendu : desktop-vX.Y.Z ou mobile-vX.Y.Z (version stable).');
  return { tag, platform: match[1], version: match[2] };
}

export function validateVersion(tag, root = process.cwd()) {
  const release = parseTag(tag);
  const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const check = (actual, name) => {
    if (actual !== release.version) throw new Error(`${name} (${actual}) diffère du tag ${tag}.`);
  };
  if (release.platform === 'desktop') {
    check(json('apps/HorusDesktop/package.json').version, 'package.json Desktop');
    check(json('apps/HorusDesktop/src-tauri/tauri.conf.json').version, 'Tauri');
    const cargo = readFileSync(resolve(root, 'apps/HorusDesktop/src-tauri/Cargo.toml'), 'utf8');
    check(cargo.match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)?.[1], 'Cargo.toml');
    const lock = readFileSync(resolve(root, 'apps/HorusDesktop/src-tauri/Cargo.lock'), 'utf8');
    check(lock.match(/\[\[package\]\]\nname = "horus-desktop"\nversion = "([^"]+)"/)?.[1], 'Cargo.lock');
  } else {
    const app = json('apps/HorusRemote/app.json').expo;
    const baseline = json('scripts/release/android-baseline.json');
    check(json('apps/HorusRemote/package.json').version, 'package.json Mobile');
    check(app.version, 'Expo');
    if (app.android.package !== baseline.applicationId) throw new Error('Identifiant Android modifié.');
    if (!Number.isSafeInteger(app.android.versionCode) || app.android.versionCode <= Math.max(baseline.versionCode, baseline.easVersionCode) || app.android.versionCode > 2100000000) {
      throw new Error('versionCode Android doit dépasser la dernière version distribuée/EAS.');
    }
    release.versionCode = app.android.versionCode;
  }
  return release;
}

export function expectedAssets(release) {
  return release.platform === 'desktop'
    ? ['arm64', 'x64'].map((arch) => `HorusDesktop-${release.version}-macos-${arch}.dmg`)
    : [`HorusRemote-${release.version}-${release.versionCode}-android.apk`];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const release = validateVersion(process.argv[2]);
  console.log(JSON.stringify(release));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(release).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
}
