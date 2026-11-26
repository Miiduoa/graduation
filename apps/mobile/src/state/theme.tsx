import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useColorScheme } from 'react-native';
import {
  readAppearanceMode,
  writeAppearanceMode,
  type AppearanceMode,
} from './appearancePreference';
import {
  applyTheme,
  applySchoolTheme,
  clearSchoolTheme,
  getCurrentTheme,
  subscribeToTheme,
  registerSchoolTheme,
  type Theme,
  type ThemeMode,
  type SchoolThemeConfig,
} from '../ui/theme';

type ThemeContextValue = {
  mode: ThemeMode;
  theme: Theme;
  appearanceMode: AppearanceMode;
  setMode: (m: AppearanceMode) => void;
  toggleMode: () => void;
  setSchoolTheme: (schoolId: string, fallbackAccent?: string) => void;
  clearSchool: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider(props: { children: React.ReactNode }) {
  const systemMode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>('system');
  const currentTheme = useSyncExternalStore(subscribeToTheme, getCurrentTheme, getCurrentTheme);
  const userSelected = useRef(false);
  const resolved = appearanceMode === 'system' ? systemMode : appearanceMode;

  useLayoutEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    let active = true;
    readAppearanceMode()
      .then((saved) => {
        if (active && !userSelected.current) setAppearanceMode(saved);
      })
      .catch((error) => console.warn('[theme] Failed to load theme preference:', error));
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: AppearanceMode) => {
    userSelected.current = true;
    setAppearanceMode(next);
    writeAppearanceMode(next).catch((error) =>
      console.warn('[theme] Failed to save theme preference:', error),
    );
  }, []);

  const toggleMode = useCallback(() => {
    setMode(currentTheme.mode === 'dark' ? 'light' : 'dark');
  }, [currentTheme.mode, setMode]);

  const setSchoolTheme = useCallback((schoolId: string, fallbackAccent?: string) => {
    applySchoolTheme(schoolId, fallbackAccent);
  }, []);

  const clearSchool = useCallback(() => {
    clearSchoolTheme();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode: currentTheme.mode,
      appearanceMode,
      theme: currentTheme,
      setMode,
      toggleMode,
      setSchoolTheme,
      clearSchool,
    }),
    [currentTheme, appearanceMode, setMode, toggleMode, setSchoolTheme, clearSchool],
  );

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useOptionalThemeMode() {
  return useContext(ThemeContext);
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode must be used within ThemeProvider');
  return ctx;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx.theme;
}

export { registerSchoolTheme };
export type { SchoolThemeConfig };
