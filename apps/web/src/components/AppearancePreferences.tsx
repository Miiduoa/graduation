'use client';

import { useEffect } from 'react';
import {
  applyWebAppearancePreferences,
  defaultWebPreferences,
  readStoredWebPreferences,
  webPreferencesStorageKey,
} from '@/lib/webPreferences';

export function AppearancePreferences() {
  useEffect(() => {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyStored = () => {
      let preferences = defaultWebPreferences;
      try {
        preferences = readStoredWebPreferences(window.localStorage);
      } catch {
        // Storage can be unavailable in a restricted browser session.
      }
      applyWebAppearancePreferences(document, preferences.appearance, systemTheme.matches);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === webPreferencesStorageKey) applyStored();
    };
    applyStored();
    window.addEventListener('storage', onStorage);
    systemTheme.addEventListener('change', applyStored);
    return () => {
      window.removeEventListener('storage', onStorage);
      systemTheme.removeEventListener('change', applyStored);
    };
  }, []);
  return null;
}
