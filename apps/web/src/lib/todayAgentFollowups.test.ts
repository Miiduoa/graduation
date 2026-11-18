import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { assertTodayAgentFollowupCapacity, readTodayAgentFollowups, saveTodayAgentFollowup, removeTodayAgentFollowup, todayAgentFollowupStorageKey } from './todayAgentFollowups';

const scope = { owner: 'platform:alice', schoolId: 'pu' };
const context = 'a'.repeat(43);
function proof(id = 'original-calendar-001') {
  const card = { tool: 'propose_personal_event' as const, token: 'signed-' + id,
    mutationId: id, schoolId: 'pu', destination: '個人行事曆',
    args: { title: '準備作業：資料結構', date: '2026-11-13', allDay: false, startTime: '14:00', endTime: '14:30' } };
  const receipt = createAssistantCalendarReceipt({ schoolId: 'pu', mutationId: id, event: card.args,
    storage: 'synced', revision: 1, verifiedAt: '2026-11-13T05:00:00.000Z',
    record: { ...card.args, id, batchId: id, kind: 'events', schoolId: 'pu', academicYear: '', semester: '',
      importedAt: '2026-11-13T05:00:00.000Z', source: { type: 'paste', name: '助理確認', line: 1, rawText: '' } } });
  return { input: { issuedContext: context, conversationId: 'original-conversation', card }, receipt };
}
let requestLock: Mock<(key: string, action: () => unknown) => Promise<unknown>>;
beforeEach(() => {
  localStorage.clear();
  // One origin-wide lock queue stands in for separate tabs sharing Web Locks.
  const queues = new Map<string, Promise<unknown>>();
  requestLock = vi.fn((key: string, action: () => unknown) => {
    const next = (queues.get(key) || Promise.resolve()).then(action);
    queues.set(key, next.catch(() => {}));
    return next;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: requestLock } });
});
afterEach(() => vi.restoreAllMocks());

it('preserves the original signed proof across a new login without sharing another account or campus', async () => {
  const { input, receipt } = proof();
  await saveTodayAgentFollowup(scope, input, receipt, () => true);
  expect(readTodayAgentFollowups(scope)).toEqual([{ ...input, verifiedAt: receipt.verifiedAt }]);
  expect(readTodayAgentFollowups({ ...scope, owner: 'platform:bob' })).toEqual([]);
  expect(readTodayAgentFollowups({ ...scope, schoolId: 'nthu' })).toEqual([]);
  // No current-session value replaces the issuer context needed for read-only authentication.
  expect(readTodayAgentFollowups(scope)[0].issuedContext).toBe(context);
});

it('requires the exact verified receipt before storing a completed arrangement', async () => {
  const a = proof(), b = proof('other-calendar-001');
  await expect(saveTodayAgentFollowup(scope, a.input, b.receipt, () => true)).rejects.toThrow();
  await expect(saveTodayAgentFollowup(scope, { ...a.input, card: { ...a.input.card,
    args: { ...a.input.card.args, startTime: '14:05' } } }, a.receipt, () => true)).rejects.toThrow();
  expect(readTodayAgentFollowups(scope)).toEqual([]);
});

it('does not replace the authority of an already tracked mutation', async () => {
  const { input, receipt } = proof();
  await saveTodayAgentFollowup(scope, input, receipt, () => true);
  await saveTodayAgentFollowup(scope, input, receipt, () => true);
  expect(readTodayAgentFollowups(scope)).toHaveLength(1);
  await expect(saveTodayAgentFollowup(scope, { ...input, issuedContext: 'b'.repeat(43) }, receipt, () => true)).rejects.toThrow('不同追蹤內容');
  expect(readTodayAgentFollowups(scope)[0].issuedContext).toBe(context);
});

it('keeps damaged tracking evidence intact instead of replacing it with an empty history', async () => {
  const key = todayAgentFollowupStorageKey(scope), { input, receipt } = proof();
  localStorage.setItem(key, '{damaged');
  expect(() => readTodayAgentFollowups(scope)).toThrow('原有紀錄仍保留');
  await expect(saveTodayAgentFollowup(scope, input, receipt, () => true)).rejects.toThrow();
  expect(localStorage.getItem(key)).toBe('{damaged');
});

it('does not accept a stored record relabelled as another owner or school', async () => {
  const { input, receipt } = proof();
  await saveTodayAgentFollowup(scope, input, receipt, () => true);
  const raw = localStorage.getItem(todayAgentFollowupStorageKey(scope))!;
  const other = { owner: 'platform:bob', schoolId: 'pu' };
  localStorage.setItem(todayAgentFollowupStorageKey(other), raw);
  expect(() => readTodayAgentFollowups(other)).toThrow();
  expect(readTodayAgentFollowups(scope)).toHaveLength(1);
});

it('does not save or remove a proof after the scope lifetime ends', async () => {
  const { input, receipt } = proof();
  await expect(saveTodayAgentFollowup(scope, input, receipt, () => false)).rejects.toThrow('範圍已改變');
  await saveTodayAgentFollowup(scope, input, receipt, () => true);
  await expect(removeTodayAgentFollowup(scope, input.card.mutationId, () => false)).rejects.toThrow('範圍已改變');
  expect(readTodayAgentFollowups(scope)).toHaveLength(1);
});

