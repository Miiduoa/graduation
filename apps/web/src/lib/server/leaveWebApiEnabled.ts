/**
 * 請假四支 /api/fn 是否真正寫入。只在伺服器端讀 process.env，預設關閉。
 * 畫面路徑由 NEXT_PUBLIC_LEAVE_WEB_API 決定；兩個開關都開了才會真的寫入。
 */
export const LEAVE_WEB_API_SERVER_FLAG = 'LEAVE_WEB_API_ENABLED';

export function isLeaveWebApiServerEnabled(
  raw: string | undefined = process.env.LEAVE_WEB_API_ENABLED,
): boolean {
  return typeof raw === 'string' && /^(1|true|on|yes)$/i.test(raw.trim());
}
