import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import {
  ASSISTANT_CALENDAR_JOURNAL_MAX_BYTES, ASSISTANT_CALENDAR_JOURNAL_MAX_ENTRIES,
  AssistantCalendarJournalError, assistantCalendarJournalStorageKey,
  consumeAssistantCalendarJournalPermit, readAssistantCalendarJournal, reserveAssistantCalendarAttempt,
  parseAssistantCalendarOrigin, saveAssistantCalendarJournalObservation, saveAssistantCalendarJournalObservations,
  type AssistantCalendarJournalEntry, type AssistantCalendarJournalProposal,
} from '../services/assistantCalendarJournal';

const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const scope = { owner: 'firebase:A', schoolId: 'pu' };
const key = assistantCalendarJournalStorageKey(scope);
const createdAt = '2026-11-07T12:00:00.000Z';
const verifiedAt = '2026-11-07T12:01:00.000Z';
const event = { title: 'Study English', date: '2099-01-02', allDay: false, startTime: '19:00', endTime: '20:00' };
const proposal = (suffix = 'first'): AssistantCalendarJournalProposal => ({
  ...scope, mutationId: 'aev_journal_' + suffix, createdAt, event: { ...event },
});
const receipt = (target = proposal()) => createAssistantCalendarReceipt({
  schoolId: target.schoolId, mutationId: target.mutationId, event: target.event, storage: 'device', verifiedAt,
  record: { ...target.event, id: target.mutationId, batchId: target.mutationId, kind: 'events',
    schoolId: target.schoolId, academicYear: '', semester: '', importedAt: target.createdAt,
    source: { type: 'paste', name: '助理行程', line: 1, rawText: '' } },
});
const envelope = (entries: AssistantCalendarJournalEntry[]) => ({ version: 1, ...scope, entries });
const seed = async (value: unknown) => {
  await originalSet(key, typeof value === 'string' ? value : JSON.stringify(value));
  jest.clearAllMocks();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('an absent scoped journal is read-only and never consults legacy or other-account keys', async () => {
  await originalSet('ai_chat_history', 'private unrelated conversation');
  expect(await readAssistantCalendarJournal(scope, () => true)).toEqual([]);
  expect(jest.mocked(AsyncStorage.getItem).mock.calls).toEqual([[key]]);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('reservation is read back before a single-use nonserializable permit becomes available', async () => {
  const target = proposal();
  const reservation = await reserveAssistantCalendarAttempt(target, () => true);
  expect(reservation.kind).toBe('reserved');
  if (reservation.kind !== 'reserved') throw new Error('missing permit');
  expect(jest.mocked(AsyncStorage.getItem).mock.calls).toEqual([[key], [key]]);
  expect(jest.mocked(AsyncStorage.setItem).mock.calls).toHaveLength(1);
  expect(jest.mocked(AsyncStorage.setItem).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(AsyncStorage.getItem).mock.invocationCallOrder[1]);
  const persisted = JSON.parse((await originalGet(key))!);
  expect(persisted).toEqual(envelope([{ proposal: target, attemptedAt: expect.any(String) }]));
  expect(persisted).not.toHaveProperty('permit');
  expect(consumeAssistantCalendarJournalPermit(JSON.parse(JSON.stringify(reservation.permit)), target, () => true)).toBe(false);
  expect(consumeAssistantCalendarJournalPermit(reservation.permit, target, () => true)).toBe(true);
  expect(consumeAssistantCalendarJournalPermit(reservation.permit, target, () => true)).toBe(false);
  expect((await reserveAssistantCalendarAttempt(target, () => true)).kind).toBe('existing');
  expect(jest.mocked(AsyncStorage.setItem).mock.calls).toHaveLength(1);
});

test('a permit is consumed even when its proposal or active scope does not match', async () => {
  const reserved = await reserveAssistantCalendarAttempt(proposal(), () => true);
  if (reserved.kind !== 'reserved') throw new Error('missing permit');
  expect(consumeAssistantCalendarJournalPermit(reserved.permit, proposal('other'), () => true)).toBe(false);
  expect(consumeAssistantCalendarJournalPermit(reserved.permit, proposal(), () => true)).toBe(false);
  const next = await reserveAssistantCalendarAttempt({ ...proposal('next'), event: { ...event, title: 'Next' } }, () => true);
  if (next.kind !== 'reserved') throw new Error('missing permit');
  expect(() => consumeAssistantCalendarJournalPermit(next.permit, next.entry.proposal, () => false))
    .toThrow(AssistantCalendarJournalError);
  expect(consumeAssistantCalendarJournalPermit(next.permit, next.entry.proposal, () => true)).toBe(false);
});

test.each([
  { title: 'study english' },
  { title: 'Study   English' },
  { endDate: event.date },
  { location: '圖書館' },
])('canonical duplicate $title/$endDate/$location keeps the first ID and exact original contents', async (change) => {
  const first = proposal();
  await reserveAssistantCalendarAttempt(first, () => true);
  const replay = await reserveAssistantCalendarAttempt({ ...proposal('second'), event: { ...event, ...change } }, () => true);
  expect(replay).toMatchObject({ kind: 'existing', entry: { proposal: first } });
  expect(jest.mocked(AsyncStorage.setItem).mock.calls).toHaveLength(1);
});

test('concurrent reservations for one canonical event issue one permit and preserve one ID', async () => {
  const first = proposal();
  const results = await Promise.all([
    reserveAssistantCalendarAttempt(first, () => true),
    reserveAssistantCalendarAttempt(proposal('second'), () => true),
  ]);
  expect(results.map((value) => value.kind)).toEqual(['reserved', 'existing']);
  expect(results[1].entry.proposal).toEqual(first);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(1);
});

test('Firebase, platform accounts, and schools have distinct persisted identities', async () => {
  await reserveAssistantCalendarAttempt(proposal(), () => true);
  for (const other of [
    { owner: 'firebase:B', schoolId: 'pu' }, { owner: 'nuni:A', schoolId: 'pu' },
    { owner: 'nuni:B', schoolId: 'pu' }, { owner: 'firebase:A', schoolId: 'nthu' },
  ]) {
    expect(assistantCalendarJournalStorageKey(other)).not.toBe(key);
    expect(await readAssistantCalendarJournal(other, () => true)).toEqual([]);
  }
  const copied = (await originalGet(key))!;
  const otherScope = { owner: 'nuni:A', schoolId: 'pu' };
  await originalSet(assistantCalendarJournalStorageKey(otherScope), copied);
  await expect(readAssistantCalendarJournal(otherScope, () => true)).rejects.toMatchObject({ code: 'journal-corrupt' });
});

test('scope changes while saving never issue a permit or publish the old response', async () => {
  let active = true;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value); active = false;
  });
  await expect(reserveAssistantCalendarAttempt(proposal(), () => active)).rejects.toMatchObject({ code: 'session-changed' });
  expect((await readAssistantCalendarJournal(scope, () => true))[0].proposal.mutationId).toBe(proposal().mutationId);
});

