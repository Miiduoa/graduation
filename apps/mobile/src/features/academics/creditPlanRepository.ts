import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  emptyCreditPlan,
  restoreCreditPlan,
  type CreditPlan,
} from '@campus/shared/src/creditPlanner';
import { getScopedStorageKey } from '../../services/scopedStorage';

export const CREDIT_PLAN_BACKUP_MAX_BYTES = 90_000;

// Each scope has its own queue. A remounted screen must wait for its older write
// before reading, without blocking unrelated accounts or campuses.
const pending = new Map<string, Promise<void>>();
function inScopeOrder<T>(scopeKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(scopeKey) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  pending.set(scopeKey, settled);
  void settled.then(() => {
    if (pending.get(scopeKey) === settled) pending.delete(scopeKey);
  });
  return result;
}

export function mobileCreditPlanKey(uid: string | null, schoolId: string): string {
  return getScopedStorageKey('credit-plan-v1', { uid, schoolId });
}

/** UTF-8 length without relying on TextEncoder being installed in Hermes. */
export function creditPlanUtf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > CREDIT_PLAN_BACKUP_MAX_BYTES) return bytes;
  }
  return bytes;
}

/** Read failures and invalid entries stay visible; neither is an empty plan. */
export function readMobileCreditPlan(scopeKey: string): Promise<CreditPlan> {
  return inScopeOrder(scopeKey, async () => {
    const raw = await AsyncStorage.getItem(scopeKey);
    if (raw === null) return emptyCreditPlan();
    const restored = restoreCreditPlan(raw);
    if (!restored) throw new Error('原有學分規劃無法驗證，為避免覆寫請先保留原始資料。');
    return restored;
  });
}

export function parsePortableCreditPlan(text: string): CreditPlan {
  // Check the contents too: DocumentPicker size metadata may be absent.
  if (creditPlanUtf8Bytes(text) > CREDIT_PLAN_BACKUP_MAX_BYTES) {
    throw new Error('備份檔案超過 90 KB，未匯入任何資料。');
  }
  const restored = restoreCreditPlan(text.replace(/^\ufeff/, ''));
  if (!restored) throw new Error('備份格式不正確，必須是 Campus One 的學分規劃 JSON。');
  return restored;
}

export async function writeMobileCreditPlan(scopeKey: string, plan: CreditPlan): Promise<void> {
  // Serialize before enqueueing so later mutations cannot change an accepted write.
  const raw = JSON.stringify(plan);
  if (!restoreCreditPlan(raw)) {
    throw new Error('學分規劃內容超出限制或格式錯誤，未儲存變更。');
  }
  await inScopeOrder(scopeKey, () => AsyncStorage.setItem(scopeKey, raw));
}

/** 同一份本機規劃在預覽後若被其他畫面更新，就拒絕舊確認，不覆寫新資料。 */
export async function replaceReviewedCreditPlan(
  scopeKey: string,
  expected: CreditPlan,
  next: CreditPlan,
  isCurrent: () => boolean,
): Promise<void> {
  const before = JSON.stringify(expected);
  const after = JSON.stringify(next);
  if (!restoreCreditPlan(before) || !restoreCreditPlan(after)) {
    throw new Error('核對內容格式不正確，未更新規劃。');
  }
  await inScopeOrder(scopeKey, async () => {
    if (!isCurrent()) throw new Error('這次核對已失效，未更新規劃。');
    const raw = await AsyncStorage.getItem(scopeKey);
    const current = raw === null ? emptyCreditPlan() : restoreCreditPlan(raw);
    if (!current || JSON.stringify(current) !== before) {
      throw new Error('原規劃已變更或無法讀取，請重新讀取並核對；沒有覆寫現有資料。');
    }
    if (!isCurrent()) throw new Error('這次核對已失效，未更新規劃。');
    await AsyncStorage.setItem(scopeKey, after);
  });
}

export function portableCreditPlanJson(plan: CreditPlan): string {
  // Compact JSON keeps valid long Chinese course names within the portable limit.
  const data = JSON.stringify(plan);
  if (!restoreCreditPlan(data)) throw new Error('規劃內容無法驗證，不能產生備份。');
  if (creditPlanUtf8Bytes(data) > CREDIT_PLAN_BACKUP_MAX_BYTES) {
    throw new Error('備份超過 90 KB，請先整理規劃內容；本機資料沒有刪除。');
  }
  return data;
}
