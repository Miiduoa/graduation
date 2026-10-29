// @vitest-environment node
import { expect, it } from 'vitest';
import { createMemoryGroupStore } from './memoryGroupStore';
import { reuseOwnedTronClassSession } from './reuseTronClassSession';

const UID = 'pu-1110700321';
const STUDENT = '1110700321';
const OLD_ID = 'old';
const NEXT_ID = 'next';
const LMS_ID = 'a'.repeat(32);

function createStore(overrides: {
  old?: Record<string, unknown>;
  lms?: Record<string, unknown> | null;
  next?: Record<string, unknown>;
} = {}) {
  const expiry = new Date(Date.now() + 60_000);
  const old = {
    ownerUid: UID, studentId: STUDENT, expiresAt: expiry,
    tronClassSessionId: LMS_ID, ...overrides.old,
  };
  const next = { ownerUid: UID, studentId: STUDENT, expiresAt: expiry, ...overrides.next };
  return createMemoryGroupStore([
    ['_puSessions/' + OLD_ID, old],
    ['_puSessions/' + NEXT_ID, next],
    ...(overrides.lms === null ? [] : [[
      '_puTronClassSessions/' + LMS_ID,
      { ownerUid: UID, studentId: STUDENT, expiresAt: expiry,
        cookies: { session: 'server-only' }, ...overrides.lms },
    ]] as Array<[string, Record<string, unknown>]>),
  ]);
}

async function reuse(store: ReturnType<typeof createStore>) {
  return reuseOwnedTronClassSession({
    db: store.db, uid: UID, studentId: STUDENT, portalId: NEXT_ID,
  });
}

it('reuses an owned unexpired session without duplicating credentials', async () => {
  const store = createStore();
  expect(await reuse(store)).toBe(true);
  expect(store.docs.get('_puSessions/' + NEXT_ID)).toMatchObject({
    tronClassSessionId: LMS_ID, lmsConnectingUntil: null,
  });
  expect(store.docs.get('_puTronClassSessions/' + LMS_ID)).toMatchObject({
    cookies: { session: 'server-only' },
  });
  expect([...store.docs.keys()].filter((key) => key.startsWith('_puTronClassSessions/'))).toHaveLength(1);
});

it('does not reuse an expired session', async () => {
  const store = createStore({ lms: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await reuse(store)).toBe(false);
  expect(store.docs.get('_puSessions/' + NEXT_ID)).not.toHaveProperty('tronClassSessionId');
});

it('does not reuse sessions for another student or owner', async () => {
  const wrongStudent = createStore({ old: { studentId: '0000000000' } });
  expect(await reuse(wrongStudent)).toBe(false);
  const wrongOwner = createStore({ lms: { ownerUid: 'pu-another' } });
  expect(await reuse(wrongOwner)).toBe(false);
});

it('does not revive missing documents or expired new portal sessions', async () => {
  const missing = createStore({ lms: null });
  expect(await reuse(missing)).toBe(false);
  const expired = createStore({ next: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await reuse(expired)).toBe(false);
  expect(expired.docs.get('_puSessions/' + NEXT_ID)).not.toHaveProperty('tronClassSessionId');
});

it('does not overwrite a session that was independently attached to the new portal', async () => {
  const store = createStore({ next: { tronClassSessionId: 'b'.repeat(32) } });
  expect(await reuse(store)).toBe(false);
  expect(store.docs.get('_puSessions/' + NEXT_ID)?.tronClassSessionId).toBe('b'.repeat(32));
});
