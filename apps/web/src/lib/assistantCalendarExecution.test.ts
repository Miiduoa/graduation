import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantCalendarEvent, AssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import type { PersonalImportSyncState } from '@campus/shared/src/imports/sync';
import { assertAssistantCalendarLocalReady, mirrorAssistantCalendarReceipt } from './assistantCalendarExecution';
import { personalImportsStorageKey, readPersonalImports, readPersonalImportSyncState } from './personalImports';

const scope = { owner: 'platform:one', schoolId: 'pu' };
const now = '2026-11-07T10:00:00.000Z';
const args: AssistantCalendarEvent = {
  title: '資料庫複習', date: '2026-11-09', allDay: false, startTime: '14:00', endTime: '15:00',
};
const record = (id = 'av2_1234567890abcdef1234567890abcdef', patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord & { kind: 'events' } => ({
  ...args, id, batchId: id, schoolId: 'pu', academicYear: '', semester: '',
  importedAt: now, source: { type: 'paste', name: '助理確認', line: 1, rawText: '' }, ...patch,
  kind: 'events',
});
const receipt = (): AssistantCalendarReceipt => ({
  version: 1, operation: 'calendar.create', status: 'verified', storage: 'synced', schoolId: 'pu',
  mutationId: record().id, verifiedAt: now, revision: 5, replay: false, record: record(),
});
const base = (records: PersonalImportRecord[] = [], revision = 1) => ({ schoolId: 'pu', records, revision, updatedAt: now });
const idle: PersonalImportSyncState = { enabled: false, base: null };
function seed(records: PersonalImportRecord[], sync: PersonalImportSyncState = idle, target = scope) {
  localStorage.setItem(personalImportsStorageKey(target), JSON.stringify({ version: 1, records, sync }));
}
const stored = () => localStorage.getItem(personalImportsStorageKey(scope));
const storageMethods = () => Object.hasOwn(localStorage, 'setItem') ? localStorage : Object.getPrototypeOf(localStorage);

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: vi.fn((key: string, action: () => unknown) => {
      const next = (queues.get(key) || Promise.resolve()).then(action);
      queues.set(key, next.catch(() => {}));
      return next;
    }) },
  });
});

