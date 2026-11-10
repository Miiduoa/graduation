// @vitest-environment node
import { expect, it } from 'vitest';
import { HttpsError } from './httpsError';
import { createPrivateFileRateLimiter } from './privateFileRateLimit';

it('allows six uploads per minute then rejects', () => {
  const limiter = createPrivateFileRateLimiter({ uploadsPerMinute: 6, requestsPerMinute: 100 });
  for (let i = 0; i < 6; i += 1) limiter.checkUpload('alice');
  expect(() => limiter.checkUpload('alice')).toThrow(HttpsError);
});

it('allows twenty ticket requests per minute then rejects', () => {
  const limiter = createPrivateFileRateLimiter({ requestsPerMinute: 20, uploadsPerMinute: 100 });
  for (let i = 0; i < 20; i += 1) limiter.checkRequest('alice');
  expect(() => limiter.checkRequest('alice')).toThrow(HttpsError);
});

it('resets after a minute', () => {
  let now = 1_000_000;
  const limiter = createPrivateFileRateLimiter({
    uploadsPerMinute: 1,
    requestsPerMinute: 1,
    now: () => now,
  });
  limiter.checkRequest('alice');
  limiter.checkUpload('alice');
  expect(() => limiter.checkRequest('alice')).toThrow(HttpsError);
  now += 60_000;
  expect(() => limiter.checkRequest('alice')).not.toThrow();
  expect(() => limiter.checkUpload('alice')).not.toThrow();
});
