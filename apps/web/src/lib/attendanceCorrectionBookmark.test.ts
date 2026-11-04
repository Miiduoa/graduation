import { beforeEach, expect, it } from 'vitest';
import {
  readCorrectionBookmark, rememberCorrectionBookmark, clearCorrectionBookmark,
  clearInvalidCorrectionBookmark, type BookmarkStorage,
} from './attendanceCorrectionBookmark';

const scope = { actorUid: 'teacher', courseId: 'course', sessionId: 'session' };
let values: Map<string, string>;
let storage: BookmarkStorage;
beforeEach(() => {
  values = new Map();
  storage = { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
});
it('stores only a receipt pointer before dispatch, never a student or mutation payload', () => {
  expect(rememberCorrectionBookmark(scope, 'operation', storage, 100)).toBe('saved');
  const raw = [...values.values()][0];
  expect(JSON.parse(raw)).toEqual({ ...scope, version: 1, requestId: 'operation', createdAt: 100 });
  for (const secret of ['studentUid', 'displayName', 'studentId', 'reason', 'status', 'idToken', 'expectedRevision']) {
    expect(raw).not.toContain(secret);
  }
  expect(readCorrectionBookmark(scope, storage)).toEqual({ kind: 'pending', bookmark: JSON.parse(raw) });
});
it.each(['actorUid', 'courseId', 'sessionId'] as const)('isolates the reminder by %s', (key) => {
  rememberCorrectionBookmark(scope, 'operation', storage, 100);
  expect(readCorrectionBookmark({ ...scope, [key]: 'other' }, storage)).toEqual({ kind: 'empty' });
});
it('does not replace a pending operation and does not let a stale success clear a newer marker', () => {
  rememberCorrectionBookmark(scope, 'first', storage, 100);
  expect(rememberCorrectionBookmark(scope, 'second', storage, 200)).toBe('conflict');
  expect(clearCorrectionBookmark(scope, 'second', storage)).toBe(false);
  expect(clearCorrectionBookmark(scope, 'first', storage)).toBe(true);
  rememberCorrectionBookmark(scope, 'second', storage, 200);
  expect(clearCorrectionBookmark(scope, 'first', storage)).toBe(false);
});
it('same-operation retries preserve the original reminder timestamp', () => {
  rememberCorrectionBookmark(scope, 'same', storage, 100);
  expect(rememberCorrectionBookmark(scope, 'same', storage, 200)).toBe('saved');
  expect(readCorrectionBookmark(scope, storage)).toMatchObject({ bookmark: { createdAt: 100 } });
});
it.each([
  'bad-json', '[]', 'null', 'x'.repeat(1401),
  JSON.stringify({ ...scope, version: 2, requestId: 'r', createdAt: 100 }),
  JSON.stringify({ ...scope, version: 1, requestId: '../r', createdAt: 100 }),
  JSON.stringify({ ...scope, version: 1, requestId: 'r', createdAt: '100' }),
  JSON.stringify({ ...scope, version: 1, requestId: 'r', createdAt: 100, reason: 'do not store' }),
  JSON.stringify({ ...scope, actorUid: 'other', version: 1, requestId: 'r', createdAt: 100 }),
])('never replays or silently overwrites corrupt/unexpected bookmark data: %s', (raw) => {
  rememberCorrectionBookmark(scope, 'original', storage, 100);
  storage.setItem([...values.keys()][0], raw);
  expect(readCorrectionBookmark(scope, storage)).toEqual({ kind: 'invalid' });
  expect(rememberCorrectionBookmark(scope, 'new', storage, 200)).toBe('conflict');
  expect(clearInvalidCorrectionBookmark(scope, storage)).toBe(true);
  expect(values.size).toBe(0);
});
it('gracefully handles blocked storage without claiming cross-reload recovery is available', () => {
  const blocked = { getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('SecurityError'); } };
  expect(readCorrectionBookmark(scope, blocked)).toEqual({ kind: 'unavailable' });
  expect(rememberCorrectionBookmark(scope, 'r', blocked)).toBe('unavailable');
  expect(clearCorrectionBookmark(scope, 'r', blocked)).toBe(false);
  expect(readCorrectionBookmark(scope, null)).toEqual({ kind: 'unavailable' });
});
it('does not claim a silently dropped storage write has been preserved', () => {
  expect(rememberCorrectionBookmark(scope, 'r', { ...storage, setItem: () => {} }, 100)).toBe('unavailable');
});
it('cannot use invalid-metadata cleanup to erase a valid pending request', () => {
  rememberCorrectionBookmark(scope, 'r', storage, 100);
  expect(clearInvalidCorrectionBookmark(scope, storage)).toBe(false);
  expect(values.size).toBe(1);
});
