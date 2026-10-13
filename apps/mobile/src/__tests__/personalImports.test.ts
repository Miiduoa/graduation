import AsyncStorage from '@react-native-async-storage/async-storage';
import { meetupWindows, type PersonalImportRow } from '@campus/shared';
import {
  appendPersonalImports,
  editPersonalImport,
  loadPersonalImports,
  personalImportCourses,
  personalImportStorageKey,
  selectPersonalTimetableCourses,
  undoLastPersonalImport,
} from '../services/personalImports';

const scope = { owner: 'nuni:account-a', schoolId: 'pu' };
const row = (id: string, title = '微積分'): PersonalImportRow => ({
  id,
  kind: 'timetable',
  title,
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  dayOfWeek: 1,
  startPeriod: 1,
  endPeriod: 2,
  source: { type: 'paste', line: 1, rawText: '' },
});
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('append is durable, duplicate-safe, and isolated by account and school', async () => {
  const first = await appendPersonalImports(scope, [row('a')]);
  expect(first.added).toBe(1);
  const again = await appendPersonalImports(scope, [row('b')]);
  expect(again.added).toBe(0);
  expect(again.duplicates).toBe(1);
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
  expect((await loadPersonalImports({ ...scope, owner: 'nuni:account-b' })).records).toHaveLength(
    0,
  );
  expect((await loadPersonalImports({ ...scope, schoolId: 'ntu' })).records).toHaveLength(0);
});

test('simultaneous saves serialize and do not lose either record', async () => {
  await Promise.all([
    appendPersonalImports(scope, [row('a')]),
    appendPersonalImports(scope, [row('b', '英文')]),
  ]);
  expect((await loadPersonalImports(scope)).records.map((item) => item.title).sort()).toEqual([
    '微積分',
    '英文',
  ]);
});

test('undo leaves subsequent edits intact and rejects a stale batch', async () => {
  const first = await appendPersonalImports(scope, [row('a'), row('b', '英文')]);
  const before = first.ledger.records[0];
  await editPersonalImport(scope, before, { ...before, title: '微積分（一）' });
  const undo = await undoLastPersonalImport(scope, first.ledger.batches[0].id);
  expect(undo.removed).toBe(1);
  expect(undo.ledger.records[0].title).toBe('微積分（一）');
  await expect(undoLastPersonalImport(scope, first.ledger.batches[0].id)).rejects.toThrow('已更新');
});

test('invalid rows, stale edits, and cancelled scopes never overwrite durable data', async () => {
  const first = await appendPersonalImports(scope, [row('a')]);
  await expect(appendPersonalImports(scope, [{ ...row('b'), endPeriod: 0 }])).rejects.toThrow();
  await expect(appendPersonalImports(scope, [row('b', '英文')], () => false)).rejects.toThrow(
    '切換',
  );
  const before = first.ledger.records[0];
  await editPersonalImport(scope, before, { ...before, title: '微積分（一）' });
  await expect(editPersonalImport(scope, before, { ...before, title: '過期編輯' })).rejects.toThrow(
    '已變更',
  );
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});

test('corrupted storage is reported and preserved', async () => {
  const key = personalImportStorageKey(scope);
  await AsyncStorage.setItem(key, '{invalid');
  await expect(appendPersonalImports(scope, [row('a')])).rejects.toThrow();
  expect(await AsyncStorage.getItem(key)).toBe('{invalid');
});

test('projection accepts only explicit supported PU periods without changing saved records', async () => {
  const saved = await appendPersonalImports(scope, [row('a')]);
  const records = saved.ledger.records;
  expect(personalImportCourses(records, 'pu')[0]).toMatchObject({
    id: 'import:a',
    day: 1,
    start: 1,
    end: 2,
  });
  expect(personalImportCourses(records, 'ntu')).toEqual([]);
  expect(personalImportCourses([{ ...records[0], dayOfWeek: 6 }], 'pu')).toEqual([]);
  expect(personalImportCourses([{ ...records[0], startPeriod: undefined }], 'pu')).toEqual([]);
  expect(records[0].id).toBe('a');
});

test('all-day events and letter grades survive reload without invented credit conclusions', async () => {
  const result = await appendPersonalImports(scope, [
    { ...row('grade'), kind: 'grades', grade: 'A-', credits: 3 },
    {
      ...row('event'),
      kind: 'events',
      title: '校慶',
      academicYear: '',
      semester: '',
      date: '2026-10-20',
      allDay: true,
    },
  ]);
  expect(result.added).toBe(2);
  expect((await loadPersonalImports(scope)).records).toEqual(result.ledger.records);
});

test('changed room or linked class is a conflict, never a silently discarded duplicate', async () => {
  await appendPersonalImports(scope, [{ ...row('a'), location: '主顧303' }]);
  await expect(
    appendPersonalImports(scope, [{ ...row('b'), location: '主顧501' }]),
  ).rejects.toThrow('地點');
  expect((await loadPersonalImports(scope)).records[0].location).toBe('主顧303');
});

test('local imports occupy time for meetup planning without publishing courses', async () => {
  const result = await appendPersonalImports(scope, [
    { ...row('a'), dayOfWeek: 1, startPeriod: 1, endPeriod: 13 },
  ]);
  const occupied = personalImportCourses(result.ledger.records, 'pu');
  expect(meetupWindows([], []).some((window) => window.day === 1)).toBe(true);
  expect(meetupWindows(occupied, []).some((window) => window.day === 1)).toBe(false);
});

test('JSON-valid malformed ledger is rejected without replacing recoverable storage', async () => {
  const saved = await appendPersonalImports(scope, [row('a')]);
  const key = personalImportStorageKey(scope);
  const raw = JSON.stringify({
    ...saved.ledger,
    records: [{ ...saved.ledger.records[0], title: { bad: true } }],
  });
  await AsyncStorage.setItem(key, raw);
  await expect(loadPersonalImports(scope)).rejects.toThrow('無法讀取');
  await expect(appendPersonalImports(scope, [row('b')])).rejects.toThrow();
  expect(await AsyncStorage.getItem(key)).toBe(raw);
});

test('selected historical term does not mix current or unknown-term original courses', async () => {
  const saved = await appendPersonalImports(scope, [
    { ...row('old'), academicYear: '114', semester: '2' },
  ]);
  const base = {
    meta: { year: '115', semester: '1' },
    courses: [
      {
        id: 'current',
        name: '英文',
        day: 2,
        start: 3,
        end: 4,
        teacher: '',
        room: '',
        color: 'blue' as const,
      },
    ],
  };
  expect(
    selectPersonalTimetableCourses(base, saved.ledger.records, 'pu', '114／2').map(
      (course) => course.id,
    ),
  ).toEqual(['import:old']);
  expect(
    selectPersonalTimetableCourses(base, saved.ledger.records, 'pu', 'legacy').map(
      (course) => course.id,
    ),
  ).toEqual(['current']);
  expect(
    selectPersonalTimetableCourses(
      { ...base, meta: { year: '', semester: '' } },
      saved.ledger.records,
      'pu',
      '114／2',
    ).map((course) => course.id),
  ).toEqual(['import:old']);
  expect(
    selectPersonalTimetableCourses(
      { ...base, meta: { year: '114', semester: '2' } },
      saved.ledger.records,
      'pu',
      '114／2',
    ),
  ).toHaveLength(2);
});
