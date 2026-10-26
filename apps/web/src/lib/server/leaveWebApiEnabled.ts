/**
 * 請假站內送出／撤回／核閱是否改走 nuni-web `/api/fn`。
 * 只在伺服器 runtime 讀 process.env，預設關閉。同一個開關同時控制畫面與寫入。
 */
export const LEAVE_WEB_API_SERVER_FLAG = 'LEAVE_WEB_API_ENABLED';

export function isLeaveWebApiServerEnabled(
  raw: string | undefined = process.env.LEAVE_WEB_API_ENABLED,
): boolean {
  return typeof raw === 'string' && /^(1|true|on|yes)$/i.test(raw.trim());
}
