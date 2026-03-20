// 資料載入
export { useAsyncList, type UseAsyncListOptions, type UseAsyncListResult } from "./useAsyncList";
export { useDataSource } from "./useDataSource";
export { 
  useCacheSubscription, 
  useMultiCacheSubscription, 
  useCachedData 
} from "./useCacheSubscription";

// 網路狀態
export { useNetworkStatus } from "./useNetworkStatus";

// 防抖與節流
export { useDebounce, useDebouncedCallback, useLeadingDebounce } from "./useDebounce";
export { useThrottle, useThrottledCallback, usePreventDoubleClick } from "./useThrottle";
export { useAnimatedAddition, useAnimatedValue } from "./useAnimatedValue";
export { useConstant, useLatestValue } from "./useLatestValue";

// 分頁
export { 
  usePagination, 
  useInfiniteScroll, 
  type PaginationOptions, 
  type PaginationResult 
} from "./usePagination";

// 表單
export { useForm, validators, type ValidationRule, type FieldConfig, type FormConfig } from "./useForm";

// 地理位置
export { 
  useGeolocation, 
  calculateDistance, 
  calculateBearing,
  type GeolocationOptions,
  type GeolocationResult 
} from "./useGeolocation";

// 儲存
export { 
  useAsyncStorage, 
  useMultiStorage, 
  useBooleanStorage, 
  useHistoryStorage 
} from "./useStorage";
export { usePersistedState } from "./usePersistedState";

// 鍵盤
export { 
  useKeyboard, 
  useKeyboardAvoidingPadding, 
  useKeyboardAutoScroll 
} from "./useKeyboard";

// App 狀態
export {
  useAppState,
  useAppStateCallback,
  useForegroundEffect,
  useAppRefresh,
  useKeepAwake,
  type AppStateOptions,
  type AppStateResult,
} from "./useAppState";

// Deep Link
export {
  useDeepLink,
  useDeepLinkNavigation,
  useUniversalLink,
  useExternalApps,
  buildDeepLink,
  type DeepLinkRoute,
  type DeepLinkOptions,
  type DeepLinkResult,
} from "./useDeepLink";

// 效能追蹤
export {
  useRenderTracking,
  useWhyDidYouRender,
  useMemoryTracking,
  getAllRenderStats,
  clearRenderStats,
  printRenderStatsReport,
  type RenderTrackingOptions,
  type RenderStats,
} from "./useRenderTracking";
