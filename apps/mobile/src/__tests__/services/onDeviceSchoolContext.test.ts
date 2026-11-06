import { nextSavedClasses } from '../../services/nextSavedClasses';
import {
  collectOnDeviceSchoolContext,
  formatOnDeviceSchoolPrompt,
  type SavedClassOccurrence,
} from '../../services/onDeviceSchoolContext';
import { classMeetingKey, type ClassException, type PersonalImportRecord } from '@campus/shared';
import { loadPersonalImports } from '../../services/personalImports';
import { loadOfflinePersonalTimetable, type StoredTimetable } from '../../services/personalTimetable';
import type { CampusSenseSnapshot } from '../../services/campusSenseSnapshot';

jest.mock('../../services/personalTimetable', () => ({
  ...jest.requireActual('../../services/personalTimetable'),
  loadOfflinePersonalTimetable: jest.fn(),
}));

jest.mock('../../firebase', () => ({}));
jest.mock('../../services/personalImports', () => ({ loadPersonalImports: jest.fn() }));

const timetable = {
  schoolId: 'pu',
  updatedAt: '2026-10-25T09:00:00.000Z',
  courses: [{ name: '資料庫概論', day: 1, start: 2, end: 3 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadPersonalImports).mockResolvedValue({ version: 1, batches: [], records: [] });
  jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue(null);
});

test('does not read private caches without a verified account or selected school', async () => {
  await expect(collectOnDeviceSchoolContext({ uid: '', schoolId: 'pu' })).resolves.toMatchObject({
    timetable: { source: 'not-available', courses: [] },
  });
  await expect(collectOnDeviceSchoolContext({ uid: 'alice', schoolId: '' })).resolves.toMatchObject({
    timetable: { source: 'not-available', courses: [] },
  });
  expect(loadOfflinePersonalTimetable).not.toHaveBeenCalled();
  expect(loadPersonalImports).not.toHaveBeenCalled();
});

test('only reads the selected account and campus copy, never a demo schedule', async () => {
  jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue(timetable as never);
  const result = await collectOnDeviceSchoolContext({
    uid: 'alice', schoolId: 'pu', schoolName: '靜宜大學',
  });
  expect(loadOfflinePersonalTimetable).toHaveBeenCalledWith('alice', 'pu');
  expect(loadPersonalImports).not.toHaveBeenCalled();
  expect(result.timetable).toMatchObject({
    source: 'saved-device-copy',
    updatedAt: '2026-10-25T09:00:00.000Z',
    courses: [{ name: '資料庫概論', day: 1, start: 2, end: 3 }],
  });
  const prompt = formatOnDeviceSchoolPrompt(result);
  expect(prompt).toContain('資料庫概論');
  expect(prompt).toContain('不能冒充鐘點或官方');
  expect(prompt).toContain('不是本次即時查詢');
});

test('missing or invalid cached data does not become a fabricated timetable', async () => {
  jest.mocked(loadOfflinePersonalTimetable).mockRejectedValue(new Error('corrupt'));
  const result = await collectOnDeviceSchoolContext({ uid: 'alice', schoolId: 'nthu' });
  expect(result.timetable).toEqual({
    source: 'not-available', updatedAt: null, courses: [],
  });
  expect(formatOnDeviceSchoolPrompt(result)).toContain('無法回答正式課程安排');
});

test('keeps the complete saved course set for offline tools, while limiting model context', async () => {
  const courses = Array.from({ length: 12 }, (_, index) => ({
    name: `測試課程${index + 1}`,
    day: index === 11 ? 5 : 1,
    start: (index % 13) + 1,
    end: (index % 13) + 1,
  }));
  jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue({
    ...timetable, courses,
  } as never);
  const result = await collectOnDeviceSchoolContext({ uid: 'alice', schoolId: 'pu' });
  expect(result.timetable.courses).toHaveLength(12);
  expect(result.timetable.courses[11].name).toBe('測試課程12');
  const prompt = formatOnDeviceSchoolPrompt(result);
  expect(prompt).toContain('測試課程8');
  expect(prompt).not.toContain('測試課程12');
  expect(prompt).toContain('尚有 4 門未列出');
  expect(prompt).toContain('不可據此判定某天沒課');
});

