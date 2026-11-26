import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import {
  createAssistantCalendarReceipt,
  parseAssistantCalendarEvent,
  type AssistantCalendarReceipt,
} from '@campus/shared/src/assistantExecution';
import type { AssistantCourseworkFollowup } from '@campus/shared/src/assistantCourseworkFollowup';
import type { V2Card } from '@/features/nuni/assistant/types';
import { needsCourseworkTracking, retainAssistantCourseworkTracking } from './assistantCourseworkTracking';
import { readTodayAgentFollowups, saveTodayAgentFollowup, todayAgentFollowupStorageKey } from './todayAgentFollowups';

const scope = { owner: 'platform:alice', schoolId: 'pu' };
const context = 'a'.repeat(43);
const conversationId = 'original-study-conversation';
const verifiedAt = '2026-11-13T05:00:00.000Z';
const target = { workspaceId: 'course-original', taskId: 'assignment-original', kind: 'assignment' as const };

function fixture(id = 'original-study-calendar-001') {
  const card: V2Card = {
    tool: 'propose_personal_event', token: 'original-signed-proof-' + id, mutationId: id,
    schoolId: scope.schoolId, destination: '個人行事曆', coursework: true,
    args: { title: '準備原作業', date: '2026-11-13', allDay: false, startTime: '14:00', endTime: '14:30' },
  };
  const event = parseAssistantCalendarEvent(card.args);
  const receipt = createAssistantCalendarReceipt({ schoolId: card.schoolId, mutationId: card.mutationId,
    event, storage: 'synced', revision: 1, verifiedAt,
    record: { ...event, id, batchId: id, kind: 'events', schoolId: card.schoolId,
      academicYear: '', semester: '', importedAt: verifiedAt,
      source: { type: 'paste', name: '助理確認', line: 1, rawText: '' } } });
  const followup: AssistantCourseworkFollowup = {
    version: 1, operation: 'coursework.followup', schoolId: card.schoolId, mutationId: card.mutationId,
    checkedAt: '2026-11-13T05:01:00.000Z', status: 'scheduled', calendar: 'matching', event,
    task: target,
    source: { title: '原作業', courseName: '資料庫管理', dueAt: '2026-11-14T23:59:00+08:00',
      state: 'open', submitted: false },
  };
  const proof = { issuedContext: context, conversationId,
    card: { tool: 'propose_personal_event' as const, token: card.token, args: event,
      mutationId: card.mutationId, schoolId: card.schoolId, destination: card.destination } };
  return { card, receipt, followup, proof };
}

type Read = Parameters<typeof retainAssistantCourseworkTracking>[0]['read'];
const retain = (item: ReturnType<typeof fixture>, read: Read, active = () => true,
  receipt: AssistantCalendarReceipt = item.receipt) => retainAssistantCourseworkTracking({
  scope, context, conversationId, card: item.card, receipt, active, read,
});

let requestLock: Mock<(key: string, action: () => unknown) => Promise<unknown>>;
beforeEach(() => {
  localStorage.clear();
  const queues = new Map<string, Promise<unknown>>();
  requestLock = vi.fn((key: string, action: () => unknown) => {
    const next = (queues.get(key) || Promise.resolve()).then(action);
    queues.set(key, next.catch(() => {}));
    return next;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: requestLock } });
});
afterEach(() => vi.restoreAllMocks());

it('reads only the original signed proof and retains it with the exact verified calendar receipt', async () => {
  const item = fixture();
  const read = vi.fn<Read>().mockResolvedValue(item.followup);
  const result = await retain(item, read);
  expect(read).toHaveBeenCalledExactlyOnceWith({ issuedContext: context, conversationId,
    token: item.card.token, args: item.card.args });
  expect(result).toEqual(item.followup);
  expect(result?.task).toEqual(target);
  expect(readTodayAgentFollowups(scope)).toEqual([{ ...item.proof, verifiedAt }]);
  expect(readTodayAgentFollowups({ ...scope, owner: 'platform:bob' })).toEqual([]);
  expect(readTodayAgentFollowups({ ...scope, schoolId: 'nthu' })).toEqual([]);
  // Display hints and source text cannot replace the proof authenticated on later reads.
  const stored = localStorage.getItem(todayAgentFollowupStorageKey(scope))!;
  expect(stored).not.toContain('assignment-original');
  expect(stored).not.toContain('coursework');
  expect(requestLock).toHaveBeenCalledTimes(1);
});

