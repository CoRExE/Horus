import { readFileSync, writeFileSync } from 'node:fs';
import { Plugin } from 'release-it';
import { parseTag } from './version.mjs';

// release-it updates package.json; this plugin keeps Expo's Android version in sync.
export default class AndroidVersionPlugin extends Plugin {
  async bump(version) {
    parseTag(`mobile-v${version}`);
    const config = JSON.parse(readFileSync('app.json', 'utf8'));
    const code = config.expo?.android?.versionCode;
    if (!Number.isSafeInteger(code) || code < 1 || code >= 2100000000) {
      throw new Error('versionCode Android invalide ou impossible à incrémenter.');
    }
    config.expo.version = version;
    config.expo.android.versionCode = code + 1;
    writeFileSync('app.json', `${JSON.stringify(config, null, 2)}\n`);
  }
}
