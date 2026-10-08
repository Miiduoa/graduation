import { useMemo, useSyncExternalStore } from 'react';
import { getThemeVersion, subscribeToTheme } from './theme';

export function useThemeStyleSheet<T>(createStyles: () => T): T {
  const version = useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  return useMemo(createStyles, [createStyles, version]);
}
