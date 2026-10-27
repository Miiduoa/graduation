import { creditPlanStorageKey, emptyCreditPlan, restoreCreditPlan, type CreditPlan } from './creditPlanner';

export const CREDIT_REVIEW_MAX_AGE_MS = 10 * 60 * 1000;

export function isCreditReviewFresh(fetchedAt: string, now = Date.now()): boolean {
  const readAt = Date.parse(fetchedAt);
  return Number.isFinite(readAt) && now >= readAt && now - readAt <= CREDIT_REVIEW_MAX_AGE_MS;
}

export function readTranscriptPlan(
  storage: Pick<Storage, 'getItem'>,
  uid: string,
  schoolId: string,
): CreditPlan {
  if (!uid || !schoolId) throw new Error('帳號與校園尚未確認，沒有讀取個人規劃。');
  const raw = storage.getItem(creditPlanStorageKey(uid, schoolId));
  if (raw === null) return emptyCreditPlan();
  const restored = restoreCreditPlan(raw);
  if (!restored) throw new Error('原規劃無法驗證，請先回到學分規劃備份或修復，沒有清空資料。');
  return restored;
}

/** 同一頁內的同步比較及寫入；不同分頁的變更另由 storage 事件提示，非跨裝置交易。 */
export function replaceTranscriptPlan(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  uid: string,
  schoolId: string,
  expected: CreditPlan,
  next: CreditPlan,
  isCurrent: () => boolean,
): void {
  const before = JSON.stringify(expected);
  const after = JSON.stringify(next);
  if (!restoreCreditPlan(before) || !restoreCreditPlan(after)) throw new Error('核對資料格式錯誤，沒有套用。');
  if (!isCurrent()) throw new Error('登入、校園或來源已變更，請重新核對。');
  const current = readTranscriptPlan(storage, uid, schoolId);
  if (JSON.stringify(current) !== before) throw new Error('原規劃已更新，請返回重新預覽；沒有覆蓋新資料。');
  if (!isCurrent()) throw new Error('這次核對已過期，沒有更新資料。');
  storage.setItem(creditPlanStorageKey(uid, schoolId), after);
}
