import { useMemo, useSyncExternalStore } from 'react';
import { getThemeVersion, subscribeToTheme } from './theme';

export function useThemeVersion(): number {
  return useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
}

export function useThemeStyleSheet<T>(createStyles: () => T): T {
  const version = useThemeVersion();
  return useMemo(createStyles, [createStyles, version]);
}
