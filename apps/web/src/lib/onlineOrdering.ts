/**
 * 網頁的線上點餐開關（NEXT_PUBLIC_ONLINE_ORDERING）。
 * 沒設就是關：我的訂單沒有單時直接寫「目前還不能線上點餐」，助理遇到點餐也只回這句，不帶去我的訂單。
 * App 上架、後端 ONLINE_ORDERING_ENABLED 打開之後，再把這個設成 true。
 */
export const ONLINE_ORDERING_OFF_TEXT = '目前還不能線上點餐';

export function isWebOnlineOrderingEnabled(raw: string | undefined = process.env.NEXT_PUBLIC_ONLINE_ORDERING): boolean {
  return typeof raw === 'string' && /^(1|true|on|yes)$/i.test(raw.trim());
}
