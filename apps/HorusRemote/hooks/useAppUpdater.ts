import { useEffect } from 'react';
import { Alert } from 'react-native';
import * as Updates from 'expo-updates';

export const useAppUpdater = () => {
  useEffect(() => {
    const checkUpdates = async () => {
      // Sécurité : ignorer la vérification en développement
      if (__DEV__) {
        console.log('[Updater] Environment __DEV__ détecté, mise à jour OTA ignorée.');
        return;
      }

      try {
        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          Alert.alert(
            'Mise à jour système',
            'De nouveaux protocoles Horus sont disponibles.',
            [
              {
                text: 'Ignorer',
                style: 'cancel',
              },
              {
                text: 'Initialiser',
                onPress: async () => {
                  try {
                    await Updates.fetchUpdateAsync();
                    await Updates.reloadAsync();
                  } catch (e) {
                    console.error('[Updater] Erreur lors du téléchargement:', e);
                  }
                },
              },
            ],
            // Empêcher l'utilisateur de fermer l'alerte en cliquant en dehors
            { cancelable: true }
          );
        }
      } catch (error) {
        console.error('[Updater] Erreur lors de la vérification OTA:', error);
      }
    };

    checkUpdates();
  }, []);
};
