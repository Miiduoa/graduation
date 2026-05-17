/**
 * safeNavigate — 容錯 navigation 包裝（含 cross-tab 自動處理）
 *
 * 解決問題：
 *   1. React Navigation 的 `navigate('NotFoundRoute')` 不會 throw，按鈕看起來「沒反應」
 *   2. Cross-tab navigation：當前 navigator 沒有目標 route → 自動查 routeRegistry 找 tab，
 *      用 `navigate(tabName, { screen, params })` 跨 tab 跳轉
 *   3. 找不到 → 顯示明確 fallback Alert，不會 silent
 */
import { Alert } from 'react-native';
import { ROUTE_TO_TAB, isRouteRegistered, resolveTabForRoute } from './routeRegistry';

export interface SafeNavigateOptions {
  fallbackRoute?: string;
  fallbackParams?: Record<string, unknown>;
  /** 找不到 route 時顯示的提示文字；給 null 表示靜默 */
  fallbackMessage?: string | null;
  /** 改變 Alert 標題（預設「無法開啟」） */
  fallbackTitle?: string;
}

// Re-export 給其他模組使用
export { isRouteRegistered, resolveTabForRoute, ROUTE_TO_TAB } from './routeRegistry';

export function safeNavigate(
  navigation: {
    navigate?: (...args: any[]) => void;
    getState?: () => unknown;
    getParent?: () => unknown;
  } | null | undefined,
  route: string,
  params?: Record<string, unknown>,
  options: SafeNavigateOptions = {},
): boolean {
  const navigate = navigation?.navigate;
  const showFallback = (msg?: string) => {
    if (options.fallbackMessage === null) return;
    const title = options.fallbackTitle ?? '無法開啟';
    Alert.alert(title, options.fallbackMessage ?? msg ?? `「${route}」目前無法存取，請稍後再試或回到主畫面。`);
  };

  if (typeof navigate !== 'function') {
    showFallback(`navigation 物件不可用`);
    return false;
  }

  // Step 1: 試試當前 stack（最快）
  if (isRouteRegistered(navigation, route)) {
    try {
      navigate(route, params);
      return true;
    } catch {
      /* fall through to fallback handling */
    }
  }

  // Step 2: route 不在當前 navigator → 看 routeRegistry 找 tab
  const targetTab = resolveTabForRoute(route);
  if (targetTab) {
    try {
      // navigate('TabName', { screen: 'RouteName', params: {...} })
      // 這個 pattern 會把目標 tab 切換到目標 screen
      navigate(targetTab, { screen: route, params });
      return true;
    } catch (e) {
      // fallback
    }
  }

  // Step 3: fallbackRoute（caller 指定的）
  if (options.fallbackRoute) {
    const fbTab = resolveTabForRoute(options.fallbackRoute);
    try {
      if (fbTab) {
        navigate(fbTab, { screen: options.fallbackRoute, params: options.fallbackParams });
      } else {
        navigate(options.fallbackRoute, options.fallbackParams);
      }
      return true;
    } catch {
      /* swallow */
    }
  }

  showFallback();
  return false;
}
