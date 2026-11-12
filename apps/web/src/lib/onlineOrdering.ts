/**
 * 網頁的線上點餐開關（NEXT_PUBLIC_ONLINE_ORDERING）。
 * 沒設就是關：不開放建立新訂單，生活頁及助理仍依這個旗標顯示點餐入口。
 * 原「我的訂單」讀取本人歷史紀錄，另依登入狀態與所選校園核對，不受新點餐開關影響。
 * App 上架、後端 ONLINE_ORDERING_ENABLED 打開之後，再把這個設成 true。
 */
export const ONLINE_ORDERING_OFF_TEXT = '目前還不能線上點餐';
export {
  FOOD_PAGE_SUBTITLE_WHEN_ORDERING_OFF,
  FOOD_PAGE_SUBTITLE_WHEN_ORDERING_ON,
  foodPageSubtitle,
} from '@campus/shared/src/foodPageCopy';

export function isWebOnlineOrderingEnabled(raw: string | undefined = process.env.NEXT_PUBLIC_ONLINE_ORDERING): boolean {
  return typeof raw === 'string' && /^(1|true|on|yes)$/i.test(raw.trim());
}

/** 問訂單進度、取餐號碼這類，不是在點餐、也不是在問菜單。 */
export function isWebOrderStatusQuestion(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  return /餐點好了沒|餐點好了嗎|餐好了沒|餐做好了|我的取餐號碼|取餐號碼|訂單狀態|我的訂單|訂單好了沒|點的(?:餐|東西|飯).{0,8}好了/.test(t);
}
