import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function androidBuildOptions(args, environment) {
  for (const arg of args) {
    if (!['--preview', '--local'].includes(arg)) throw new Error(`Option inconnue : ${arg}`);
  }
  const preview = args.includes('--preview');
  const signingKeys = ['HORUS_ANDROID_KEYSTORE', 'HORUS_ANDROID_STORE_PASSWORD', 'HORUS_ANDROID_KEY_ALIAS', 'HORUS_ANDROID_KEY_PASSWORD'];
  if (!preview) {
    for (const name of signingKeys) {
      if (!environment[name]) throw new Error(`Variable requise : ${name}`);
    }
  }
  const env = {
    ...environment,
    HORUS_ANDROID_RELEASE: '1',
  };
  // A preview never consumes production credentials, even if exported by the shell.
  if (preview) for (const name of signingKeys) delete env[name];
  return { env, variant: preview ? 'preview' : 'release', task: preview ? ':app:assemblePreview' : ':app:assembleRelease' };
}

function build() {
  const { env, variant, task } = androidBuildOptions(process.argv.slice(2), process.env);
  for (const [command, args, cwd] of [
    [process.execPath, ['scripts/release/prebuild-android.mjs'], root],
    ['./gradlew', [
      task, '--no-daemon', '--max-workers=2',
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
  console.log(`APK généré : ${root}apps/HorusRemote/android/app/build/outputs/apk/${variant}/app-${variant}.apk`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) build();
