/** App 的線上點餐開關，對齊網頁 NEXT_PUBLIC_ONLINE_ORDERING：沒設就是關。 */
export const ONLINE_ORDERING_OFF_TEXT = '目前還不能線上點餐';

export function isAppOnlineOrderingEnabled(
  raw: string | undefined = process.env.EXPO_PUBLIC_ONLINE_ORDERING,
): boolean {
  return typeof raw === 'string' && /^(1|true|on|yes)$/i.test(raw.trim());
}