test.each([
  '{broken',
  JSON.stringify({ ...envelope([]), version: 2 }),
  JSON.stringify({ ...envelope([]), owner: 'firebase:B' }),
  JSON.stringify({ ...envelope([]), schoolId: 'nthu' }),
  JSON.stringify({ ...envelope([]), token: 'must not survive validation' }),
  JSON.stringify(envelope([{ proposal: { ...proposal(), createdAt: '2026-02-30T12:00:00.000Z' }, attemptedAt: createdAt }])),
  JSON.stringify(envelope([{ proposal: proposal(), attemptedAt: createdAt }, { proposal: proposal(), attemptedAt: createdAt }])),
  JSON.stringify(envelope([{ proposal: proposal(), attemptedAt: createdAt }, { proposal: proposal('second'), attemptedAt: createdAt }])),
])('corrupt or incompatible data is preserved, never treated as empty: %#', async (raw) => {
  await seed(raw);
  await expect(readAssistantCalendarJournal(scope, () => true)).rejects.toMatchObject({ code: 'journal-corrupt' });
  await expect(reserveAssistantCalendarAttempt(proposal('new'), () => true)).rejects.toMatchObject({ code: 'journal-corrupt' });
  expect(await originalGet(key)).toBe(raw);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('exported proposal validation does not execute getters or save extra private fields', () => {
  const getter = jest.fn(() => scope.owner);
  const poisoned = proposal();
  // The React Native Babel preset lowers object spread with Object.assign,
  // which would evaluate a getter while constructing this test fixture.
  Object.defineProperty(poisoned, 'owner', { enumerable: true, get: getter });
  expect(() => reserveAssistantCalendarAttempt(poisoned, () => true)).toThrow(AssistantCalendarJournalError);
  expect(getter).not.toHaveBeenCalled();
  expect(() => reserveAssistantCalendarAttempt({ ...proposal(), transcript: 'private chat' } as AssistantCalendarJournalProposal, () => true))
    .toThrow(AssistantCalendarJournalError);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('read failures use a safe typed error and cannot become empty history', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('SECRET native payload'));
  await expect(readAssistantCalendarJournal(scope, () => true)).rejects.toMatchObject({
    name: 'AssistantCalendarJournalError', code: 'journal-unavailable', message: expect.not.stringContaining('SECRET'),
  });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([false, true])('a storage rejection issues no permit, even when native saved first: %s', async (saved) => {
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    if (saved) await originalSet(storageKey, value);
    throw new Error('SECRET quota message');
  });
  await expect(reserveAssistantCalendarAttempt(proposal(), () => true)).rejects.toMatchObject({
    code: 'journal-write-unverified', message: expect.not.stringContaining('SECRET'),
  });
  jest.mocked(AsyncStorage.setItem).mockImplementation(originalSet);
  const journal = await readAssistantCalendarJournal(scope, () => true);
  expect(journal).toHaveLength(saved ? 1 : 0);
  if (saved) expect((await reserveAssistantCalendarAttempt(proposal(), () => true)).kind).toBe('existing');
});

test('an acknowledged write with mismatched readback issues no permit', async () => {
  let reads = 0;
  jest.mocked(AsyncStorage.getItem).mockImplementation((storageKey) => {
    if (storageKey === key && ++reads === 2) return Promise.resolve(null);
    return originalGet(storageKey);
  });
  await expect(reserveAssistantCalendarAttempt(proposal(), () => true)).rejects.toMatchObject({ code: 'journal-write-unverified' });
  expect((await readAssistantCalendarJournal(scope, () => true))).toHaveLength(1);
});

test('full journals retain all tombstones, permit existing checks, and refuse a new reservation', async () => {
  const entries = Array.from({ length: ASSISTANT_CALENDAR_JOURNAL_MAX_ENTRIES }, (_, index) => ({
    proposal: { ...proposal(String(index)), event: { ...event, title: '保留操作 ' + index } }, attemptedAt: createdAt,
  }));
  await seed(envelope(entries));
  await expect(reserveAssistantCalendarAttempt(proposal('overflow'), () => true)).rejects.toMatchObject({ code: 'journal-full' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect((await reserveAssistantCalendarAttempt(entries[0].proposal, () => true)).kind).toBe('existing');
  await saveAssistantCalendarJournalObservation(entries[0].proposal,
    { state: 'unknown', checkedAt: verifiedAt, reason: 'absent' }, () => true);
  const saved = await readAssistantCalendarJournal(scope, () => true);
  expect(saved).toHaveLength(ASSISTANT_CALENDAR_JOURNAL_MAX_ENTRIES);
  expect(saved.map((entry) => entry.proposal.mutationId)).toEqual(entries.map((entry) => entry.proposal.mutationId));
});

test('the byte limit is enforced before parsing or overwriting oversized data', async () => {
  const oversized = '中'.repeat(Math.ceil(ASSISTANT_CALENDAR_JOURNAL_MAX_BYTES / 3) + 1);
  await seed(oversized);
  await expect(readAssistantCalendarJournal(scope, () => true)).rejects.toMatchObject({ code: 'journal-full' });
  await expect(reserveAssistantCalendarAttempt(proposal(), () => true)).rejects.toMatchObject({ code: 'journal-full' });
  expect(await originalGet(key)).toBe(oversized);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('negative observations retain verified history and never remove an operation', async () => {
  const target = proposal();
  await reserveAssistantCalendarAttempt(target, () => true);
  const verified = receipt(target);
  await saveAssistantCalendarJournalObservation(target, { state: 'verified', checkedAt: verifiedAt, receipt: verified }, () => true);
  await saveAssistantCalendarJournalObservation(target,
    { state: 'unknown', checkedAt: '2026-11-07T12:02:00.000Z', reason: 'absent' }, () => true);
  const entries = await readAssistantCalendarJournal(scope, () => true);
  expect(entries).toMatchObject([{ proposal: target, observation: { state: 'unknown', reason: 'absent', lastVerified: verified } }]);
  await saveAssistantCalendarJournalObservation(target, { state: 'verified', checkedAt: verifiedAt, receipt: verified }, () => true);
  expect((await readAssistantCalendarJournal(scope, () => true))[0].observation?.state).toBe('unknown');
});

test('observation updates validate exact proposal and receipt scope without creating new reservations', async () => {
  const target = proposal();
  await expect(saveAssistantCalendarJournalObservation(target,
    { state: 'unknown', checkedAt: verifiedAt, reason: 'absent' }, () => true)).rejects.toMatchObject({ code: 'journal-write-unverified' });
  await reserveAssistantCalendarAttempt(target, () => true);
  expect(() => saveAssistantCalendarJournalObservation(target,
    { state: 'verified', checkedAt: verifiedAt, receipt: { ...receipt(target), schoolId: 'nthu' } }, () => true))
    .toThrow(AssistantCalendarJournalError);
  await expect(reserveAssistantCalendarAttempt({ ...target, event: { ...event, location: 'changed' } }, () => true))
    .rejects.toMatchObject({ code: 'journal-corrupt' });
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(1);
});

test('bulk observations use one serialized write/readback for the entire journal', async () => {
  const first = proposal();
  const second = { ...proposal('second'), event: { ...event, date: '2099-01-03' } };
  await reserveAssistantCalendarAttempt(first, () => true);
  await reserveAssistantCalendarAttempt(second, () => true);
  jest.clearAllMocks();
  await saveAssistantCalendarJournalObservations(scope, [first, second].map((target) => ({
    proposal: target, observation: { state: 'unknown' as const, checkedAt: verifiedAt, reason: 'absent' as const },
  })), () => true);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.getItem).toHaveBeenCalledTimes(2);
});

test.each(['read', 'write'] as const)('a stalled native %s is bounded and cannot later issue a permit', async (phase) => {
  jest.useFakeTimers();
  const pending = deferred<string | null>();
  if (phase === 'read') jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => pending.promise);
  else jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (storageKey, value) => {
    await originalSet(storageKey, value); await pending.promise;
  });
  const run = reserveAssistantCalendarAttempt(proposal(), () => true);
  const rejection = expect(run).rejects.toMatchObject({ code: 'journal-timeout' });
  await flush();
  await jest.advanceTimersByTimeAsync(20_001);
  await rejection;
  pending.resolve(null);
  await flush();
  const entries = await readAssistantCalendarJournal(scope, () => true);
  expect(entries).toHaveLength(phase === 'write' ? 1 : 0);
  if (phase === 'write') expect((await reserveAssistantCalendarAttempt(proposal(), () => true)).kind).toBe('existing');
  else expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

describe('batch-step provenance', () => {
  const origin = { kind: 'batch-step' as const, batchId: 'acb_coursework_first', stepId: 'acs_coursework_first_1' };
  const sourceProposal = (): AssistantCalendarJournalProposal => ({ ...proposal(), origin: { ...origin } });

  test('the persisted origin survives readback as frozen evidence while a serialized permit grants no write', async () => {
    const target = sourceProposal();
    const reserved = await reserveAssistantCalendarAttempt(target, () => true);
    if (reserved.kind !== 'reserved') throw new Error('Missing original source permit');
    const readback = await readAssistantCalendarJournal(scope, () => true);
    expect(readback[0].proposal).toEqual(target);
    expect(Object.isFrozen(readback[0].proposal.origin)).toBe(true);
    expect(JSON.parse((await originalGet(key))!)).toEqual(envelope([{ proposal: target, attemptedAt: expect.any(String) }]));
    expect(consumeAssistantCalendarJournalPermit(JSON.parse(JSON.stringify(reserved.permit)), target, () => true)).toBe(false);
    expect(consumeAssistantCalendarJournalPermit(reserved.permit, target, () => true)).toBe(true);
    expect(consumeAssistantCalendarJournalPermit(reserved.permit, target, () => true)).toBe(false);
  });

  test('a different mutation and event for an existing origin cannot obtain a second reservation or permit', async () => {
    const first = sourceProposal();
    await reserveAssistantCalendarAttempt(first, () => true);
    const second = { ...proposal('second_origin_attempt'), origin, event: { ...event, date: '2099-01-03' } };
    expect(await reserveAssistantCalendarAttempt(second, () => true)).toEqual({
      kind: 'existing', entry: { proposal: first, attemptedAt: expect.any(String) },
    });
    expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  test('a live permit is bound to its exact source and is consumed after an attempted origin substitution', async () => {
    const target = sourceProposal();
    const reserved = await reserveAssistantCalendarAttempt(target, () => true);
    if (reserved.kind !== 'reserved') throw new Error('Missing original source permit');
    const forged = { ...target, origin: { ...origin, stepId: 'acs_coursework_another_1' } };
    expect(consumeAssistantCalendarJournalPermit(reserved.permit, forged, () => true)).toBe(false);
    expect(consumeAssistantCalendarJournalPermit(reserved.permit, target, () => true)).toBe(false);
    expect((await readAssistantCalendarJournal(scope, () => true))[0].proposal).toEqual(target);
  });

  test.each([
    ['missing origin', null],
    ['unknown kind', { ...origin, kind: 'generic' }],
    ['missing batch', { kind: origin.kind, stepId: origin.stepId }],
    ['missing step', { kind: origin.kind, batchId: origin.batchId }],
    ['short identifier', { ...origin, batchId: 'short' }],
    ['overlong identifier', { ...origin, stepId: 'x'.repeat(101) }],
    ['padded identifier', { ...origin, stepId: ` ${origin.stepId}` }],
    ['write authority', { ...origin, authorized: true }],
  ])('%s is rejected by the provenance parser', (_name, candidate) => {
    expect(() => parseAssistantCalendarOrigin(candidate)).toThrow(AssistantCalendarJournalError);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('origin accessors cannot run while validating a proposal', () => {
    const getter = jest.fn(() => origin.stepId);
    const poisoned = { ...origin };
    Object.defineProperty(poisoned, 'stepId', { enumerable: true, get: getter });
    expect(() => reserveAssistantCalendarAttempt({ ...sourceProposal(), origin: poisoned }, () => true))
      .toThrow(AssistantCalendarJournalError);
    expect(getter).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('two stored entries claiming one origin are corruption even when mutation IDs and events differ', async () => {
    const entries = [
      { proposal: sourceProposal(), attemptedAt: createdAt },
      { proposal: { ...proposal('second_origin_attempt'), origin, event: { ...event, date: '2099-01-03' } }, attemptedAt: createdAt },
    ];
    const raw = JSON.stringify(envelope(entries));
    await seed(raw);
    await expect(readAssistantCalendarJournal(scope, () => true)).rejects.toMatchObject({ code: 'journal-corrupt' });
    await expect(reserveAssistantCalendarAttempt(proposal('new_attempt'), () => true)).rejects.toMatchObject({ code: 'journal-corrupt' });
    expect(await originalGet(key)).toBe(raw);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('an existing operation cannot change its origin through reservation or observation updates', async () => {
    const original = sourceProposal();
    await reserveAssistantCalendarAttempt(original, () => true);
    const changed = { ...original, origin: { ...origin, batchId: 'acb_coursework_another' } };
    await expect(reserveAssistantCalendarAttempt(changed, () => true)).rejects.toMatchObject({ code: 'journal-corrupt' });
    await expect(saveAssistantCalendarJournalObservation(changed,
      { state: 'unknown', checkedAt: verifiedAt, reason: 'absent' }, () => true)).rejects.toBeInstanceOf(AssistantCalendarJournalError);
    const entries = await readAssistantCalendarJournal(scope, () => true);
    expect(entries).toEqual([{ proposal: original, attemptedAt: expect.any(String) }]);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });
});
