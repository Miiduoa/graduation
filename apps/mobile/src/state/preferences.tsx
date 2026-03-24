/* eslint-disable */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AccessibilitySettings, NotificationPreferences } from "../data/types";

// ===== Types =====

export type Language = "zh-TW" | "zh-CN" | "en" | "ja" | "ko";

export type FontSize = "small" | "medium" | "large" | "xlarge";

export type AppearanceMode = "light" | "dark" | "system";

export type MapStyle = "standard" | "satellite" | "hybrid";

export type CalendarStartDay = 0 | 1; // 0 = Sunday, 1 = Monday

export type UserPreferences = {
  // Display
  language: Language;
  fontSize: FontSize;
  appearanceMode: AppearanceMode;
  highContrast: boolean;
  reduceMotion: boolean;
  
  // Notifications
  notifications: NotificationPreferences;
  
  // Calendar
  calendarStartDay: CalendarStartDay;
  showWeekNumber: boolean;
  
  // Map
  mapStyle: MapStyle;
  defaultMapZoom: number;
  
  // Privacy
  shareLocation: boolean;
  shareActivity: boolean;
  
  // Data
  autoSync: boolean;
  syncOnWifiOnly: boolean;
  cacheSize: "small" | "medium" | "large";
  
  // Experimental
  enableBetaFeatures: boolean;
};

type PreferencesContextType = {
  preferences: UserPreferences;
  loading: boolean;
  error: string | null;
  
  // Individual setters
  setLanguage: (language: Language) => Promise<void>;
  setFontSize: (fontSize: FontSize) => Promise<void>;
  setAppearanceMode: (mode: AppearanceMode) => Promise<void>;
  setHighContrast: (enabled: boolean) => Promise<void>;
  setReduceMotion: (enabled: boolean) => Promise<void>;
  
  setNotificationPreference: <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K]
  ) => Promise<void>;
  
  setCalendarStartDay: (day: CalendarStartDay) => Promise<void>;
  setShowWeekNumber: (show: boolean) => Promise<void>;
  
  setMapStyle: (style: MapStyle) => Promise<void>;
  setDefaultMapZoom: (zoom: number) => Promise<void>;
  
  setShareLocation: (share: boolean) => Promise<void>;
  setShareActivity: (share: boolean) => Promise<void>;
  
  setAutoSync: (enabled: boolean) => Promise<void>;
  setSyncOnWifiOnly: (enabled: boolean) => Promise<void>;
  setCacheSize: (size: "small" | "medium" | "large") => Promise<void>;
  
  setEnableBetaFeatures: (enabled: boolean) => Promise<void>;
  
  // Bulk operations
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
  resetToDefaults: () => Promise<void>;
  exportPreferences: () => Promise<string>;
  importPreferences: (json: string) => Promise<void>;
};

// ===== Constants =====

const STORAGE_KEY = "@user_preferences";

const DEFAULT_PREFERENCES: UserPreferences = {
  language: "zh-TW",
  fontSize: "medium",
  appearanceMode: "system",
  highContrast: false,
  reduceMotion: false,
  
  notifications: {
    announcements: true,
    events: true,
    grades: true,
    assignments: true,
    messages: true,
    quietHoursStart: undefined,
    quietHoursEnd: undefined,
  },
  
  calendarStartDay: 1,
  showWeekNumber: false,
  
  mapStyle: "standard",
  defaultMapZoom: 16,
  
  shareLocation: false,
  shareActivity: false,
  
  autoSync: true,
  syncOnWifiOnly: false,
  cacheSize: "medium",
  
  enableBetaFeatures: false,
};

// ===== Context =====

const PreferencesContext = createContext<PreferencesContextType | null>(null);

export function usePreferences(): PreferencesContextType {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
}

// ===== Language Display Names =====

export const LANGUAGE_NAMES: Record<Language, string> = {
  "zh-TW": "繁體中文",
  "zh-CN": "简体中文",
  "en": "English",
  "ja": "日本語",
  "ko": "한국어",
};

export const FONT_SIZE_VALUES: Record<FontSize, number> = {
  small: 0.85,
  medium: 1,
  large: 1.15,
  xlarge: 1.3,
};

// ===== Provider =====