it.each(['school', 'mutation', 'event', 'status'] as const)
  ('rejects a followup with mismatched %s without saving any proof', async mismatch => {
    const item = fixture();
    const raw = { ...item.followup,
      ...(mismatch === 'school' ? { schoolId: 'nthu' } : {}),
      ...(mismatch === 'mutation' ? { mutationId: 'unrelated-calendar-001' } : {}),
      ...(mismatch === 'event' ? { event: { ...item.followup.event, startTime: '14:05' } } : {}),
      ...(mismatch === 'status' ? { status: 'submitted' } : {}),
    };
    await expect(retain(item, vi.fn<Read>().mockResolvedValue(raw))).rejects.toThrow('無法核對');
    expect(readTodayAgentFollowups(scope)).toEqual([]);
    expect(requestLock).not.toHaveBeenCalled();
  });

it.each(['school', 'mutation', 'event'] as const)
  ('requires an exact %s match in the receipt even when the followup is valid', async mismatch => {
    const item = fixture();
    const other = fixture('another-study-calendar-001');
    const receipt = mismatch === 'mutation' ? other.receipt : createAssistantCalendarReceipt({
      schoolId: mismatch === 'school' ? 'nthu' : scope.schoolId,
      mutationId: item.card.mutationId,
      event: { ...item.followup.event, ...(mismatch === 'event' ? { startTime: '14:05' } : {}) },
      storage: 'synced', revision: 1, verifiedAt,
      record: { ...item.receipt.record, ...(mismatch === 'school' ? { schoolId: 'nthu' } : {}),
        ...(mismatch === 'event' ? { startTime: '14:05' } : {}) },
    });
    await expect(retain(item, vi.fn<Read>().mockResolvedValue(item.followup), () => true, receipt)).rejects.toThrow();
    expect(readTodayAgentFollowups(scope)).toEqual([]);
    expect(requestLock).not.toHaveBeenCalled();
  });

it('lets a signed non-coursework classification finish without reading storage or requiring Web Locks', async () => {
  const item = fixture();
  localStorage.setItem(todayAgentFollowupStorageKey(scope), '{damaged');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  const get = vi.spyOn(Storage.prototype, 'getItem');
  const set = vi.spyOn(Storage.prototype, 'setItem');
  const read = vi.fn<Read>().mockResolvedValue({ ...item.followup,
    status: 'not_coursework', calendar: 'unavailable', task: null, source: null });
  await expect(retain(item, read)).resolves.toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});

it('retains authenticated source identity while its fresh source read is unavailable', async () => {
  const item = fixture();
  const partial = { ...item.followup, status: 'unavailable', source: null, calendar: 'unavailable' };
  const result = await retain(item, vi.fn<Read>().mockResolvedValue(partial));
  expect(result).toMatchObject({ status: 'unavailable', task: target, source: null, calendar: 'unavailable' });
  expect(readTodayAgentFollowups(scope)).toEqual([{ ...item.proof, verifiedAt }]);
});

it('does not read or save after the account or campus lifetime has already ended', async () => {
  const item = fixture(), read = vi.fn<Read>().mockResolvedValue(item.followup);
  await expect(retain(item, read, () => false)).rejects.toThrow('已變更');
  expect(read).not.toHaveBeenCalled();
  expect(requestLock).not.toHaveBeenCalled();
  expect(readTodayAgentFollowups(scope)).toEqual([]);
});

it('ignores a late followup after the active identity switches', async () => {
  const item = fixture();
  let resolve!: (value: unknown) => void;
  const read = vi.fn<Read>(() => new Promise(done => { resolve = done; }));
  let active = true;
  const pending = retain(item, read, () => active);
  active = false;
  resolve(item.followup);
  await expect(pending).rejects.toThrow('已變更');
  expect(requestLock).not.toHaveBeenCalled();
  expect(readTodayAgentFollowups(scope)).toEqual([]);
});

