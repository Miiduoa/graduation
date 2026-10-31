import { ECAMPUS_PAUSED_CODE, ECAMPUS_PAUSED_MESSAGE } from '../ecampusPause';

export { ECAMPUS_PAUSED_CODE, ECAMPUS_PAUSED_MESSAGE };

export const ECAMPUS_FETCH_PAUSED_ENV = 'PU_ECAMPUS_FETCH_PAUSED';

type Env = Record<string, string | undefined>;

/**
 * PU_ECAMPUS_FETCH_PAUSED 為 1 或 true（不分大小寫）時，暫停所有打 alcat.pu.edu.tw、
 * mypu.pu.edu.tw 的資料抓取（課表、成績、mypu SSO 轉接、背景更新）。學號登入不受影響。
 * 未設或其他值時行為完全不變。
 */
export function isEcampusFetchPaused(env: Env = process.env): boolean {
  const raw = String(env[ECAMPUS_FETCH_PAUSED_ENV] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export function isEcampusPausedResult(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Record<string, unknown>).paused === true &&
      (value as Record<string, unknown>).code === ECAMPUS_PAUSED_CODE,
  );
}