describe('verified assistant event mirror', () => {
  it('preserves every unrelated local row, full baseline, and disabled sync while acknowledging only the verified event', async () => {
    const local = record('local-only', { title: '未同步行程', date: '2026-11-10', source: { type: 'file', name: '我的原始檔.ics', line: 8, rawText: 'local source' } });
    const grade: PersonalImportRecord = {
      id: 'grade-local', batchId: 'grade-batch', schoolId: 'pu', kind: 'grades', title: '成績原稿',
      academicYear: '115', semester: '1', grade: 'A', credits: 3, importedAt: now,
      source: { type: 'paste', line: 3, rawText: 'private original grade' },
    };
    const sync: PersonalImportSyncState = { enabled: false, base: base() };
    seed([local, grade], sync);
    const otherScope = { owner: 'platform:two', schoolId: 'pu' };
    seed([record('other-owner')], idle, otherScope);
    const otherBefore = localStorage.getItem(personalImportsStorageKey(otherScope));
    await mirrorAssistantCalendarReceipt(receipt(), scope, () => true);
    expect(readPersonalImports(scope)).toEqual([local, grade, record()]);
    expect(readPersonalImportSyncState(scope)).toEqual({
      ...sync, acknowledged: [{ record: record(), revision: 5 }],
    });
    expect(localStorage.getItem(personalImportsStorageKey(otherScope))).toBe(otherBefore);
    expect(navigator.locks.request).toHaveBeenCalledWith(personalImportsStorageKey(scope), expect.any(Function));
  });

  it('is idempotent for an exact verified row and retains a newer acknowledgement', async () => {
    seed([]);
    await mirrorAssistantCalendarReceipt(receipt(), scope, () => true);
    const before = stored();
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    await mirrorAssistantCalendarReceipt({ ...receipt(), replay: true }, scope, () => true);
    expect(stored()).toBe(before);
    expect(dispatch).not.toHaveBeenCalled();
    const newer = { ...receipt(), revision: 6 };
    await mirrorAssistantCalendarReceipt(newer, scope, () => true);
    await mirrorAssistantCalendarReceipt(receipt(), scope, () => true);
    expect(readPersonalImports(scope)).toEqual([record()]);
    expect(readPersonalImportSyncState(scope).acknowledged?.[0].revision).toBe(6);
  });

  it('does not alter an existing full baseline that already covers the event', async () => {
    const sync: PersonalImportSyncState = { enabled: true, base: base([record()], 6) };
    seed([record()], sync);
    const before = stored();
    await mirrorAssistantCalendarReceipt(receipt(), scope, () => true);
    expect(stored()).toBe(before);
    expect(readPersonalImportSyncState(scope).acknowledged).toBeUndefined();
  });

  it.each([
    ['same ID with changed contents', [record(undefined, { location: '本機改過' })], idle],
    ['same semantic identity under another ID', [record('another-id')], idle],
    ['a local deletion relative to the full baseline', [], { enabled: false, base: base([record()], 4) }],
    ['a local deletion after an exact-version baseline', [], { enabled: true, base: base([record()], 5) }],
    ['a local deletion after single-event acknowledgement', [], { enabled: false, base: null, acknowledged: [{ record: record(), revision: 5 }] }],
    ['a newer full baseline that removed the event', [], { enabled: false, base: base([], 6) }],
    ['a contradictory same-revision baseline', [], { enabled: false, base: base([], 5) }],
  ] as const)('keeps storage unchanged for %s', async (_name, rows, sync) => {
    seed([...rows], sync as PersonalImportSyncState);
    const before = stored();
    await expect(mirrorAssistantCalendarReceipt(receipt(), scope, () => true)).rejects.toThrow();
    expect(stored()).toBe(before);
  });

  it('blocks when a full-ledger write is uncertain without rewriting its pending payload', async () => {
    const sync: PersonalImportSyncState = {
      enabled: true, base: base(),
      pending: { mutationId: 'pending-write-01', expectedRevision: 1, records: [record('pending-event')] },
    };
    seed([], sync);
    const before = stored();
    await expect(mirrorAssistantCalendarReceipt(receipt(), scope, () => true)).rejects.toMatchObject({ code: 'ASSISTANT_CALENDAR_SYNC_PENDING' });
    expect(stored()).toBe(before);
    expect(readPersonalImportSyncState(scope).pending).toEqual(sync.pending);
  });

  it.each(['device', 'foreign-school', 'invalid-grade-field', 'invalid-mutation'] as const)('rejects a %s receipt before storage changes', async (kind) => {
    seed([]);
    const invalid = receipt();
    if (kind === 'device') invalid.storage = 'device';
    if (kind === 'foreign-school') invalid.schoolId = 'ntu';
    if (kind === 'invalid-grade-field') invalid.record.grade = '100';
    if (kind === 'invalid-mutation') invalid.record.id = 'another-event';
    const before = stored();
    await expect(mirrorAssistantCalendarReceipt(invalid, scope, () => true)).rejects.toThrow();
    expect(stored()).toBe(before);
  });

  it('does not execute getters while revalidating a receipt', async () => {
    const value = receipt();
    const getter = vi.fn(() => record());
    Object.defineProperty(value, 'record', { enumerable: true, get: getter });
    await expect(mirrorAssistantCalendarReceipt(value, scope, () => true)).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });

  it('rejects school-account owners and a scope that expires while waiting for the same local lock', async () => {
    await expect(mirrorAssistantCalendarReceipt(receipt(), { ...scope, owner: 'school:one' }, () => true)).rejects.toThrow();
    let grant!: () => void;
    let active = true;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (_key: string, action: () => unknown) => new Promise((resolve, reject) => {
        grant = () => { void Promise.resolve().then(action).then(resolve, reject); };
      }),
    } });
    const pending = mirrorAssistantCalendarReceipt(receipt(), scope, () => active);
    active = false;
    grant();
    await expect(pending).rejects.toThrow('帳號或校園已切換');
    expect(stored()).toBeNull();
  });

  it('retains a damaged ledger or exhausted capacity without silently resetting it', async () => {
    localStorage.setItem(personalImportsStorageKey(scope), '{damaged');
    await expect(mirrorAssistantCalendarReceipt(receipt(), scope, () => true)).rejects.toThrow('原始資料仍保留');
    expect(stored()).toBe('{damaged');
    seed(Array.from({ length: 2000 }, (_, index) => record(`existing-${index}`, { title: `原行程 ${index}`, date: '2026-11-10' })));
    const before = stored();
    await expect(mirrorAssistantCalendarReceipt(receipt(), scope, () => true)).rejects.toMatchObject({ code: 'ASSISTANT_CALENDAR_LOCAL_FULL' });
    expect(stored()).toBe(before);
  });

  it('does not claim a local mirror when storage rejects or silently fails the write', async () => {
    seed([]);
    const before = stored();
    const write = vi.spyOn(storageMethods(), 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(mirrorAssistantCalendarReceipt(receipt(), scope, () => true)).rejects.toThrow('裝置空間不足');
    expect(stored()).toBe(before);
    write.mockImplementation(() => {});
    await expect(mirrorAssistantCalendarReceipt(receipt(), scope, () => true)).rejects.toMatchObject({ code: 'ASSISTANT_CALENDAR_LOCAL_VERIFY_FAILED' });
    expect(stored()).toBe(before);
  });
});

