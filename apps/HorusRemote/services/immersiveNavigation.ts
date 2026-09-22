import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { setupImmersiveNavigation } from './immersiveLifecycle';
import * as NavigationBar from 'expo-navigation-bar';

// The app uses edge-to-edge: backgroundColor and setBehavior are unsupported there.
export function hideAndroidNavigation() {
  if (Platform.OS === 'android') {
    void NavigationBar.setVisibilityAsync('hidden').catch(error => {
      console.warn('[Navigation] Unable to hide navigation bar', error);
    });
  }
}

export function useImmersiveNavigation() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    return setupImmersiveNavigation((event, callback) => {
      const subscription = AppState.addEventListener(event, callback);
      return () => subscription.remove();
    }, hideAndroidNavigation);
  }, []);
}
