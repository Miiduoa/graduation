import { expect, it } from 'vitest';
import {
  isLmsConnectingRetryReason,
  LMS_CONNECTING_RETRY_LIMIT,
  lmsConnectingRetryDelayMs,
} from './lmsConnectingRetry';

it('uses exponential backoff with a cap and a retry budget', () => {
  expect(lmsConnectingRetryDelayMs(0)).toBe(1_000);
  expect(lmsConnectingRetryDelayMs(1)).toBe(2_000);
  expect(lmsConnectingRetryDelayMs(2)).toBe(4_000);
  expect(lmsConnectingRetryDelayMs(3)).toBe(8_000);
  expect(lmsConnectingRetryDelayMs(4)).toBe(16_000);
  expect(lmsConnectingRetryDelayMs(5)).toBe(16_000);
  expect(lmsConnectingRetryDelayMs(-2)).toBe(1_000);
  expect(LMS_CONNECTING_RETRY_LIMIT).toBe(5);
});

it('retries connecting and generic unavailable, not reconnect', () => {
  expect(isLmsConnectingRetryReason('connecting')).toBe(true);
  expect(isLmsConnectingRetryReason('unavailable')).toBe(true);
  expect(isLmsConnectingRetryReason('reconnect')).toBe(false);
  expect(isLmsConnectingRetryReason('permission')).toBe(false);
});
