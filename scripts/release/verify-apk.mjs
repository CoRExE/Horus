import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateVersion } from './version.mjs';

const release = validateVersion(process.argv[2]);
if (release.platform !== 'mobile') throw new Error('Tag mobile requis.');
const apk = resolve(process.argv[3]);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('ANDROID_HOME requis.');
const baseline = JSON.parse(readFileSync('scripts/release/android-baseline.json', 'utf8'));
const run = (tool, args) => execFileSync(`${sdk}/build-tools/36.0.0/${tool}`, args, { encoding: 'utf8' });
const badging = run('aapt', ['dump', 'badging', apk]);
const identity = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
if (!identity || identity[1] !== baseline.applicationId || Number(identity[2]) !== release.versionCode || identity[3] !== release.version) throw new Error('Identité/version de l’APK différente de la configuration.');
const certs = run('apksigner', ['verify', '--print-certs', apk]);
const digests = [...certs.matchAll(/certificate SHA-256 digest: ([a-f0-9]+)/g)].map((match) => match[1]);
if (digests.length !== 1 || digests[0] !== baseline.certificateSha256) throw new Error('La signature ne correspond pas à l’APK historique : mise à jour impossible.');
const manifest = run('aapt', ['dump', 'xmltree', apk, 'AndroidManifest.xml']);
const updateMetadata = manifest.split(/\n\s*E: /).find((element) => element.includes('"expo.modules.updates.ENABLED"'));
if (!updateMetadata || !/android:value[^\n]*\(type 0x12\)0x0\b/.test(updateMetadata)) throw new Error('EAS Update doit être désactivé dans le binaire Android.');
for (const value of ['com.reactnative.googlecast.GoogleCastOptionsProvider', 'CC1AD845']) {
  if (!manifest.includes(value)) throw new Error(`Configuration Cast absente : ${value}`);
}
const entries = new Set(execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8' }).trim().split('\n'));
if (!entries.has('assets/index.android.bundle')) throw new Error('Bundle JavaScript absent de l’APK.');
for (const abi of ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64']) {
  for (const library of ['libhermes.so', 'libreactnative.so']) {
    if (!entries.has(`lib/${abi}/${library}`)) throw new Error(`Bibliothèque Android absente : ${abi}/${library}`);
  }
}
console.log(`APK vérifié : ${identity[1]} ${identity[3]} (${identity[2]}), certificat historique et EAS Update désactivé.`);
