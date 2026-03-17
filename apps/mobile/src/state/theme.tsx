import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
} from "../ui/theme";

type ThemeContextValue = {
  mode: ThemeMode;
  theme: Theme;
  setMode: (m: ThemeMode) => void;
  toggleMode: () => void;
  setSchoolTheme: (schoolId: string, fallbackAccent?: string) => void;
  clearSchool: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "campus.themeMode.v2";

export function ThemeProvider(props: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<Theme>(getCurrentTheme);

  useEffect(() => {
    let cancelled = false;
    
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        
        const savedMode = raw === "dark" || raw === "light" ? raw : "light";
        applyTheme(savedMode);
        setCurrentTheme(getCurrentTheme());
      } catch (e) {
        console.warn("[theme] Failed to load theme preference:", e);
        applyTheme("light");
        setCurrentTheme(getCurrentTheme());
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToTheme((theme) => {
      setCurrentTheme(theme);
    });
    return unsubscribe;
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    applyTheme(m);
  }, []);

  const toggleMode = useCallback(() => {
    const newMode = currentTheme.mode === "dark" ? "light" : "dark";
    applyTheme(newMode);
  }, [currentTheme.mode]);

  const setSchoolTheme = useCallback((schoolId: string, fallbackAccent?: string) => {
    applySchoolTheme(schoolId, fallbackAccent);
  }, []);

  const clearSchool = useCallback(() => {
    clearSchoolTheme();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, currentTheme.mode).catch((e) => {
      console.warn("[theme] Failed to save theme preference:", e);
    });
  }, [loaded, currentTheme.mode]);

  const value = useMemo<ThemeContextValue>(() => ({ 
    mode: currentTheme.mode, 
    theme: currentTheme,
    setMode,
    toggleMode,
    setSchoolTheme,
    clearSchool,
  }), [currentTheme, setMode, toggleMode, setSchoolTheme, clearSchool]);

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeProvider");
  return ctx;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx.theme;
}

export { registerSchoolTheme };
export type { SchoolThemeConfig };
