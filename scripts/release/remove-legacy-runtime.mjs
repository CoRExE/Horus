import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { AndroidConfig } = createRequire(import.meta.url)('expo/config-plugins');

// Expo refuses to remove a former OTA runtime by itself on an existing prebuild.
export async function removeLegacyRuntime(appDirectory) {
  const path = join(appDirectory, 'android/app/src/main/AndroidManifest.xml');
  if (!existsSync(path)) return;
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(path);
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const key = 'expo.modules.updates.EXPO_RUNTIME_VERSION';
  if (AndroidConfig.Manifest.findMetaDataItem(application, key) < 0) return;
  AndroidConfig.Manifest.removeMetaDataItemFromMainApplication(application, key);
  await AndroidConfig.Manifest.writeAndroidManifestAsync(path, manifest);
}
