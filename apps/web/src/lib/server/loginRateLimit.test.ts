import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import {
  consumeLoginAccountLimit,
  consumeLoginIpLimit,
  consumeLoginRateLimit,
  createLoginRateGate,
  deriveRateLimitSalt,
  enforceLoginRateLimit,
  hashRateLimitDocId,
  LOGIN_RATE_LIMIT,
  LoginRateLimitError,
  LoginRateStoreError,
  RATE_LIMITS_COLLECTION,
} from './loginRateLimit';
import { createMemoryGroupStore } from './memoryGroupStore';

const SALT = 'test-rate-limit-salt';

function store() {
  return createMemoryGroupStore();
}

it('allows 20 attempts per ip then rejects', async () => {
  const { db } = store();
  const gate = createLoginRateGate();
  for (let i = 0; i < LOGIN_RATE_LIMIT.ip.limit; i += 1) {
    await consumeLoginIpLimit('1.1.1.1', { db, salt: SALT, gate });
  }
  await expect(consumeLoginIpLimit('1.1.1.1', { db, salt: SALT, gate })).rejects.toBeInstanceOf(
    LoginRateLimitError,
  );
});

it('allows 5 attempts per account then rejects', async () => {
  const { db } = store();
  const gate = createLoginRateGate();
  for (let i = 0; i < 5; i += 1) {
    await consumeLoginAccountLimit('1110700321', { db, salt: SALT, gate });
  }
  await expect(
    consumeLoginAccountLimit('1110700321', { db, salt: SALT, gate }),
  ).rejects.toBeInstanceOf(LoginRateLimitError);
});

it('resets after the window and does not share keys across scopes', async () => {
  const { db, docs } = store();
  let now = 1_000_000;
  await consumeLoginRateLimit(db, 'ip', 'same', 1, 60_000, now, SALT);
  await expect(consumeLoginRateLimit(db, 'ip', 'same', 1, 60_000, now, SALT)).rejects.toBeInstanceOf(
    LoginRateLimitError,
  );
  await consumeLoginRateLimit(db, 'account', 'same', 1, 60_000, now, SALT);
  now += 60_000;
  await expect(consumeLoginRateLimit(db, 'ip', 'same', 1, 60_000, now, SALT)).resolves.toBeUndefined();
  const hashed = `${RATE_LIMITS_COLLECTION}/${hashRateLimitDocId('ip', 'same', SALT)}`;
  expect(docs.get(hashed)).toMatchObject({ count: 1, scope: 'ip' });
  expect(docs.get(hashed)?.ttl).toBeInstanceOf(Date);
  expect(JSON.stringify([...docs.entries()])).not.toContain('same');
});

it('does not put the plaintext account into the Firestore document id or fields', async () => {
  const { db, docs } = store();
  const account = '1110700321';
  await enforceLoginRateLimit(db, '9.9.9.9', account, 50, {
    salt: SALT,
    gate: createLoginRateGate(),
  });
  const serialized = JSON.stringify([...docs.entries()]);
  expect(serialized).not.toContain(account);
  expect([...docs.keys()].every((path) => path.startsWith(`${RATE_LIMITS_COLLECTION}/`))).toBe(true);
  expect([...docs.keys()].some((path) => path.includes(account))).toBe(false);
});

it('fails closed with 503 when Firestore cannot commit', async () => {
  const memory = store();
  memory.failNextCommit();
  await expect(
    enforceLoginRateLimit(memory.db, '1.1.1.1', '1110700321', Date.now(), {
      salt: SALT,
      gate: createLoginRateGate(),
    }),
  ).rejects.toBeInstanceOf(LoginRateStoreError);
});

it('returns 503 without touching Firestore when the daily write budget is spent', async () => {
  const memory = store();
  const runTransaction = vi.spyOn(memory.db, 'runTransaction');
  const gate = createLoginRateGate({ dailyWriteLimit: 0 });
  await expect(
    consumeLoginIpLimit('8.8.8.8', { db: memory.db, salt: SALT, gate }),
  ).rejects.toBeInstanceOf(LoginRateStoreError);
  expect(runTransaction).not.toHaveBeenCalled();
  expect(gate.writesUsed()).toBe(0);
});

it('derives the salt from the existing service-account secret', () => {
  const first = deriveRateLimitSalt('{"private_key":"x"}');
  const second = deriveRateLimitSalt('{"private_key":"y"}');
  expect(first).not.toBe(second);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
});

it('does not grant clients a Firestore rule on _rateLimits', () => {
  const rules = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../../backend/firestore/firestore.rules'),
    'utf8',
  );
  expect(rules).not.toMatch(/_rateLimits/);
  expect(rules).not.toMatch(/^    match \/\{\s*document=\*\*\s*\}/m);
});
