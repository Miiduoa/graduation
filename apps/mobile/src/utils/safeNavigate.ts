/**
 * safeNavigate — 容錯 navigation 包裝
 *
 * 直接 navigation.navigate('NotFoundRoute') 會 console.warn 但 **不會 throw**。
 * 結果是按鈕按下去看起來「沒反應」— demo 時最尷尬的情況。
 *
 * 本工具：
 *   1. 用 getState() 預先檢查 route 是否註冊（含嵌套 navigator）
 *   2. 找不到 → 直接顯示 fallback Alert 或 toast，不會 silent
 *   3. 找到 → 正常 navigate
 *   4. 找到但 navigate 本身炸 → 用 try/catch 接住
 *
 * 給 fallbackMessage = null 表示靜默（用在已知會 navigate 但有時不需要提示）
 */
import { Alert } from 'react-native';

export interface SafeNavigateOptions {
  fallbackRoute?: string;
  fallbackParams?: Record<string, unknown>;
  /** 找不到 route 時顯示的提示文字；給 null 表示靜默 */
  fallbackMessage?: string | null;
  /** 改變 Alert 標題（預設「即將推出」） */
  fallbackTitle?: string;
}

// 從 navigation state（含嵌套）扁平化所有 route name
function collectRouteNames(state: unknown, out: Set<string>): void {
  if (!state || typeof state !== 'object') return;
  const s = state as { routeNames?: string[]; routes?: Array<{ state?: unknown }> };
  if (Array.isArray(s.routeNames)) {
    for (const r of s.routeNames) out.add(r);
  }
  if (Array.isArray(s.routes)) {
    for (const r of s.routes) {
      if (r?.state) collectRouteNames(r.state, out);
    }
  }
}

export function isRouteRegistered(
  navigation: { getState?: () => unknown; getParent?: () => unknown } | null | undefined,
  route: string,
): boolean {
  if (!navigation || typeof navigation.getState !== 'function') return false;
  try {
    const names = new Set<string>();
    // 先收 root 端的 state — 從最頂層 navigator 開始往下走
    let cursor: any = navigation;
    let topMost: any = navigation;
    let safety = 0;
    while (cursor && typeof cursor.getParent === 'function' && safety < 10) {
      const parent = cursor.getParent();
      if (!parent) break;
      topMost = parent;
      cursor = parent;
      safety++;
    }
    if (topMost && typeof topMost.getState === 'function') {
      collectRouteNames(topMost.getState(), names);
    } else {
      collectRouteNames(navigation.getState!(), names);
    }
    return names.has(route);
  } catch {
    return false;
  }
}

export function safeNavigate(
  navigation: {
    navigate?: (route: string, params?: Record<string, unknown>) => void;
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
    const title = options.fallbackTitle ?? '即將推出';
    Alert.alert(title, options.fallbackMessage ?? msg ?? `${route} 還沒準備好，敬請期待`);
  };

  if (typeof navigate !== 'function') {
    showFallback(`路由 ${route} 不可用`);
    return false;
  }

  // 預先檢查 route 是否註冊（含 nested navigators）— 找不到就 fallback
  const isRegistered = isRouteRegistered(navigation, route);
  if (!isRegistered) {
    // 嘗試 fallback route
    if (options.fallbackRoute && isRouteRegistered(navigation, options.fallbackRoute)) {
      try {
        navigate(options.fallbackRoute, options.fallbackParams);
        return true;
      } catch {
        /* swallow & 繼續 fallback Alert */
      }
    }
    showFallback();
    return false;
  }

  try {
    navigate(route, params);
    return true;
  } catch (e) {
    if (options.fallbackRoute) {
      try {
        navigate(options.fallbackRoute, options.fallbackParams);
        return true;
      } catch {
        /* swallow */
      }
    }
    showFallback();
    return false;
  }
}
