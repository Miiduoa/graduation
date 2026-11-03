import { emptyCreditPlan, restoreCreditPlan, type CreditPlan } from './creditPlanner';

type PlanStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Synchronous local comparison; not a cross-tab database transaction. */
export function replaceLocalScenarioPlan(
  storage: PlanStorage,
  key: string,
  expected: CreditPlan,
  next: CreditPlan,
  isCurrent: () => boolean,
): CreditPlan {
  const before = JSON.stringify(expected);
  const after = JSON.stringify(next);
  const validNext = restoreCreditPlan(after);
  if (!restoreCreditPlan(before) || !validNext) throw new Error('方案格式無效，原規劃不變。');
  if (!isCurrent()) throw new Error('確認內容已失效，請重新檢視。');
  const raw = storage.getItem(key);
  const current = raw === null ? emptyCreditPlan() : restoreCreditPlan(raw);
  if (!current || JSON.stringify(current) !== before) {
    throw new Error('其他分頁已更新規劃，或本機資料無法讀取。請重新讀取後比較，不會覆蓋較新的內容。');
  }
  if (!isCurrent()) throw new Error('目前帳號或輸入已改變，請重新檢視。');
  storage.setItem(key, after);
  return validNext;
}
