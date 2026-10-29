/** 登入後背景掛玩課雲 session 尚未寫入時，頁面自動重試的退避。 */
export const LMS_CONNECTING_RETRY_LIMIT = 5;
export const LMS_CONNECTING_RETRY_BASE_MS = 2_000;
export const LMS_CONNECTING_RETRY_MAX_MS = 16_000;

export function lmsConnectingRetryDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.trunc(attempt)) : 0;
  return Math.min(LMS_CONNECTING_RETRY_MAX_MS, LMS_CONNECTING_RETRY_BASE_MS * 2 ** n);
}

export function lmsConnectingRetryBudgetMs(): number {
  let total = 0;
  for (let attempt = 0; attempt < LMS_CONNECTING_RETRY_LIMIT; attempt += 1) {
    total += lmsConnectingRetryDelayMs(attempt);
  }
  return total;
}

export function isLmsConnectingRetryReason(reason: string): boolean {
  return reason === 'connecting';
}
