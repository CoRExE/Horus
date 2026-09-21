import assert from 'node:assert/strict';
import test from 'node:test';
import { androidBuildOptions } from '../build-android.mjs';
import withReleaseSigning from '../../../apps/HorusRemote/plugins/withReleaseSigning.js';

const signing = {
  HORUS_ANDROID_KEYSTORE: '/fixture/production.jks',
  HORUS_ANDROID_STORE_PASSWORD: 'fixture-store',
  HORUS_ANDROID_KEY_ALIAS: 'fixture-alias',
  HORUS_ANDROID_KEY_PASSWORD: 'fixture-key',
};

test('preview sans secrets : variante autonome, aucun catalogue imposé et aucune clé de production transmise', () => {
  const preview = androidBuildOptions(['--preview', '--local'], {});
  assert.equal(preview.task, ':app:assemblePreview');
  assert.equal(preview.variant, 'preview');
  assert.equal(preview.env.HORUS_ANDROID_RELEASE, '1');
  assert.equal(preview.env.EXPO_PUBLIC_HORUS_API_URL, undefined);
  const environment = { ...signing, EXPO_PUBLIC_HORUS_API_URL: 'https://fixture.invalid', ANDROID_HOME: '/fixture/sdk' };
  const custom = androidBuildOptions(['--preview'], environment);
  for (const key of Object.keys(signing)) assert.equal(custom.env[key], undefined);
  assert.equal(custom.env.ANDROID_HOME, environment.ANDROID_HOME);
  assert.equal(custom.env.EXPO_PUBLIC_HORUS_API_URL, environment.EXPO_PUBLIC_HORUS_API_URL);
  assert.equal(environment.HORUS_ANDROID_KEYSTORE, signing.HORUS_ANDROID_KEYSTORE);
});

test('la production exige toujours ses quatre secrets ; une option mal saisie ne crée pas une preview', () => {
  for (const key of Object.keys(signing)) {
    const environment = { ...signing };
    delete environment[key];
    assert.throws(() => androidBuildOptions(['--local'], environment), new RegExp(`Variable requise : ${key}`));
  }
  const release = androidBuildOptions([], signing);
  assert.equal(release.task, ':app:assembleRelease');
  assert.equal(release.variant, 'release');
  assert.equal(release.env.HORUS_ANDROID_KEYSTORE, signing.HORUS_ANDROID_KEYSTORE);
  assert.throws(() => androidBuildOptions(['--prevew'], signing), /Option inconnue/);
});

async function configure(contents) {
  const config = withReleaseSigning({ name: 'fixture', slug: 'fixture' });
  const result = await config.mods.android.appBuildGradle({
    ...config,
    modResults: { language: 'groovy', contents },
    modRequest: { platform: 'android', modName: 'appBuildGradle' },
  });
  return result.modResults.contents;
}

test('prebuild ajoute une preview distincte signée en debug sans changer la signature release', async () => {
  const generated = await configure('android { defaultConfig { applicationId "com.horus.remote" } }\n');
  assert.match(generated, /buildTypes.release.signingConfig = signingConfigs.horusRelease/);
  assert.match(generated, /horusReleaseRequested && horusSigning.any/);
  assert.match(generated, /preview \{\s*initWith release\s*signingConfig signingConfigs.debug/);
  assert.match(generated, /applicationIdSuffix '.preview'/);
  assert.match(generated, /resValue 'string', 'app_name', 'Horus Preview'/);
  assert.match(generated, /matchingFallbacks = \['release'\]/);
  assert.match(generated, /debuggable false/);
  assert.equal(await configure(generated), generated, 'Repeated prebuild must not duplicate configuration');
});

test('un ancien projet généré reçoit la variante preview sans effacer les blocs voisins', async () => {
  const legacy = `android { /* application configuration */ }
// Horus release signing: credentials stay in the environment, never in generated files.
def horusReleaseRequested = true
android {
    signingConfigs { horusRelease {} }
    buildTypes.release.signingConfig = signingConfigs.horusRelease
}
// Another plugin follows.
otherPlugin { enabled = true }
`;
  const updated = await configure(legacy);
  assert.match(updated, /otherPlugin \{ enabled = true \}/);
  assert.match(updated, /android \{ \/\* application configuration \*\/ \}/);
  assert.equal(updated.includes('def horusReleaseRequested = true'), false);
  assert.equal(updated.match(/def horusReleaseRequested/g)?.length, 1);
  assert.equal(updated.match(/preview \{/g)?.length, 1);
  assert.equal(await configure(updated), updated);
});
