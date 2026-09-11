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
  ['./gradlew', [
    ':app:assembleRelease', '--no-daemon', '--max-workers=2',
    // Override Expo's generated 512 MiB Metaspace limit on every release build.
    // Keep these options here so prebuild cannot erase them or affect development builds.
    '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=2048m -Dfile.encoding=UTF-8',
    '-Pkotlin.daemon.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=1024m',
  ], `${root}/apps/HorusRemote/android`],
]) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