type PreferencesProviderProps = {
  children: ReactNode;
};

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 使用 ref 追蹤最新的 preferences 以避免閉包陳舊問題
  const preferencesRef = useRef<UserPreferences>(DEFAULT_PREFERENCES);
  preferencesRef.current = preferences;
  
  // 追蹤是否已卸載以避免在卸載後更新狀態
  const isMountedRef = useRef(true);
  
  // 用於 debounce 儲存操作
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<UserPreferences | null>(null);
  
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // 清理 timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // 元件卸載時立即儲存任何待處理的更改
      if (pendingSaveRef.current) {
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pendingSaveRef.current)).catch(
          (e) => console.warn("[Preferences] Failed to save on unmount:", e)
        );
      }
    };
  }, []);

  // Load preferences on mount
  useEffect(() => {
    let cancelled = false;
    
    async function loadPreferences() {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            // 驗證資料結構
            if (typeof parsed === "object" && parsed !== null) {
              setPreferences({ ...DEFAULT_PREFERENCES, ...parsed });
              setError(null);
            } else {
              throw new Error("Invalid preferences format");
            }
          } catch (parseError) {
            console.error("[Preferences] Invalid stored data:", parseError);
            setError("設定資料損壞，已重置為預設值");
            // 清除損壞的資料
            await AsyncStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (e) {
        if (cancelled) return;
        console.error("[Preferences] Failed to load:", e);
        setError("載入設定失敗");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPreferences();
    
    return () => {
      cancelled = true;
    };
  }, []);

  // 執行實際的儲存操作
  const doSave = useCallback(async (value: UserPreferences): Promise<void> => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      pendingSaveRef.current = null;
      if (isMountedRef.current) {
        setError(null);
      }
    } catch (e) {
      console.error("[Preferences] Failed to save:", e);
      if (isMountedRef.current) {
        setError("儲存設定失敗");
      }
      throw e;
    }
  }, []);

  // 使用 debounce 的更新和儲存函數
  // 立即更新 state，但延遲 500ms 才寫入 AsyncStorage
  // 如果在 500ms 內有多次更新，只會執行最後一次儲存
  const updateAndSave = useCallback(
    async (updater: (prev: UserPreferences) => UserPreferences): Promise<void> => {
      // 先計算新值並立即更新 UI
      const nextValue = updater(preferencesRef.current);
      
      // 更新 state（立即反映到 UI）
      setPreferences(nextValue);
      preferencesRef.current = nextValue;
      
      // 標記有待儲存的更改
      pendingSaveRef.current = nextValue;
      
      // 清除之前的儲存計時器
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // 設置新的延遲儲存計時器（500ms debounce）
      saveTimeoutRef.current = setTimeout(() => {
        if (pendingSaveRef.current && isMountedRef.current) {
          doSave(pendingSaveRef.current);
        }
      }, 500);
    },
    [doSave]
  );

  const setLanguage = useCallback(
    async (language: Language) => {
      await updateAndSave((prev) => ({ ...prev, language }));
    },
    [updateAndSave]
  );

  const setFontSize = useCallback(
    async (fontSize: FontSize) => {
      await updateAndSave((prev) => ({ ...prev, fontSize }));
    },
    [updateAndSave]
  );

  const setAppearanceMode = useCallback(
    async (appearanceMode: AppearanceMode) => {
      await updateAndSave((prev) => ({ ...prev, appearanceMode }));
    },
    [updateAndSave]
  );

  const setHighContrast = useCallback(
    async (highContrast: boolean) => {
      await updateAndSave((prev) => ({ ...prev, highContrast }));
    },
    [updateAndSave]
  );

  const setReduceMotion = useCallback(
    async (reduceMotion: boolean) => {
      await updateAndSave((prev) => ({ ...prev, reduceMotion }));
    },
    [updateAndSave]
  );

  const setNotificationPreference = useCallback(
    async <K extends keyof NotificationPreferences>(
      key: K,
      value: NotificationPreferences[K]
    ) => {
      await updateAndSave((prev) => ({
        ...prev,
        notifications: {
          ...prev.notifications,
          [key]: value,
        },
      }));
    },
    [updateAndSave]
  );

  const setCalendarStartDay = useCallback(
    async (calendarStartDay: CalendarStartDay) => {
      await updateAndSave((prev) => ({ ...prev, calendarStartDay }));
    },
    [updateAndSave]
  );

  const setShowWeekNumber = useCallback(
    async (showWeekNumber: boolean) => {
      await updateAndSave((prev) => ({ ...prev, showWeekNumber }));
    },
    [updateAndSave]
  );

  const setMapStyle = useCallback(
    async (mapStyle: MapStyle) => {
      await updateAndSave((prev) => ({ ...prev, mapStyle }));
    },
    [updateAndSave]
  );

  const setDefaultMapZoom = useCallback(
    async (defaultMapZoom: number) => {
      await updateAndSave((prev) => ({ ...prev, defaultMapZoom }));
    },
    [updateAndSave]
  );

  const setShareLocation = useCallback(
    async (shareLocation: boolean) => {
      await updateAndSave((prev) => ({ ...prev, shareLocation }));
    },
    [updateAndSave]
  );

  const setShareActivity = useCallback(
    async (shareActivity: boolean) => {
      await updateAndSave((prev) => ({ ...prev, shareActivity }));
    },
    [updateAndSave]
  );

  const setAutoSync = useCallback(
    async (autoSync: boolean) => {
      await updateAndSave((prev) => ({ ...prev, autoSync }));
    },
    [updateAndSave]
  );

  const setSyncOnWifiOnly = useCallback(
    async (syncOnWifiOnly: boolean) => {
      await updateAndSave((prev) => ({ ...prev, syncOnWifiOnly }));
    },
    [updateAndSave]
  );

  const setCacheSize = useCallback(
    async (cacheSize: "small" | "medium" | "large") => {
      await updateAndSave((prev) => ({ ...prev, cacheSize }));
    },
    [updateAndSave]
  );

  const setEnableBetaFeatures = useCallback(
    async (enableBetaFeatures: boolean) => {
      await updateAndSave((prev) => ({ ...prev, enableBetaFeatures }));
    },
    [updateAndSave]
  );

  const updatePreferences = useCallback(
    async (updates: Partial<UserPreferences>) => {
      await updateAndSave((prev) => ({ ...prev, ...updates }));
    },
    [updateAndSave]
  );

  const resetToDefaults = useCallback(async () => {
    await updateAndSave(() => DEFAULT_PREFERENCES);
  }, [updateAndSave]);

  const exportPreferences = useCallback(async (): Promise<string> => {
    return JSON.stringify(preferences, null, 2);
  }, [preferences]);

  const importPreferences = useCallback(
    async (json: string) => {
      try {
        const parsed = JSON.parse(json);
        // 驗證必要欄位存在
        if (typeof parsed !== "object" || parsed === null) {
          throw new Error("Invalid format");
        }
        await updateAndSave(() => ({ ...DEFAULT_PREFERENCES, ...parsed }));
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new Error("無效的 JSON 格式");
        }
        throw new Error("無效的設定格式");
      }
    },
    [updateAndSave]
  );

  // 使用 useMemo 確保 context value 穩定
  const contextValue = useMemo(
    () => ({
      preferences,
      loading,
      error,
      setLanguage,
      setFontSize,
      setAppearanceMode,
      setHighContrast,
      setReduceMotion,
      setNotificationPreference,
      setCalendarStartDay,
      setShowWeekNumber,
      setMapStyle,
      setDefaultMapZoom,
      setShareLocation,
      setShareActivity,
      setAutoSync,
      setSyncOnWifiOnly,
      setCacheSize,
      setEnableBetaFeatures,
      updatePreferences,
      resetToDefaults,
      exportPreferences,
      importPreferences,
    }),
    [
      preferences,
      loading,
      error,
      setLanguage,
      setFontSize,
      setAppearanceMode,
      setHighContrast,
      setReduceMotion,
      setNotificationPreference,
      setCalendarStartDay,
      setShowWeekNumber,
      setMapStyle,
      setDefaultMapZoom,
      setShareLocation,
      setShareActivity,
      setAutoSync,
      setSyncOnWifiOnly,
      setCacheSize,
      setEnableBetaFeatures,
      updatePreferences,
      resetToDefaults,
      exportPreferences,
      importPreferences,
    ]
  );

  return (
    <PreferencesContext.Provider value={contextValue}>
      {children}
    </PreferencesContext.Provider>
  );
}
