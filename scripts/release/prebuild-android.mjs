import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeLegacyRuntime } from './remove-legacy-runtime.mjs';

const app = fileURLToPath(new URL('../../apps/HorusRemote/', import.meta.url));
const manifest = `${app}/package.json`;
const original = readFileSync(manifest, 'utf8');
await removeLegacyRuntime(app);
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../../node_modules/expo/bin/cli', import.meta.url)),
  'prebuild', '--platform', 'android', '--no-install', '--skip-dependency-update', 'react,react-native',
], { cwd: app, stdio: 'inherit', env: { ...process.env, HORUS_ANDROID_RELEASE: '1' } });
// Expo rewrites start scripts during prebuild. Preserve the repository's scripts
// and fail if the installed template tries to introduce dependency changes.
const before = JSON.parse(original);
const after = JSON.parse(readFileSync(manifest, 'utf8'));
writeFileSync(manifest, original);
if (JSON.stringify(before.dependencies) !== JSON.stringify(after.dependencies) || JSON.stringify(before.devDependencies) !== JSON.stringify(after.devDependencies)) {
  throw new Error('Prebuild demande des changements de dépendances : vérifier le template Expo avant de poursuivre.');
}
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
