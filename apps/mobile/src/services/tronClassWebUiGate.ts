import { Alert, Linking } from 'react-native';

import {
  isTronClassDataFetchEnabled,
  isTronClassPuHostedUrl,
  TRONCLASS_DATA_DISABLED_MESSAGE,
} from './tronClassDataEnabled';

/**
 * 將 WebView／系統瀏覽器／教材檢視器開啟 TronClass（PU）站台的行為，
 * 與 `EXPO_PUBLIC_TRONCLASS_DATA_ENABLED` 對齊；若已關閉則擋截並提示。
 *
 * @returns `true` 表示可繼續開啟 TronClass 相關 URL。
 */
export function guardTronClassWebAccessOrAlert(): boolean {
  if (isTronClassDataFetchEnabled()) return true;
  Alert.alert('LMS（TronClass）已關閉', TRONCLASS_DATA_DISABLED_MESSAGE);
  return false;
}

function shouldSkipLinkingCanOpenUrl(trimmed: string): boolean {
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('sms:') ||
    trimmed.startsWith('app-settings:') ||
    lower.startsWith('geo:') ||
    lower.startsWith('maps:') ||
    lower.startsWith('market:') ||
    lower.startsWith('webcal:')
  );
}

/**
 * 使用者可能從繳交連結、QR、課綱等進入任意外部 URL；若為玩課雲網域則與 LMS 開關對齊。
 */
export async function linkingOpenWithPuTronClassGate(url: string): Promise<boolean> {
  if (!url || typeof url !== 'string') return false;
  if (isTronClassPuHostedUrl(url) && !guardTronClassWebAccessOrAlert()) return false;
  try {
    const trimmed = url.trim();
    if (!shouldSkipLinkingCanOpenUrl(trimmed)) {
      const canOpen = await Linking.canOpenURL(trimmed);
      if (!canOpen) return false;
    }
    await Linking.openURL(trimmed);
    return true;
  } catch {
    return false;
  }
}
