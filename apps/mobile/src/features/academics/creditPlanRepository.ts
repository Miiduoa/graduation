import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  emptyCreditPlan,
  restoreCreditPlan,
  type CreditPlan,
} from '@campus/shared/src/creditPlanner';
import { getScopedStorageKey } from '../../services/scopedStorage';

export const CREDIT_PLAN_BACKUP_MAX_BYTES = 90_000;

export function mobileCreditPlanKey(uid: string | null, schoolId: string): string {
  return getScopedStorageKey('credit-plan-v1', { uid, schoolId });
}

/** Only this account+campus entry is read. An invalid entry is reported, never reset. */
export async function readMobileCreditPlan(scopeKey: string): Promise<CreditPlan> {
  const raw = await AsyncStorage.getItem(scopeKey);
  if (raw === null) return emptyCreditPlan();
  const restored = restoreCreditPlan(raw);
  if (!restored) throw new Error('原有學分規劃無法驗證，為避免覆寫請先保留原始資料。');
  return restored;
}

export function parsePortableCreditPlan(text: string): CreditPlan {
  const source = text.replace(/^\ufeff/, '');
  const restored = restoreCreditPlan(source);
  if (!restored) throw new Error('備份格式不正確，必須是 Campus One 的學分規劃 JSON。');
  return restored;
}

export async function writeMobileCreditPlan(scopeKey: string, plan: CreditPlan): Promise<void> {
  const raw = JSON.stringify(plan);
  if (raw.length > CREDIT_PLAN_BACKUP_MAX_BYTES || !restoreCreditPlan(raw)) {
    throw new Error('學分規劃內容超出限制或格式錯誤，未儲存變更。');
  }
  await AsyncStorage.setItem(scopeKey, raw);
}

export function portableCreditPlanJson(plan: CreditPlan): string {
  const data = JSON.stringify(plan, null, 2);
  if (!restoreCreditPlan(data)) throw new Error('規劃內容無法驗證，不能產生備份。');
  return data;
}
