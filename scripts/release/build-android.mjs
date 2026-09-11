import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
for (const name of ['HORUS_ANDROID_KEYSTORE', 'HORUS_ANDROID_STORE_PASSWORD', 'HORUS_ANDROID_KEY_ALIAS', 'HORUS_ANDROID_KEY_PASSWORD']) {
  if (!process.env[name]) throw new Error(`Variable requise : ${name}`);
}
const env = {
  ...process.env,
  HORUS_ANDROID_RELEASE: '1',
  EXPO_PUBLIC_HORUS_API_URL: process.env.EXPO_PUBLIC_HORUS_API_URL || 'https://horus-api.horus-remote.workers.dev',
};
for (const [command, args, cwd] of [
  [process.execPath, ['scripts/release/prebuild-android.mjs'], root],
  ['./gradlew', [':app:assembleRelease', '--no-daemon'], `${root}/apps/HorusRemote/android`],
]) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
