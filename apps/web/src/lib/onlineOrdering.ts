/**
 * 網頁的線上點餐開關（NEXT_PUBLIC_ONLINE_ORDERING）。
 * 沒設就是關：生活頁不放「我的訂單」；我的訂單標題／副標題／未登入都寫「目前還不能線上點餐」；
 * 助理遇到點餐或問訂單狀態也只回這句，不帶去我的訂單。
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
