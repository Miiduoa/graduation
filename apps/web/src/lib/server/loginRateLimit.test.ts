import { expect, it } from 'vitest';
import { createLoginRateLimiter, LOGIN_RATE_LIMIT, LoginRateLimitError } from './loginRateLimit';

it('allows 20 attempts per ip then rejects', () => {
  const limiter = createLoginRateLimiter();
  for (let i = 0; i < LOGIN_RATE_LIMIT.ip.limit; i += 1) {
    limiter.consume('ip', '1.1.1.1', LOGIN_RATE_LIMIT.ip.limit, LOGIN_RATE_LIMIT.ip.windowMs);
  }
  expect(() =>
    limiter.consume('ip', '1.1.1.1', LOGIN_RATE_LIMIT.ip.limit, LOGIN_RATE_LIMIT.ip.windowMs),
  ).toThrow(LoginRateLimitError);
});

it('allows 5 attempts per account then rejects', () => {
  const limiter = createLoginRateLimiter();
  for (let i = 0; i < 5; i += 1) {
    limiter.consume('account', '1110700321', 5, LOGIN_RATE_LIMIT.account.windowMs);
  }
  expect(() => limiter.consume('account', '1110700321', 5, LOGIN_RATE_LIMIT.account.windowMs)).toThrow(
    LoginRateLimitError,
  );
});

it('resets after the window and does not share keys across scopes', () => {
  let now = 1_000_000;
  const limiter = createLoginRateLimiter({ now: () => now });
  limiter.consume('ip', 'same', 1, 60_000);
  expect(() => limiter.consume('ip', 'same', 1, 60_000)).toThrow(LoginRateLimitError);
  limiter.consume('account', 'same', 1, 60_000);
  now += 60_000;
  expect(() => limiter.consume('ip', 'same', 1, 60_000)).not.toThrow();
});
