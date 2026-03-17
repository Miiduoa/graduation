// 認證狀態
export { AuthProvider, useAuth } from "./auth";

// 學校選擇
export { SchoolProvider, useSchool } from "./school";

// 主題
export { ThemeProvider, useTheme } from "./theme";

// Demo 模式
export { DemoProvider, useDemo, type DemoMode } from "./demo";

// 收藏
export { FavoritesProvider, useFavorites } from "./favorites";

// 通知
export { NotificationsProvider, useNotifications } from "./notifications";

// 搜尋歷史
export { SearchHistoryProvider, useSearchHistory } from "./searchHistory";

// 課表
export { 
  ScheduleProvider, 
  useSchedule, 
  type ScheduleEvent, 
  type WeekSchedule, 
  type ScheduleView,
  type ScheduleFilter,
} from "./schedule";

// 使用者偏好設定
export { 
  PreferencesProvider, 
  usePreferences,
  LANGUAGE_NAMES,
  FONT_SIZE_VALUES,
  type Language,
  type FontSize,
  type AppearanceMode,
  type MapStyle,
  type UserPreferences,
} from "./preferences";

// 合併的 Provider（效能優化）
export {
  AppCoreProviders,
  AppAuthProviders,
  AuthAwareProviders,
  AllAppProviders,
  useOptimizedRerender,
  useStableCallback,
  useMemoizedValue,
  createContextSelector,
  useUserId,
  useIsAuthenticated,
  useSchoolId,
  useIsDarkMode,
} from "./CombinedProviders";
