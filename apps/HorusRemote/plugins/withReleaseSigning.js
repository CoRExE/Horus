const { withAppBuildGradle } = require('expo/config-plugins');

// Prebuild and preview can run without production secrets.
const signing = `
// @generated begin horus-signing
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
    buildTypes {
        preview {
            initWith release
            signingConfig signingConfigs.debug
            applicationIdSuffix '.preview'
            versionNameSuffix '-preview'
            resValue 'string', 'app_name', 'Horus Preview'
            matchingFallbacks = ['release']
            // Keep the JS bundle embedded; this is not a Metro development build.
            debuggable false
        }
    }
}
// @generated end horus-signing
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Le plugin de signature attend build.gradle (Groovy).');
    // Update our block even in a project already generated before preview existed.
    const contents = mod.modResults.contents
      .replace(/\n\/\/ @generated begin horus-signing[\s\S]*?\/\/ @generated end horus-signing\n?/g, '')
      .replace(/\n\/\/ Horus release signing:[\s\S]*?buildTypes\.release\.signingConfig = signingConfigs\.horusRelease\s*\n}\n?/g, '');
    mod.modResults.contents = contents + signing;
    return mod;
  });
};
