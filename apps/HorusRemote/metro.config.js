const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Add the monorepo root to watch folders
config.watchFolders = [monorepoRoot];

// Let Metro know where to resolve packages and force it to resolve `react` from the app's node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Resolves multiple instances of React (Invalid hook call)
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  react: path.resolve(require.resolve('react'), '../..'),
  'react-native': path.resolve(require.resolve('react-native'), '../..'),
};

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
