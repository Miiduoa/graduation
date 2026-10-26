import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  consumeLoginRateLimit,
  enforceLoginRateLimit,
  LOGIN_RATE_LIMIT,
  LoginRateLimitError,
  LoginRateStoreError,
  RATE_LIMITS_COLLECTION,
} from './loginRateLimit';
import { createMemoryGroupStore } from './memoryGroupStore';

function store() {
  return createMemoryGroupStore();
}

it('allows 20 attempts per ip then rejects', async () => {
  const { db } = store();
  for (let i = 0; i < LOGIN_RATE_LIMIT.ip.limit; i += 1) {
    await consumeLoginRateLimit(db, 'ip', '1.1.1.1', LOGIN_RATE_LIMIT.ip.limit, LOGIN_RATE_LIMIT.ip.windowMs);
  }
  await expect(
    consumeLoginRateLimit(db, 'ip', '1.1.1.1', LOGIN_RATE_LIMIT.ip.limit, LOGIN_RATE_LIMIT.ip.windowMs),
  ).rejects.toBeInstanceOf(LoginRateLimitError);
});

it('allows 5 attempts per account then rejects', async () => {
  const { db } = store();
  for (let i = 0; i < 5; i += 1) {
    await consumeLoginRateLimit(db, 'account', '1110700321', 5, LOGIN_RATE_LIMIT.account.windowMs);
  }
  await expect(consumeLoginRateLimit(db, 'account', '1110700321', 5, LOGIN_RATE_LIMIT.account.windowMs)).rejects.toBeInstanceOf(
    LoginRateLimitError,
  );
});

it('resets after the window and does not share keys across scopes', async () => {
  const { db, docs } = store();
  let now = 1_000_000;
  await consumeLoginRateLimit(db, 'ip', 'same', 1, 60_000, now);
  await expect(consumeLoginRateLimit(db, 'ip', 'same', 1, 60_000, now)).rejects.toBeInstanceOf(LoginRateLimitError);
  await consumeLoginRateLimit(db, 'account', 'same', 1, 60_000, now);
  now += 60_000;
  await expect(consumeLoginRateLimit(db, 'ip', 'same', 1, 60_000, now)).resolves.toBeUndefined();
  expect(docs.get(`${RATE_LIMITS_COLLECTION}/ip:same`)).toMatchObject({ count: 1, scope: 'ip', key: 'same' });
  expect(docs.get(`${RATE_LIMITS_COLLECTION}/ip:same`)?.ttl).toBeInstanceOf(Date);
});

it('counts both ip and account before returning', async () => {
  const { db, docs } = store();
  await enforceLoginRateLimit(db, '9.9.9.9', '1110700321', 50);
  expect(docs.get(`${RATE_LIMITS_COLLECTION}/pu-student-login-ip:9.9.9.9`)).toMatchObject({ count: 1 });
  expect(docs.get(`${RATE_LIMITS_COLLECTION}/pu-student-login-account:1110700321`)).toMatchObject({ count: 1 });
});

it('fails closed with 503 when Firestore cannot commit', async () => {
  const memory = store();
  memory.failNextCommit();
  await expect(enforceLoginRateLimit(memory.db, '1.1.1.1', '1110700321')).rejects.toBeInstanceOf(
    LoginRateStoreError,
  );
});

it('does not grant clients a Firestore rule on _rateLimits', () => {
  const rules = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../../backend/firestore/firestore.rules'),
    'utf8',
  );
  expect(rules).not.toMatch(/_rateLimits/);
  expect(rules).not.toMatch(/^    match \/\{\s*document=\*\*\s*\}/m);
});