describe('assistant calendar preflight', () => {
  it('validates the current local scope without writing data or enabling sync', async () => {
    seed([record('another-date', { date: '2026-11-10' })]);
    const before = stored();
    const write = vi.spyOn(storageMethods(), 'setItem');
    await assertAssistantCalendarLocalReady(args, scope, () => true);
    expect(stored()).toBe(before);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ['same event', record()],
    ['overlapping time', record('overlap', { title: '其他安排', startTime: '13:30', endTime: '14:30' })],
    ['cross-midnight event', record('night', { title: '跨夜安排', date: '2026-11-08', endDate: '2026-11-09', startTime: '23:00', endTime: '14:30' })],
    ['all-day event', { ...record('all-day', { title: '全天安排', allDay: true }), startTime: undefined, endTime: undefined }],
  ] as const)('blocks %s before a server request can be sent', async (_name, row) => {
    seed([row]);
    const before = stored();
    await expect(assertAssistantCalendarLocalReady(args, scope, () => true)).rejects.toThrow();
    expect(stored()).toBe(before);
  });

  it('accepts touching time boundaries and respects exclusive all-day end dates', async () => {
    seed([
      record('touching', { title: '上一段安排', startTime: '13:00', endTime: '14:00' }),
      { ...record('previous-day', { title: '前一天', date: '2026-11-08', endDate: '2026-11-09', allDay: true }), startTime: undefined, endTime: undefined },
    ]);
    await expect(assertAssistantCalendarLocalReady(args, scope, () => true)).resolves.toBeUndefined();
  });

  it('rejects pending sync, malformed state, extra event fields, and inactive identity before writes', async () => {
    seed([], { enabled: false, base: null, pending: { mutationId: 'pending-existing-01', expectedRevision: 0, records: [] } });
    await expect(assertAssistantCalendarLocalReady(args, scope, () => true)).rejects.toMatchObject({ code: 'ASSISTANT_CALENDAR_SYNC_PENDING' });
    seed([]);
    await expect(assertAssistantCalendarLocalReady({ ...args, schoolId: 'ntu' }, scope, () => true)).rejects.toThrow();
    await expect(assertAssistantCalendarLocalReady(args, scope, () => false)).rejects.toMatchObject({ code: 'ASSISTANT_CALENDAR_SCOPE_CHANGED' });
    localStorage.setItem(personalImportsStorageKey(scope), JSON.stringify({ version: 1, records: [], sync: { enabled: false, base: null, acknowledged: 'corrupt' } }));
    const before = stored();
    await expect(assertAssistantCalendarLocalReady(args, scope, () => true)).rejects.toThrow();
    expect(stored()).toBe(before);
  });
});
