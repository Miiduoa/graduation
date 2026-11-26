// Selected explicitly by the Maestro simulator build's ENTRY_FILE. package.json
// continues to use index.ts; production/dev app entrypoints do not import this.
import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';
import { MaestroApp } from './e2e/MaestroApp';

LogBox.ignoreAllLogs(true);
registerRootComponent(MaestroApp);