test('only includes an authorized and fresh campus snapshot for its original account', async () => {
  const local = await collectOnDeviceSchoolContext({ uid: 'alice', schoolId: 'pu' });
  const saved: CampusSenseSnapshot = {
    userId: 'alice', schoolId: 'pu', checkedAt: new Date().toISOString(),
    schedule: { status: 'available', count: 1 },
    assignments: {
      status: 'available', count: 1,
      items: [{ title: 'Alice 專屬作業', groupName: '資料庫', dueAt: null }],
    },
    announcements: { status: 'available', items: [] },
  };
  const containsPrivateTitle = (value: CampusSenseSnapshot, owner = local) =>
    formatOnDeviceSchoolPrompt(owner, value).includes('Alice 專屬作業');

  expect(local.ownerUid).toBe('alice');
  expect(containsPrivateTitle(saved)).toBe(true);
  expect(containsPrivateTitle({ ...saved, userId: 'bob' })).toBe(false);
  expect(containsPrivateTitle({ ...saved, schoolId: 'ncku' })).toBe(false);
  expect(containsPrivateTitle({
    ...saved, checkedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
  })).toBe(false);
  expect(containsPrivateTitle({
    ...saved, checkedAt: new Date(Date.now() + 31_000).toISOString(),
  })).toBe(false);
  expect(containsPrivateTitle(saved, { ...local, ownerUid: undefined })).toBe(false);
  expect(formatOnDeviceSchoolPrompt(local, { ...saved, userId: 'bob' }))
    .toContain('此回合沒有主動同步且有效的校園資料');
});

