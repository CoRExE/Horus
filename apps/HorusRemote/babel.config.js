module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: [
            // Si tu as d'autres plugins (comme module-resolver), mets-les ici

            // Celui-ci doit TOUJOURS être à la fin de la liste
            'react-native-reanimated/plugin',
        ],
    };
};