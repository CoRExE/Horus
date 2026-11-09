const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// One-shot release builds must not depend on a developer's Watchman daemon/cache.
if (process.env.HORUS_ANDROID_RELEASE === '1') {
  config.resolver.useWatchman = false;
}

// UI previews in Expo Go (`pnpm start:go`): replace native-only modules with inert
// substitutes so the app renders. Native builds never set this variable.
const expoGoSubstitutes = process.env.HORUS_EXPO_GO === '1' ? [
  [/^react-native-google-cast$/, 'expo-go/react-native-google-cast.ts'],
  [/^react-native-udp$/, 'expo-go/react-native-udp.ts'],
  [/local-video-proxy\/src\/LocalVideoProxyModule$/, 'expo-go/LocalVideoProxyModule.ts'],
] : [];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web') {
    const substitute = expoGoSubstitutes.find(([pattern]) => pattern.test(moduleName));
    if (substitute) {
      return { filePath: `${projectRoot}/${substitute[1]}`, type: 'sourceFile' };
    }
  }
  // Fix for parse5 trying to import entities/escape and entities/decode missing from exports
  if (moduleName === 'entities/decode') {
    return {
      filePath: require.resolve('entities/lib/decode.js'),
      type: 'sourceFile',
    };
  }
  if (moduleName === 'entities/escape') {
    return {
      filePath: require.resolve('entities/lib/escape.js'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
