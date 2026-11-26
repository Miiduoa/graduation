import { NativeModules, Platform } from 'react-native';

/** iOS launch argument / NSUserDefaults key written by Maestro `launchApp.arguments`. */
export const MAESTRO_EMULATOR_LOGIN_ARGUMENT = 'maestroEmulatorLogin';

type SettingsMap = Record<string, unknown> | undefined;

function readLaunchSettings(): SettingsMap {
  const manager = NativeModules.SettingsManager as { settings?: SettingsMap } | undefined;
  return manager?.settings;
}

/**
 * True only when this process was started with Maestro's emulator-login argument.
 * Production builds never mount MaestroApp, and a crafted campus:// URI cannot
 * set this flag.
 */
export function isMaestroEmulatorLoginLaunch(): boolean {
  if (Platform.OS !== 'ios') return false;
  const value = readLaunchSettings()?.[MAESTRO_EMULATOR_LOGIN_ARGUMENT];
  return value === true || value === 1 || value === '1' || value === 'true';
}
