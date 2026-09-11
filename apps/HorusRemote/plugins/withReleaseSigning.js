const { withAppBuildGradle } = require('expo/config-plugins');

// Prebuild can run without secrets. Only a release Gradle invocation requires them.
const signing = `
// Horus release signing: credentials stay in the environment, never in generated files.
def horusReleaseRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
def horusSigning = ['HORUS_ANDROID_KEYSTORE', 'HORUS_ANDROID_STORE_PASSWORD', 'HORUS_ANDROID_KEY_ALIAS', 'HORUS_ANDROID_KEY_PASSWORD']
if (horusReleaseRequested && horusSigning.any { !System.getenv(it) }) {
    throw new GradleException('Horus: renseigner les quatre variables HORUS_ANDROID_* de signature avant un build release.')
}
android {
    signingConfigs {
        horusRelease {
            def keystore = System.getenv('HORUS_ANDROID_KEYSTORE')
            if (keystore) storeFile file(keystore)
            storePassword System.getenv('HORUS_ANDROID_STORE_PASSWORD')
            keyAlias System.getenv('HORUS_ANDROID_KEY_ALIAS')
            keyPassword System.getenv('HORUS_ANDROID_KEY_PASSWORD')
        }
    }
    buildTypes.release.signingConfig = signingConfigs.horusRelease
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Le plugin de signature attend build.gradle (Groovy).');
    if (!mod.modResults.contents.includes('// Horus release signing:')) {
      mod.modResults.contents += signing;
    }
    return mod;
  });
};