it('rechecks the active identity after waiting for the storage lock', async () => {
  const item = fixture();
  let release!: () => void;
  requestLock.mockImplementationOnce((_key, action) => new Promise((resolve, reject) => {
    release = () => { try { resolve(action()); } catch (error) { reject(error); } };
  }));
  let active = true;
  const pending = retain(item, vi.fn<Read>().mockResolvedValue(item.followup), () => active);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  active = false;
  release();
  await expect(pending).rejects.toThrow('範圍已改變');
  expect(readTodayAgentFollowups(scope)).toEqual([]);
});

it('keeps a failed read out of storage so recovery can authenticate the same proof again', async () => {
  const item = fixture();
  const read = vi.fn<Read>().mockRejectedValueOnce(new Error('讀取中斷')).mockResolvedValueOnce(item.followup);
  await expect(retain(item, read)).rejects.toThrow('讀取中斷');
  expect(readTodayAgentFollowups(scope)).toEqual([]);
  expect(requestLock).not.toHaveBeenCalled();
  await expect(retain(item, read)).resolves.toEqual(item.followup);
  expect(readTodayAgentFollowups(scope)).toEqual([{ ...item.proof, verifiedAt }]);
  expect(read.mock.calls[1]).toEqual(read.mock.calls[0]);
});

it('reports storage failure and later retains the original proof without changing the receipt', async () => {
  const item = fixture(), original = structuredClone(item);
  const read = vi.fn<Read>().mockResolvedValue(item.followup);
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new DOMException('storage full', 'QuotaExceededError');
  });
  await expect(retain(item, read)).rejects.toThrow('尚未保留追蹤紀錄');
  expect(readTodayAgentFollowups(scope)).toEqual([]);
  write.mockRestore();
  await expect(retain(item, read)).resolves.toEqual(item.followup);
  expect(item).toEqual(original);
  expect(readTodayAgentFollowups(scope)).toEqual([{ ...item.proof, verifiedAt }]);
  expect(read).toHaveBeenCalledTimes(2);
});

it('preserves all 24 existing proofs if capacity is exhausted before the receipt can be retained', async () => {
  for (let index = 0; index < 24; index++) {
    const existing = fixture('existing-study-calendar-' + index);
    await saveTodayAgentFollowup(scope, existing.proof, existing.receipt, () => true);
  }
  const previous = localStorage.getItem(todayAgentFollowupStorageKey(scope));
  const item = fixture();
  await expect(retain(item, vi.fn<Read>().mockResolvedValue(item.followup))).rejects.toThrow('24 筆');
  expect(localStorage.getItem(todayAgentFollowupStorageKey(scope))).toBe(previous);
  expect(readTodayAgentFollowups(scope)).toHaveLength(24);
});

it.each([
  { name: 'new coursework', hint: true, restored: false, expected: true },
  { name: 'restored coursework', hint: true, restored: true, expected: true },
  { name: 'new ordinary event', hint: false, restored: false, expected: false },
  { name: 'restored ordinary event', hint: false, restored: true, expected: false },
  { name: 'new event without a hint', hint: undefined, restored: false, expected: false },
  { name: 'legacy recovery without a hint', hint: undefined, restored: true, expected: true },
])('classifies $name only as a read trigger', ({ hint, restored, expected }) => {
  const withoutHint = fixture().card;
  delete withoutHint.coursework;
  const card = { ...withoutHint, ...(hint === undefined ? {} : { coursework: hint }) };
  expect(needsCourseworkTracking(card, restored)).toBe(expected);
  expect(needsCourseworkTracking({ ...card, tool: 'propose_open_page' }, restored)).toBe(false);
});

it('does not send a legacy pickup recovery to the coursework followup reader', () => {
  const card = fixture().card;
  delete card.coursework;
  expect(needsCourseworkTracking({ ...card, sourceBound: 'food-pickup' }, true)).toBe(false);
});
