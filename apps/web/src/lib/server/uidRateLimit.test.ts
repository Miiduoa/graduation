// @vitest-environment node
import { expect, it } from 'vitest';
import { HttpsError } from './httpsError';
import { createUidRateLimiter } from './uidRateLimit';

it('allows 10 requests per uid per minute and rejects the 11th', () => {
  const limiter = createUidRateLimiter({ requestsPerMinute: 10 });
  for (let i = 0; i < 10; i += 1) limiter.check('alice');
  expect(() => limiter.check('alice')).toThrow(HttpsError);
  try {
    limiter.check('alice');
  } catch (error) {
    expect(error).toMatchObject({ code: 'resource-exhausted', message: 'Too many requests' });
  }
});

it('resets the per-minute window after 60 seconds', () => {
  let now = 1_000_000;
  const limiter = createUidRateLimiter({ requestsPerMinute: 2, now: () => now });
  limiter.check('alice');
  limiter.check('alice');
  expect(() => limiter.check('alice')).toThrow(HttpsError);
  now += 60_000;
  expect(() => limiter.check('alice')).not.toThrow();
});

it('rejects a 21st invalid join code within an hour', () => {
  const limiter = createUidRateLimiter({
    requestsPerMinute: 1000,
    invalidJoinCodesPerHour: 20,
  });
  for (let i = 0; i < 20; i += 1) {
    limiter.check('alice');
    limiter.assertJoinCodeAttemptsAllowed('alice');
    limiter.recordInvalidJoinCode('alice');
  }
  limiter.check('alice');
  expect(() => limiter.assertJoinCodeAttemptsAllowed('alice')).toThrow(HttpsError);
});

it('caps the number of remembered uids', () => {
  const limiter = createUidRateLimiter({ maxKeys: 4, requestsPerMinute: 100 });
  for (let i = 0; i < 8; i += 1) limiter.check(`user-${i}`);
  expect(limiter.size()).toBeLessThanOrEqual(4);
});