it('retains every existing proof at the active tracking limit', async () => {
  for (let n = 0; n < 24; n++) {
    const item = proof('original-calendar-' + String(n).padStart(3, '0'));
    await saveTodayAgentFollowup(scope, item.input, item.receipt, () => true);
  }
  const extra = proof('extra-calendar-001');
  expect(() => assertTodayAgentFollowupCapacity(scope)).toThrow('超過 7 天');
  expect(() => assertTodayAgentFollowupCapacity(scope, extra.input.card.mutationId)).toThrow('24 筆');
  expect(() => assertTodayAgentFollowupCapacity(scope, 'original-calendar-000')).not.toThrow();
  await expect(saveTodayAgentFollowup(scope, extra.input, extra.receipt, () => true)).rejects.toThrow('24 筆');
  expect(readTodayAgentFollowups(scope)).toHaveLength(24);
});

it('checks available capacity without writing or converting damaged evidence into a free slot', () => {
  const writer = vi.spyOn(Storage.prototype, 'setItem');
  expect(() => assertTodayAgentFollowupCapacity(scope)).not.toThrow();
  expect(writer).not.toHaveBeenCalled();
  localStorage.setItem(todayAgentFollowupStorageKey(scope), '{damaged');
  expect(() => assertTodayAgentFollowupCapacity(scope)).toThrow('原有紀錄仍保留');
  expect(() => assertTodayAgentFollowupCapacity(scope, 'short')).toThrow();
  expect(localStorage.getItem(todayAgentFollowupStorageKey(scope))).toBe('{damaged');
});

it('keeps both proofs when another tab starts saving between the compare and setItem calls', async () => {
  const a = proof('tab-a-calendar-001'), b = proof('tab-b-calendar-002');
  const original = Storage.prototype.setItem;
  let competing: Promise<void> | undefined;
  let entered = false;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage && key === todayAgentFollowupStorageKey(scope) && !entered) {
      entered = true;
      // With only localStorage CAS this nested tab completes first; the outer
      // write then overwrites it and both callers falsely report persistence.
      competing = saveTodayAgentFollowup(scope, b.input, b.receipt, () => true);
    }
    original.call(this, key, value);
  });
  await saveTodayAgentFollowup(scope, a.input, a.receipt, () => true);
  await competing;
  expect(readTodayAgentFollowups(scope).map(entry => entry.card.mutationId)).toEqual([
    a.input.card.mutationId, b.input.card.mutationId,
  ]);
  expect(requestLock.mock.calls.map(call => call[0])).toEqual([
    todayAgentFollowupStorageKey(scope), todayAgentFollowupStorageKey(scope),
  ]);
});

it('does not resurrect a retired proof when cleanup races with a new saved arrangement', async () => {
  const a = proof('tab-a-calendar-001'), b = proof('tab-b-calendar-002');
  await saveTodayAgentFollowup(scope, a.input, a.receipt, () => true);
  const original = Storage.prototype.setItem;
  let removal: Promise<void> | undefined;
  let entered = false;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage && key === todayAgentFollowupStorageKey(scope) && !entered) {
      entered = true;
      removal = removeTodayAgentFollowup(scope, a.input.card.mutationId, () => true);
    }
    original.call(this, key, value);
  });
  await saveTodayAgentFollowup(scope, b.input, b.receipt, () => true);
  await removal;
  expect(readTodayAgentFollowups(scope).map(entry => entry.card.mutationId)).toEqual([b.input.card.mutationId]);
});

it('rechecks scope after waiting for another tab to release its lock', async () => {
  let release!: () => void;
  const holding = requestLock(todayAgentFollowupStorageKey(scope), () => new Promise<void>(resolve => { release = resolve; }));
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const { input, receipt } = proof();
  let active = true;
  const pending = saveTodayAgentFollowup(scope, input, receipt, () => active);
  active = false;
  release();
  await holding;
  await expect(pending).rejects.toThrow('範圍已改變');
  expect(readTodayAgentFollowups(scope)).toEqual([]);
});

it('fails closed without Web Locks and preserves the proof for later recovery', async () => {
  const a = proof(), b = proof('other-calendar-002');
  await saveTodayAgentFollowup(scope, a.input, a.receipt, () => true);
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  await expect(saveTodayAgentFollowup(scope, b.input, b.receipt, () => true)).rejects.toThrow('無法安全保存');
  await expect(removeTodayAgentFollowup(scope, a.input.card.mutationId, () => true)).rejects.toThrow('無法安全保存');
  expect(readTodayAgentFollowups(scope).map(entry => entry.card.mutationId)).toEqual([a.input.card.mutationId]);
});

it('checks the capacity inside the lock so competing tabs cannot displace an older proof', async () => {
  for (let n = 0; n < 23; n++) {
    const item = proof('existing-calendar-' + String(n).padStart(3, '0'));
    await saveTodayAgentFollowup(scope, item.input, item.receipt, () => true);
  }
  const a = proof('tab-a-calendar-001'), b = proof('tab-b-calendar-002');
  const results = await Promise.allSettled([
    saveTodayAgentFollowup(scope, a.input, a.receipt, () => true),
    saveTodayAgentFollowup(scope, b.input, b.receipt, () => true),
  ]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect(readTodayAgentFollowups(scope)).toHaveLength(24);
  expect(readTodayAgentFollowups(scope).filter(entry => entry.card.mutationId.startsWith('existing-calendar-'))).toHaveLength(23);
});
