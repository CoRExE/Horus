/**
 * @format
 */

import {AppRegistry, Platform} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);

if (Platform.OS === 'web') {
  const style = document.createElement('style');
  style.textContent = `
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    #root > div {
      flex: 1;
    }
  `;
  document.head.appendChild(style);
  AppRegistry.runApplication(appName, {
    rootTag: document.getElementById('root') || document.getElementById('main'),
  });
}
