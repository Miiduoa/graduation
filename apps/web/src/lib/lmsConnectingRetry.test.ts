import { expect, it } from 'vitest';
import { STUDENT_LMS_CONNECTING_WINDOW_MS } from './schoolLoginTimeouts';
import {
  isLmsConnectingRetryReason,
  LMS_CONNECTING_RETRY_LIMIT,
  lmsConnectingRetryBudgetMs,
  lmsConnectingRetryDelayMs,
} from './lmsConnectingRetry';

it('uses exponential backoff with a cap and a retry budget', () => {
  expect(lmsConnectingRetryDelayMs(0)).toBe(2_000);
  expect(lmsConnectingRetryDelayMs(1)).toBe(4_000);
  expect(lmsConnectingRetryDelayMs(2)).toBe(8_000);
  expect(lmsConnectingRetryDelayMs(3)).toBe(16_000);
  expect(lmsConnectingRetryDelayMs(4)).toBe(16_000);
  expect(lmsConnectingRetryDelayMs(5)).toBe(16_000);
  expect(lmsConnectingRetryDelayMs(-2)).toBe(2_000);
  expect(LMS_CONNECTING_RETRY_LIMIT).toBe(5);
  expect(lmsConnectingRetryBudgetMs()).toBe(46_000);
  expect(lmsConnectingRetryBudgetMs()).toBeGreaterThanOrEqual(STUDENT_LMS_CONNECTING_WINDOW_MS);
});

it('retries connecting, not generic unavailable', () => {
  expect(isLmsConnectingRetryReason('connecting')).toBe(true);
  expect(isLmsConnectingRetryReason('unavailable')).toBe(false);
  expect(isLmsConnectingRetryReason('reconnect')).toBe(false);
  expect(isLmsConnectingRetryReason('permission')).toBe(false);
});
