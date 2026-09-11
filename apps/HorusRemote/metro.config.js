const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// One-shot release builds must not depend on a developer's Watchman daemon/cache.
if (process.env.HORUS_ANDROID_RELEASE === '1') {
  config.resolver.useWatchman = false;
}

// Fix for parse5 trying to import entities/escape and entities/decode missing from exports
config.resolver.resolveRequest = (context, moduleName, platform) => {
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
