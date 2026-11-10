// Expo Go substitute for react-native-udp (selected by metro.config.js when
// HORUS_EXPO_GO=1): DLNA discovery reports that UDP sockets are unavailable.
export default {
  createSocket(): never {
    throw new Error('La découverte DLNA nécessite un build natif (indisponible dans Expo Go).');
  },
};
