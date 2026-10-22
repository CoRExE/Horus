import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const withGoogleCast = require('react-native-google-cast/app.plugin.js').default;
const app = JSON.parse(readFileSync(new URL('../../../apps/HorusRemote/app.json', import.meta.url)));
const [, options] = app.expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'react-native-google-cast');

async function projectGradle(contents) {
  const config = withGoogleCast({ name: 'fixture', slug: 'fixture' }, options);
  return (await config.mods.android.projectBuildGradle({
    ...config,
    modResults: { language: 'groovy', contents },
    modRequest: { platform: 'android', modName: 'projectBuildGradle' },
  })).modResults.contents;
}

test('Cast stays pinned across clean and previously generated Expo projects', async () => {
  assert.equal(options.androidPlayServicesCastFrameworkVersion, '22.3.1');
  const clean = 'buildscript {\n  repositories { google() }\n}\n';
  const generated = await projectGradle(clean);
  assert.match(generated, /castFrameworkVersion = "22\.3\.1"/);
  const legacy = generated.replace('castFrameworkVersion = "22.3.1"', 'castFrameworkVersion = "+"');
  assert.equal(await projectGradle(legacy), generated, 'An existing dynamic pin must be replaced');
  assert.equal(await projectGradle(generated), generated, 'Repeated prebuild must remain idempotent');
});
