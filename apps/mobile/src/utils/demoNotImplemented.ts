/**
 * Demo Not Implemented — 統一處理「按下去 demo 還沒做」的 UX
 *
 * 設計動機：
 *   demo 時最尷尬就是「按了沒反應」。但 mobile app 不可能 100% 把所有按鈕都接好，
 *   一定有些是「正式版才有、demo 不展示」。這時候按鈕被點到不該裝聾作啞，
 *   要清楚告訴使用者「這功能 demo 沒展示」+ 引導到能展示的功能。
 *
 * 用法（按下去顯示 Alert）：
 *   <Pressable onPress={() => showDemoNotImplemented('VIP 訂購單')}>...
 *
 * 進階用法（指引去看相關功能）：
 *   showDemoNotImplemented('學分審核', { suggestion: '請看「成績試算」展示同類分析' })
 *
 * 不要在主 demo 動線上看到這個 Alert。
 * 若 demo 主流程的 button 跳出這個 = 那個 button 應該被實作或被隱藏。
 */
import { Alert } from 'react-native';

export interface DemoNotImplementedOptions {
  /** 額外引導文（顯示在 Alert 內） */
  suggestion?: string;
  /** Alert 標題（預設「Demo 版未開放」） */
  title?: string;
  /** 用 console.warn 紀錄到 log（給開發 / QA 用） */
  log?: boolean;
}

export function showDemoNotImplemented(
  featureName: string,
  options: DemoNotImplementedOptions = {},
): void {
  const title = options.title ?? 'Demo 版未開放';
  const baseBody = `「${featureName}」在 demo 版尚未實作。`;
  const body = options.suggestion
    ? `${baseBody}\n\n${options.suggestion}`
    : `${baseBody}\n\n正式版會接上對應後端與權限。`;

  if (options.log) {
    // eslint-disable-next-line no-console
    console.warn('[demo-not-implemented]', featureName, options.suggestion ?? '');
  }
  Alert.alert(title, body, [{ text: '了解' }]);
}

/**
 * 給 Pressable 直接用的 onPress factory。
 *
 * 用法：
 *   <Pressable onPress={demoOnPress('Loyalty 推播設定')}>...
 */
export function demoOnPress(featureName: string, options?: DemoNotImplementedOptions) {
  return () => showDemoNotImplemented(featureName, options);
}

/**
 * 在 demo 模式下 wrap 一個可能炸掉的 callback。
 * 如果 callback 是 undefined / null / throw → 顯示 demo notice。
 */
export function withDemoFallback<T extends (...args: any[]) => any>(
  callback: T | undefined | null,
  featureName: string,
  options?: DemoNotImplementedOptions,
): (...args: Parameters<T>) => ReturnType<T> | undefined {
  return (...args: Parameters<T>): ReturnType<T> | undefined => {
    if (typeof callback !== 'function') {
      showDemoNotImplemented(featureName, options);
      return undefined;
    }
    try {
      return callback(...args);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[demo-fallback]', featureName, e);
      showDemoNotImplemented(featureName, {
        ...options,
        suggestion: options?.suggestion ?? `（執行時出錯：${(e as Error)?.message ?? '未知錯誤'}）`,
      });
      return undefined;
    }
  };
}
