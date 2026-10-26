import { areFunctionsConfigured } from '@/lib/functionsUrl';

/**
 * 客戶端：請假頁／核閱頁是否改打 nuni-web `/api/fn`。
 * 未設定時畫面維持「尚未開放」。真正寫入另看伺服器端 LEAVE_WEB_API_ENABLED。
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
