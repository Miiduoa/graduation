import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';

// Maestro smoke taps the landing login control. A LogBox toast at the bottom
// overlaps that button and swallows the tap, so CI must not show it.
if (process.env.EXPO_PUBLIC_MAESTRO === '1' || process.env.CI) {
  LogBox.ignoreAllLogs(true);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
