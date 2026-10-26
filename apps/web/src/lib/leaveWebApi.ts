import { areFunctionsConfigured } from '@/lib/functionsUrl';

/**
 * 請假站內送出／撤回／核閱是否改走 nuni-web `/api/fn`。
 * 未設定或不是明確開啟時維持關閉，正式站不改設定就繼續顯示「尚未開放」。
 */
export const LEAVE_WEB_API_FLAG = 'NEXT_PUBLIC_LEAVE_WEB_API';

export function isLeaveWebApiEnabled(
  raw: string | undefined = process.env.NEXT_PUBLIC_LEAVE_WEB_API,
): boolean {
  return typeof raw === 'string' && /^(1|true|on|yes)$/i.test(raw.trim());
}

export function isLeaveBackendAvailable(): boolean {
  return isLeaveWebApiEnabled() || areFunctionsConfigured();
}