describe('class lookups from saved timetables and imports', () => {
  const now = '2026-11-05T00:00:00+08:00'; // Thursday, still Wednesday in UTC.
  const manual: StoredTimetable = {
    schoolId: 'pu', shareWithFriends: false, updatedAt: '2026-09-02T01:00:00Z',
    meta: { school: '', year: '115', semester: '1', className: '', credits: 0, title: '' },
    courses: [{ id: 'db', name: '資料庫', teacher: '', room: '305', day: 4, start: 1, end: 2, color: 'blue' }],
  };
  const original: PersonalImportRecord = {
    id: 'imported-db', schoolId: 'pu', title: '資料庫', location: '305',
    kind: 'timetable', dayOfWeek: 4, startPeriod: 1, endPeriod: 2,
    academicYear: '115', semester: '1', importedAt: '2026-11-01T06:17:00Z',
    batchId: 'batch', source: { type: 'paste', rawText: '', line: 1 },
  };
  function saveImports(...records: PersonalImportRecord[]) {
    jest.mocked(loadPersonalImports).mockResolvedValue({ version: 1, records, batches: [] });
  }
  const query = (schoolId = 'pu', classFollowUp?: readonly SavedClassOccurrence[]) =>
    collectOnDeviceSchoolContext({ uid: 'alice', schoolId, includeNextClasses: true, classFollowUp }).then((result) => result.timetable);
  const adjust = (changes: Partial<ClassException>): ClassException => ({
    id: 'change', original, originalDate: '2026-11-05', courseKey: classMeetingKey(original),
    kind: 'cancel', createdAt: now, ...changes,
  });

  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(now)); });
  afterEach(() => { jest.useRealTimers(); });

  test('deduplicates manual and imported copies, retaining every class with the earliest start', async () => {
    jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue(manual);
    saveImports(original, { ...original, id: 'other', title: '英文', location: '210' });
    const result = await query();
    expect(loadPersonalImports).toHaveBeenCalledWith({ owner: 'firebase:alice', schoolId: 'pu' });
    expect(result.updatedAt).toBe(original.importedAt);
    expect(result.nextClasses).toEqual([
      { courseId: 'imported-db', name: '資料庫', room: '305', date: '2026-11-05', term: '115|1', startTime: '08:10', endTime: '10:00' },
      { courseId: 'other', name: '英文', room: '210', date: '2026-11-05', term: '115|1', startTime: '08:10', endTime: '10:00' },
    ]);
  });

  test('platform imports and manual classes share the same local namespace and preserve the school alias', async () => {
    const platformTimetable = { accountId: 'pa-student', isCurrent: () => true };
    jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue(manual);
    saveImports({ ...original, schoolId: 'tw-pu', id: 'other', title: '英文', location: '210' });
    const result = await collectOnDeviceSchoolContext({ uid: '', schoolId: 'tw-pu', platformTimetable, includeNextClasses: true });
    expect(loadOfflinePersonalTimetable).toHaveBeenCalledWith('nuni:pa-student', 'tw-pu');
    expect(loadPersonalImports).toHaveBeenCalledWith({ owner: 'nuni:pa-student', schoolId: 'tw-pu' });
    expect(result.timetable.nextClasses?.map((entry) => entry.courseId).sort()).toEqual(['manual:db', 'other']);
  });

  test('platform reads fail closed across account changes and differentiate new accounts from storage failures', async () => {
    const platformTimetable = { accountId: 'pa-student', isCurrent: jest.fn(() => true) };
    const params = { uid: '', schoolId: 'pu', includeCurrentClasses: true, platformTimetable };
    platformTimetable.isCurrent.mockReturnValueOnce(false);
    expect((await collectOnDeviceSchoolContext(params)).timetable.source).toBe('not-available');
    expect(loadPersonalImports).not.toHaveBeenCalled();
    expect(loadOfflinePersonalTimetable).not.toHaveBeenCalled();
    expect((await collectOnDeviceSchoolContext(params)).timetable.source).toBe('not-available');
    jest.mocked(loadPersonalImports).mockRejectedValueOnce(new Error('cannot read ledger'));
    expect((await collectOnDeviceSchoolContext(params)).timetable.source).toBe('unreadable');
    jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue(manual);
    platformTimetable.isCurrent.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect((await collectOnDeviceSchoolContext(params)).timetable).toEqual({ source: 'not-available', courses: [], updatedAt: null });
  });

  test('handles exact start, in-progress classes, and the last class of the day', async () => {
    saveImports(original);
    jest.setSystemTime(new Date('2026-11-05T08:10:00+08:00'));
    expect((await query()).nextClasses?.[0]?.date).toBe('2026-11-05');
    jest.setSystemTime(new Date('2026-11-05T08:10:01+08:00'));
    expect((await query()).nextClasses?.[0]?.date).toBe('2026-11-12');
    jest.setSystemTime(new Date('2026-11-05T23:59:59+08:00'));
    expect((await query()).nextClasses?.[0]?.date).toBe('2026-11-12');
  });

  const current = (classFollowUp?: readonly SavedClassOccurrence[]) =>
    collectOnDeviceSchoolContext({ uid: 'alice', schoolId: 'pu', includeCurrentClasses: true, classFollowUp })
      .then((result) => result.timetable.currentClasses);

  test('ongoing covers [start, end), includes staggered overlaps and does not replace the next class', async () => {
    saveImports(original, { ...original, id: 'other', title: '英文', startTime: '09:00', endTime: '10:30' });
    jest.setSystemTime(new Date('2026-11-05T08:09:59+08:00'));
    expect(await current()).toEqual([]);
    jest.setSystemTime(new Date('2026-11-05T08:10:00+08:00'));
    const first = await current();
    expect(first?.map((row) => row.courseId)).toEqual(['imported-db']);
    jest.setSystemTime(new Date('2026-11-05T08:45:00+08:00'));
    const both = await collectOnDeviceSchoolContext({
      uid: 'alice', schoolId: 'pu', includeCurrentClasses: true, includeNextClasses: true,
    });
    expect(both.timetable.currentClasses).toEqual(first);
    expect(both.timetable.nextClasses?.[0]?.courseId).toBe('other');
    jest.setSystemTime(new Date('2026-11-05T09:45:00+08:00'));
    expect((await current())?.map((row) => row.courseId)).toEqual(['imported-db', 'other']);
    expect(await current(first)).toEqual(first);
    jest.setSystemTime(new Date('2026-11-05T10:00:00+08:00'));
    expect((await current())?.map((row) => row.courseId)).toEqual(['other']);
    expect(await current(first)).toEqual([]);
    jest.setSystemTime(new Date('2026-11-05T10:30:00+08:00'));
    expect(await current()).toEqual([]);
  });

  test('cancellation and an overnight makeup change the actual date, time and room used for current class', async () => {
    saveImports(original);
    const cache = jest.mocked(loadOfflinePersonalTimetable);
    cache.mockResolvedValue({ ...manual, classExceptions: [adjust({})] });
    jest.setSystemTime(new Date('2026-11-05T08:30:00+08:00'));
    expect(await current()).toEqual([]);
    cache.mockResolvedValue({ ...manual, classExceptions: [adjust({
      kind: 'move', date: '2026-11-06', startTime: '23:30', endDate: '2026-11-07', endTime: '01:15', location: '301',
    })] });
    jest.setSystemTime(new Date('2026-11-07T00:10:00+08:00'));
    expect(await current()).toEqual([
      expect.objectContaining({ courseId: 'imported-db', date: '2026-11-06', startTime: '23:30', endTime: '01:15', room: '301' }),
    ]);
    jest.setSystemTime(new Date('2026-11-07T01:15:00+08:00'));
    expect(await current()).toEqual([]);
  });

  test('a short upcoming window includes a class on the next Taiwan date, up to the exact cutoff', () => {
    const afterMidnight = { ...original, dayOfWeek: 5, startTime: '00:10', endTime: '01:00' };
    const beforeMidnight = new Date('2026-11-05T23:50:00+08:00');
    expect(nextSavedClasses([afterMidnight], 'pu', beforeMidnight, undefined, 20 * 60_000)).toEqual([
      expect.objectContaining({ date: '2026-11-06', startTime: '00:10' }),
    ]);
    expect(nextSavedClasses([afterMidnight], 'pu', beforeMidnight, undefined, 20 * 60_000 - 1)).toEqual([]);
  });

  test('an overnight course crossing a term boundary is attributed to the term when it actually started', async () => {
    saveImports(original, { ...original, id: 'spring', semester: '2' });
    const moved = {
      kind: 'move' as const, date: '2027-01-31', startTime: '23:30', endDate: '2027-02-01', endTime: '00:45',
    };
    jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue({
      ...manual, classExceptions: [adjust(moved)],
    });
    jest.setSystemTime(new Date('2027-02-01T00:20:00+08:00'));
    expect(await current()).toEqual([expect.objectContaining({ courseId: 'imported-db', term: '115|1', date: '2027-01-31' })]);
    jest.setSystemTime(new Date('2027-02-01T00:45:00+08:00'));
    expect(await current()).toEqual([]);
  });

  test('current class does not turn unreadable records, missing clocks or an older term into free time', async () => {
    expect(await current()).toBeUndefined();
    saveImports({ ...original, academicYear: '114' });
    expect(await current()).toBeUndefined();
    saveImports({ ...original, startPeriod: 99 });
    expect(await current()).toBeUndefined();
    jest.mocked(loadPersonalImports).mockRejectedValue(new Error('unreadable'));
    expect(await current()).toBeUndefined();
  });

  test('re-reads local cancellations, replacement dates and room changes on every lookup', async () => {
    saveImports(original);
    const cache = jest.mocked(loadOfflinePersonalTimetable);
    cache.mockResolvedValue({ ...manual, classExceptions: [adjust({})] });
    expect((await query()).nextClasses).toEqual([]); // Next Thursday at 08:10 is outside the window.
    cache.mockResolvedValue({ ...manual, classExceptions: [adjust({
      kind: 'move', date: '2026-11-07', startTime: '18:00', endTime: '20:50', location: '204',
    })] });
    expect((await query()).nextClasses).toEqual([
      expect.objectContaining({ courseId: 'imported-db', date: '2026-11-07', startTime: '18:00', endTime: '20:50', room: '204' }),
    ]);
    cache.mockResolvedValue({ ...manual, classExceptions: [adjust({ kind: 'room', location: '106' })] });
    expect((await query()).nextClasses?.[0]).toMatchObject({ courseId: 'imported-db', room: '106', date: '2026-11-05' });
  });

  test('rechecks the original class after it starts, reads its current room, and stops at its end', async () => {
    const later = { ...original, id: 'english', title: '英文', startPeriod: 3, endPeriod: 4 };
    saveImports(original, later);
    const prior = (await query()).nextClasses!.map((item) => ({ ...item, name: '舊課名', room: '舊教室' }));
    jest.setSystemTime(new Date('2026-11-05T08:10:01+08:00'));
    expect((await query()).nextClasses?.[0]?.courseId).toBe('english');
    jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue({
      ...manual, classExceptions: [adjust({ kind: 'room', location: '108' })],
    });
    expect((await query('pu', prior)).nextClasses).toEqual([
      expect.objectContaining({ courseId: 'imported-db', name: '資料庫', room: '108' }),
    ]);
    jest.setSystemTime(new Date('2026-11-05T10:00:00+08:00'));
    expect((await query('pu', prior)).nextClasses).toEqual([]);
  });

  test('a follow-up never substitutes a cancelled, rescheduled, or different-term occurrence', async () => {
    saveImports(original);
    const prior = (await query()).nextClasses!;
    const cache = jest.mocked(loadOfflinePersonalTimetable);
    cache.mockResolvedValue({ ...manual, classExceptions: [adjust({})] });
    expect((await query('pu', prior)).nextClasses).toEqual([]);
    cache.mockResolvedValue({ ...manual, classExceptions: [adjust({
      kind: 'move', date: '2026-11-05', startTime: '13:00', endTime: '14:00',
    })] });
    expect((await query('pu', prior)).nextClasses).toEqual([]);
    cache.mockResolvedValue(null);
    saveImports({ ...original, semester: '2' });
    expect((await query('pu', prior)).nextClasses).toEqual([]);
  });

  test('does not offer a course link when two makeup meetings have the same identity and start', async () => {
    const move = { kind: 'move' as const, date: '2026-11-07', startTime: '18:00', endTime: '20:50' };
    jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue({
      ...manual, classExceptions: [
        adjust({ ...move, location: '301' }),
        adjust({ ...move, originalDate: '2026-10-29', id: 'other', location: '401' }),
      ],
    });
    expect((await query()).nextClasses).toBeUndefined();
  });

  test('loads import-only timetables and uses the selected campus clock or explicit times', async () => {
    // Only adjustments from the timetable store are authoritative for this view.
    saveImports({ ...original, classExceptions: [adjust({})] });
    expect((await query()).nextClasses?.[0]?.date).toBe('2026-11-05');
    saveImports({ ...original, schoolId: 'ncku' });
    expect((await query('ncku')).nextClasses?.[0]).toMatchObject({ date: '2026-11-05', startTime: '07:00', endTime: '08:50' });
    saveImports({ ...original, schoolId: 'other', startTime: '09:25', endTime: '10:15' });
    expect((await query('other')).nextClasses?.[0]?.startTime).toBe('09:25');
    saveImports({ ...original, schoolId: 'other' });
    expect((await query('other')).nextClasses).toBeUndefined();
  });

  test('isolates different schools and includes a matching historical campus alias', async () => {
    saveImports({ ...original, schoolId: 'ncku' });
    expect((await query('pu')).source).toBe('not-available');
    jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue({ ...manual, schoolId: 'ncku' });
    expect((await query('pu')).source).toBe('not-available');
    jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue(manual);
    expect((await query('tw-pu')).nextClasses?.[0]?.courseId).toBe('manual:db');
  });

  test('never rolls an old or unknown term forward, including across a term boundary', async () => {
    saveImports({ ...original, semester: '2', academicYear: '114' });
    expect((await query()).nextClasses).toBeUndefined();
    saveImports({ ...original, academicYear: '' });
    expect((await query()).nextClasses).toBeUndefined();
    jest.setSystemTime(new Date('2027-01-31T23:00:00+08:00'));
    saveImports(original);
    expect((await query()).nextClasses).toBeUndefined();
    saveImports(original, { ...original, id: 'spring', dayOfWeek: 1, academicYear: '2026', semester: '下學期' });
    expect((await query()).nextClasses?.[0]).toMatchObject({ courseId: 'spring', term: '2026|下學期', date: '2027-02-01' });
  });
});
