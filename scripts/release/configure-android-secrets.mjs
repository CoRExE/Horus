import { execFileSync } from 'node:child_process';
import { readFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const file = resolve(process.argv[2] || 'apps/HorusRemote/credentials.json');
const repo = process.argv[3];
if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Usage : node scripts/release/configure-android-secrets.mjs CHEMIN_CREDENTIALS OWNER/REPO');
const credentials = JSON.parse(readFileSync(file, 'utf8')).android.keystore;
const keystore = resolve(dirname(file), credentials.keystorePath);
chmodSync(file, 0o600); chmodSync(keystore, 0o600);
const baseline = JSON.parse(readFileSync(new URL('./android-baseline.json', import.meta.url), 'utf8'));
const certificate = execFileSync('keytool', ['-J-Duser.language=en', '-list', '-v', '-keystore', keystore, '-storepass:env', 'HORUS_KEYSTORE_PASSWORD'], {
  env: { ...process.env, HORUS_KEYSTORE_PASSWORD: credentials.keystorePassword }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const digest = certificate.match(/SHA256: ([A-F0-9:]+)/)?.[1].replaceAll(':', '').toLowerCase();
if (digest !== baseline.certificateSha256) throw new Error('Certificat différent de l’APK historique. Aucun secret envoyé.');
const values = {
  ANDROID_KEYSTORE_BASE64: readFileSync(keystore).toString('base64'),
  ANDROID_KEYSTORE_PASSWORD: credentials.keystorePassword,
  ANDROID_KEY_ALIAS: credentials.keyAlias,
  ANDROID_KEY_PASSWORD: credentials.keyPassword,
};
if (Object.values(values).some((value) => typeof value !== 'string' || !value)) throw new Error('Identifiants incomplets.');
const existing = JSON.parse(execFileSync('gh', ['secret', 'list', '--repo', repo, '--json', 'name'], { encoding: 'utf8' }));
for (const [name, value] of Object.entries(values)) {
  if (existing.some((secret) => secret.name === name)) {
    console.log(`${name} déjà présent : conservé.`);
    continue;
  }
  // gh encrypts the value with the repository public key before transmitting it.
  // Pass it over stdin, never in command arguments or logs.
  execFileSync('gh', ['secret', 'set', name, '--repo', repo], { input: value, stdio: ['pipe', 'ignore', 'pipe'] });
  console.log(`${name} configuré.`);
}
