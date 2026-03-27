import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type TextSize = "small" | "medium" | "large" | "xlarge";
export type ContrastMode = "normal" | "high";
export type ColorBlindMode = "none" | "protanopia" | "deuteranopia" | "tritanopia";

export type AccessibilitySettings = {
  textSize: TextSize;
  contrastMode: ContrastMode;
  reduceMotion: boolean;
  boldText: boolean;
  hapticFeedback: boolean;
  screenReaderHints: boolean;
  autoReadAnnouncements: boolean;
  colorBlindMode: ColorBlindMode;
};

const STORAGE_KEY = "@accessibility_settings";

const DEFAULT_SETTINGS: AccessibilitySettings = {
  textSize: "medium",
  contrastMode: "normal",
  reduceMotion: false,
  boldText: false,
  hapticFeedback: true,
  screenReaderHints: true,
  autoReadAnnouncements: false,
  colorBlindMode: "none",
};

export const TEXT_SCALE_MAP: Record<TextSize, number> = {
  small: 0.85,
  medium: 1,
  large: 1.2,
  xlarge: 1.4,
};

type AccessibilityContextValue = {
  settings: AccessibilitySettings;
  textScale: number;
  isHighContrast: boolean;
  isReduceMotion: boolean;
  isBoldText: boolean;
  updateSetting: <K extends keyof AccessibilitySettings>(key: K, value: AccessibilitySettings[K]) => void;
  resetToDefaults: () => void;
};

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

export function AccessibilityProvider(props: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AccessibilitySettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        if (stored) {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
        }
      } catch (e) {
        console.warn("[accessibility] Failed to load settings:", e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveSettings = useCallback(async (newSettings: AccessibilitySettings) => {
    setSettings(newSettings);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
    } catch (e) {
      console.warn("[accessibility] Failed to save settings:", e);
    }
  }, []);

  const updateSetting = useCallback(<K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K]
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((e) => {
        console.warn("[accessibility] Failed to save settings:", e);
      });
      return next;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
  }, [saveSettings]);

  const value = useMemo<AccessibilityContextValue>(() => ({
    settings,
    textScale: TEXT_SCALE_MAP[settings.textSize],
    isHighContrast: settings.contrastMode === "high",
    isReduceMotion: settings.reduceMotion,
    isBoldText: settings.boldText,
    updateSetting,
    resetToDefaults,
  }), [settings, updateSetting, resetToDefaults]);

  return (
    <AccessibilityContext.Provider value={value}>
      {props.children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error("useAccessibility must be used within AccessibilityProvider");
  return ctx;
}

export function useTextScale(): number {
  return useAccessibility().textScale;
}
