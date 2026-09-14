import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { removeLegacyRuntime } from '../remove-legacy-runtime.mjs';

const { AndroidConfig } = createRequire(import.meta.url)('expo/config-plugins');

test('la migration prebuild retire uniquement le runtime OTA et est idempotente', async (t) => {
  const app = mkdtempSync(join(tmpdir(), 'horus-legacy-runtime-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  await removeLegacyRuntime(app); // Fresh checkout: nothing to migrate.
  const file = join(app, 'android/app/src/main/AndroidManifest.xml');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.horus.remote">
    <uses-permission android:name="android.permission.INTERNET"/>
    <application android:name=".MainApplication" android:label="HorusRemote">
      <meta-data android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="@string/expo_runtime_version"/>
      <meta-data android:name="expo.modules.updates.ENABLED" android:value="false"/>
      <meta-data android:name="custom.setting" android:value="preserved"/>
      <activity android:name=".MainActivity" android:exported="true"/>
    </application>
  </manifest>`);
  const expected = await AndroidConfig.Manifest.readAndroidManifestAsync(file);
  expected.manifest.application[0]['meta-data'].shift();
  await removeLegacyRuntime(app);
  assert.deepEqual(await AndroidConfig.Manifest.readAndroidManifestAsync(file), expected);
  const migrated = readFileSync(file, 'utf8');
  await removeLegacyRuntime(app);
  assert.equal(readFileSync(file, 'utf8'), migrated);
});
