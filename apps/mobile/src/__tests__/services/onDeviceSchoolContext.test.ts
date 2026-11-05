import {
  collectOnDeviceSchoolContext,
  formatOnDeviceSchoolPrompt,
  type SavedClassOccurrence,
} from '../../services/onDeviceSchoolContext';
import { classMeetingKey, type ClassException, type PersonalImportRecord } from '@campus/shared';
import { loadPersonalImports } from '../../services/personalImports';
import { loadOfflinePersonalTimetable, type StoredTimetable } from '../../services/personalTimetable';

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

describe('next class from saved timetables and imports', () => {
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

  test('handles exact start, in-progress classes, and the last class of the day', async () => {
    saveImports(original);
    jest.setSystemTime(new Date('2026-11-05T08:10:00+08:00'));
    expect((await query()).nextClasses?.[0]?.date).toBe('2026-11-05');
    jest.setSystemTime(new Date('2026-11-05T08:10:01+08:00'));
    expect((await query()).nextClasses?.[0]?.date).toBe('2026-11-12');
    jest.setSystemTime(new Date('2026-11-05T23:59:59+08:00'));
    expect((await query()).nextClasses?.[0]?.date).toBe('2026-11-12');
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
