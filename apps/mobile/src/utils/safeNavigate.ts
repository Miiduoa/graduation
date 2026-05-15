/**
 * safeNavigate — 容錯 navigation 包裝
 *
 * 直接 navigation.navigate('NotFoundRoute') 會 console error。
 * 用 safeNavigate 包起來：找到 route 就跳，找不到就 fallback（toast/alert 或無聲跳到 fallbackRoute）。
 */
import { Alert } from 'react-native';

export interface SafeNavigateOptions {
  fallbackRoute?: string;
  fallbackParams?: Record<string, unknown>;
  /** 找不到 route 時顯示的提示文字；給 null 表示靜默 */
  fallbackMessage?: string | null;
}

export function safeNavigate(
  navigation: { navigate?: (route: string, params?: Record<string, unknown>) => void },
  route: string,
  params?: Record<string, unknown>,
  options: SafeNavigateOptions = {},
): boolean {
  const navigate = navigation?.navigate;
  if (typeof navigate !== 'function') {
    if (options.fallbackMessage !== null) {
      Alert.alert('無法跳轉', options.fallbackMessage ?? `路由 ${route} 不可用`);
    }
    return false;
  }
  try {
    navigate(route, params);
    return true;
  } catch (e) {
    // 嘗試 fallback route
    if (options.fallbackRoute) {
      try {
        navigate(options.fallbackRoute, options.fallbackParams);
        return true;
      } catch {
        /* swallow */
      }
    }
    if (options.fallbackMessage !== null) {
      Alert.alert('即將推出', options.fallbackMessage ?? `${route} 還沒準備好，敬請期待`);
    }
    return false;
  }
}
