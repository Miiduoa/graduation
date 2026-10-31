import { classMeetingKey, manualClassRecords, classExceptionsForStorage, buildPersonalToday } from '@campus/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDoc, setDoc, runTransaction } from 'firebase/firestore';
import {
  createCourseAppeal,
  loadFriendTimetable,
  loadPersonalTimetable,
  loadPersonalTimetableDraft,
  loadOfflinePersonalTimetable,
  personalTimetableRecords,
  savePersonalTimetable,
  type StoredTimetable,
} from '../services/personalTimetable';

jest.mock('../firebase', () => ({ getDb: jest.fn(() => ({})), getFunctionsInstance: jest.fn() }));

type DocRef = { path: string };

const mockCloudStore = new Map<string, Record<string, unknown>>();
const mockFailingPaths = new Set<string>();

jest.mock('firebase/firestore', () => ({
  getDoc: jest.fn(async (ref: DocRef) => {
    if (mockFailingPaths.has(ref.path)) throw new Error(`read-failed:${ref.path}`);
    const data = mockCloudStore.get(ref.path);
    return {
      exists: () => data !== undefined,
      data: () => data,
    };
  }),
  runTransaction: jest.fn(async (_db: unknown, run: (transaction: unknown) => Promise<unknown>) => run({
    get: async (ref: DocRef) => {
      if (mockFailingPaths.has(ref.path)) throw new Error('offline');
      const data = mockCloudStore.get(ref.path);
      return { exists: () => data !== undefined, data: () => data };
    },
    set: (ref: DocRef, data: Record<string, unknown>) => {
      const merged = { ...mockCloudStore.get(ref.path), ...data };
      for (const key of Object.keys(merged)) if (merged[key] === '__DELETE__') delete merged[key];
      mockCloudStore.set(ref.path, merged);
    },
  })),
  doc: jest.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  setDoc: jest.fn(async (ref: DocRef, data: Record<string, unknown>) => {
    const prev = mockCloudStore.get(ref.path) || {};
    mockCloudStore.set(ref.path, { ...prev, ...data });
  }),
  deleteField: jest.fn(() => '__DELETE__'),
  serverTimestamp: jest.fn(() => 'SERVER_TIME'),
  collection: jest.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  updateDoc: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

const make = (schoolId: string, extras: Partial<StoredTimetable> = {}): StoredTimetable => ({
  schoolId,
  shareWithFriends: false,
  courses: [
    { id: 'c1', name: '私人成績', teacher: '', room: '', day: 1, start: 1, end: 2, color: 'blue' },
  ],
  meta: { school: '', year: '115', semester: '1', className: '', credits: 0, title: '' },
  updatedAt: '2026-10-13T00:00:00.000Z',
  ...extras,
});

const scopedPath = (uid: string, schoolId: string) =>
  `users/${uid}/schools/${schoolId}/personalTimetable/current`;
const exceptionsPath = (uid: string) => `users/${uid}/schools/pu/personalTimetable/exceptions`;
const legacyPath = (uid: string) => `users/${uid}/personalTimetable/current`;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCloudStore.clear();
  mockFailingPaths.clear();
  jest.mocked(getDoc).mockClear();
  jest.mocked(setDoc).mockClear();
});

test('old school cache cannot appear in another selected school', async () => {
  await AsyncStorage.setItem('campus-one-personal-timetable:local', JSON.stringify(make('pu')));
  expect((await loadPersonalTimetable(null, 'ntu')).courses).toEqual([]);
  expect((await loadPersonalTimetable(null, 'pu')).courses).toHaveLength(1);
});

test('new saves keep per-school local schedules and reject a mismatched cloud fallback', async () => {
  await savePersonalTimetable(null, make('pu'));
  await savePersonalTimetable(null, { ...make('ntu'), courses: [] });
  expect((await loadPersonalTimetable(null, 'pu')).courses).toHaveLength(1);
  mockCloudStore.set(scopedPath('account', 'ntu'), make('pu') as unknown as Record<string, unknown>);
  expect((await loadPersonalTimetable('account', 'ntu')).courses).toEqual([]);
});

test('platform accounts never inherit guest or another platform account timetable', async () => {
  await savePersonalTimetable(null, make('pu'));
  expect((await loadPersonalTimetable(null, 'pu', 'nuni:account-a')).courses).toEqual([]);
  await savePersonalTimetable(null, make('pu'), 'nuni:account-a');
  expect((await loadPersonalTimetable(null, 'pu', 'nuni:account-a')).courses).toHaveLength(1);
  expect((await loadPersonalTimetable(null, 'pu', 'nuni:account-b')).courses).toEqual([]);
  expect((await loadPersonalTimetable(null, 'ntu', 'nuni:account-a')).courses).toEqual([]);
  expect(getDoc).not.toHaveBeenCalled();
});

test.each([
  '{broken-json',
  JSON.stringify({ ...make('pu'), courses: {} }),
  JSON.stringify({ ...make('pu'), courses: [null] }),
  JSON.stringify({ ...make('pu'), meta: null }),
])('an unreadable stored timetable is reported and cannot be overwritten: %s', async (raw) => {
  const key = 'campus-one-personal-timetable:nuni:account-a:pu';
  await AsyncStorage.setItem(key, raw);
  await expect(loadPersonalTimetable(null, 'pu', 'nuni:account-a')).rejects.toThrow('已保留原始資料');
  await expect(savePersonalTimetable(null, make('pu'), 'nuni:account-a')).rejects.toThrow('已保留原始資料');
  expect(await AsyncStorage.getItem(key)).toBe(raw);
});

test('A/B cloud saves stay independent on school-scoped paths and never touch legacy', async () => {
  await savePersonalTimetable('uid-1', make('pu', { courses: [{ id: 'pu1', name: '靜宜課', teacher: 'A', room: '', day: 1, start: 1, end: 1, color: 'blue' }] }));
  await savePersonalTimetable('uid-1', make('ntu', { courses: [{ id: 'ntu1', name: '台大課', teacher: 'B', room: '', day: 2, start: 2, end: 2, color: 'green' }] }));

  expect(mockCloudStore.has(scopedPath('uid-1', 'pu'))).toBe(true);
  expect(mockCloudStore.has(scopedPath('uid-1', 'ntu'))).toBe(true);
  expect(mockCloudStore.has(legacyPath('uid-1'))).toBe(false);

  const pu = await loadPersonalTimetable('uid-1', 'pu');
  const ntu = await loadPersonalTimetable('uid-1', 'ntu');
  expect(pu.schoolId).toBe('pu');
  expect(pu.courses.map((c) => c.id)).toEqual(['pu1']);
  expect(ntu.schoolId).toBe('ntu');
  expect(ntu.courses.map((c) => c.id)).toEqual(['ntu1']);
  expect([...mockCloudStore.keys()].some((path) => path === legacyPath('uid-1'))).toBe(false);
});

test('scoped cloud document wins over a matching legacy document', async () => {
  mockCloudStore.set(scopedPath('uid-1', 'pu'), make('pu', {
    courses: [{ id: 'scoped', name: '新課', teacher: '', room: '', day: 1, start: 1, end: 1, color: 'blue' }],
  }) as unknown as Record<string, unknown>);
  mockCloudStore.set(legacyPath('uid-1'), make('pu', {
    courses: [{ id: 'legacy', name: '舊課', teacher: '', room: '', day: 1, start: 1, end: 1, color: 'blue' }],
  }) as unknown as Record<string, unknown>);

  const loaded = await loadPersonalTimetable('uid-1', 'pu');
  expect(loaded.courses.map((c) => c.id)).toEqual(['scoped']);
  expect(loaded.schoolId).toBe('pu');
  expect(jest.mocked(getDoc).mock.calls.map((call) => (call[0] as DocRef).path)).toEqual([
    exceptionsPath('uid-1'),
    scopedPath('uid-1', 'pu'),
  ]);
});

test('matching legacy falls back only when scoped is absent', async () => {
  mockCloudStore.set(legacyPath('uid-1'), make('pu') as unknown as Record<string, unknown>);
  const loaded = await loadPersonalTimetable('uid-1', 'pu');
  expect(loaded.courses).toHaveLength(1);
  expect(loaded.schoolId).toBe('pu');
});

test('nonmatching legacy is ignored when scoped is absent', async () => {
  mockCloudStore.set(legacyPath('uid-1'), make('ntu') as unknown as Record<string, unknown>);
  const loaded = await loadPersonalTimetable('uid-1', 'pu');
  expect(loaded.courses).toEqual([]);
  expect(loaded.schoolId).toBe('pu');
});

test('failed scoped read does not fall back to legacy cloud', async () => {
  mockFailingPaths.add(scopedPath('uid-1', 'pu'));
  mockCloudStore.set(legacyPath('uid-1'), make('pu') as unknown as Record<string, unknown>);
  const loaded = await loadPersonalTimetable('uid-1', 'pu');
  expect(loaded.courses).toEqual([]);
  expect(jest.mocked(getDoc).mock.calls.map((call) => (call[0] as DocRef).path)).toEqual([
    exceptionsPath('uid-1'),
    scopedPath('uid-1', 'pu'),
  ]);
});

test.each([
  ['pu', 'tw-pu'],
  ['tw-pu', 'pu'],
] as const)('pu/tw-pu aliases share canonical cloud and local data (%s → %s)', async (saveAs, loadAs) => {
  await savePersonalTimetable('uid-1', make(saveAs));
  expect(mockCloudStore.has(scopedPath('uid-1', 'pu'))).toBe(true);
  expect(mockCloudStore.has(scopedPath('uid-1', 'tw-pu'))).toBe(false);

  const loaded = await loadPersonalTimetable('uid-1', loadAs);
  expect(loaded.schoolId).toBe('pu');
  expect(loaded.courses).toHaveLength(1);

  await AsyncStorage.clear();
  mockCloudStore.clear();
  await AsyncStorage.setItem(
    `campus-one-personal-timetable:local:${saveAs}`,
    JSON.stringify(make(saveAs)),
  );
  const localOnly = await loadPersonalTimetable(null, loadAs);
  expect(localOnly.schoolId).toBe('pu');
  expect(localOnly.courses).toHaveLength(1);
});

test('loadFriendTimetable requires schoolId and enforces share + school scope', async () => {
  await expect(loadFriendTimetable('friend-1', '')).rejects.toThrow('schoolId is required');

  mockCloudStore.set(scopedPath('friend-1', 'pu'), make('pu', { shareWithFriends: true }) as unknown as Record<string, unknown>);
  expect((await loadFriendTimetable('friend-1', 'pu'))?.courses).toHaveLength(1);
  expect((await loadFriendTimetable('friend-1', 'tw-pu'))?.schoolId).toBe('pu');

  mockCloudStore.set(scopedPath('friend-1', 'pu'), make('pu', { shareWithFriends: false }) as unknown as Record<string, unknown>);
  expect(await loadFriendTimetable('friend-1', 'pu')).toBeNull();

  mockCloudStore.set(scopedPath('friend-1', 'ntu'), make('pu', { shareWithFriends: true }) as unknown as Record<string, unknown>);
  expect(await loadFriendTimetable('friend-1', 'ntu')).toBeNull();
});

test('friend legacy fallback matches school and respects privacy; failed scoped skips legacy', async () => {
  mockCloudStore.set(legacyPath('friend-1'), make('pu', { shareWithFriends: true }) as unknown as Record<string, unknown>);
  expect((await loadFriendTimetable('friend-1', 'pu'))?.courses).toHaveLength(1);

  mockCloudStore.set(legacyPath('friend-1'), make('ntu', { shareWithFriends: true }) as unknown as Record<string, unknown>);
  expect(await loadFriendTimetable('friend-1', 'pu')).toBeNull();

  mockCloudStore.set(legacyPath('friend-1'), make('pu', { shareWithFriends: false }) as unknown as Record<string, unknown>);
  expect(await loadFriendTimetable('friend-1', 'pu')).toBeNull();

  mockFailingPaths.add(scopedPath('friend-1', 'pu'));
  mockCloudStore.set(legacyPath('friend-1'), make('pu', { shareWithFriends: true }) as unknown as Record<string, unknown>);
  expect(await loadFriendTimetable('friend-1', 'pu')).toBeNull();
});

test('appeal index writes only the scoped path from matching legacy or local courses', async () => {
  mockCloudStore.set(legacyPath('student-1'), {
    ...make('pu'),
    shareWithFriends: true,
  } as unknown as Record<string, unknown>);

  await createCourseAppeal(
    {
      schoolId: 'pu',
      studentUid: 'student-1',
      courseId: 'c1',
      courseName: '私人成績',
      offeringId: '私人成績｜老師未填',
      title: 't',
      body: 'b',
    },
    'appeal-1',
  );

  expect(mockCloudStore.has(scopedPath('student-1', 'pu'))).toBe(true);
  expect(mockCloudStore.get(scopedPath('student-1', 'pu'))).toMatchObject({
    schoolId: 'pu',
    courseIds: ['c1'],
    offeringIds: ['私人成績｜老師未填'],
    shareWithFriends: true,
  });
  // Legacy must remain untouched (no overwrite of the global document).
  expect(mockCloudStore.get(legacyPath('student-1'))).toMatchObject({ schoolId: 'pu' });
  expect(mockCloudStore.get(legacyPath('student-1'))).not.toHaveProperty('courseIds');

  mockCloudStore.clear();
  await createCourseAppeal(
    {
      schoolId: 'ntu',
      studentUid: 'student-2',
      courseId: 'local-1',
      courseName: '本機課',
      offeringId: '本機課｜老師未填',
      title: 't',
      body: 'b',
    },
    'appeal-2',
    [{ id: 'local-1', name: '本機課', teacher: '', room: '', day: 1, start: 1, end: 1, color: 'blue' }],
  );
  expect(mockCloudStore.get(scopedPath('student-2', 'ntu'))).toMatchObject({
    schoolId: 'ntu',
    courseIds: ['local-1'],
    offeringIds: ['本機課｜老師未填'],
  });
  expect(mockCloudStore.has(legacyPath('student-2'))).toBe(false);
});

test('appeal migration preserves a private legacy timetable even with caller courses', async () => {
  const legacy = make('tw-pu', { shareWithFriends: false });
  mockCloudStore.set(legacyPath('student-1'), legacy as unknown as Record<string, unknown>);
  await createCourseAppeal({
    schoolId: 'pu', studentUid: 'student-1', courseId: 'c1',
    courseName: '私人成績', offeringId: '私人成績｜老師未填', title: 't', body: 'b',
  }, 'private-appeal', legacy.courses);
  expect(mockCloudStore.get(scopedPath('student-1', 'pu'))).toMatchObject({
    schoolId: 'pu', shareWithFriends: false, meta: legacy.meta,
  });
  expect(await loadFriendTimetable('student-1', 'pu')).toBeNull();
  expect(mockCloudStore.get(legacyPath('student-1'))).toEqual(legacy);
});

test('appeal index does not enable sharing for new local-only courses', async () => {
  await createCourseAppeal({
    schoolId: 'ntu', studentUid: 'student-1', courseId: 'c1',
    courseName: '私人成績', offeringId: '私人成績｜老師未填', title: 't', body: 'b',
  }, 'local-appeal', make('ntu').courses);
  expect(mockCloudStore.get(scopedPath('student-1', 'ntu'))?.shareWithFriends).toBe(false);
});

test('additive class exceptions survive old writers and cloud round trips, with source intact', async () => {
  const timetable = make('pu');
  const original = manualClassRecords(timetable)[0];
  const value = { id: 'stop', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02',
    kind: 'cancel' as const, createdAt: '2026-11-01T00:00:00Z' };
  await savePersonalTimetable('synthetic-account', { ...timetable, classExceptions: [value] });
  await savePersonalTimetable('synthetic-account', { ...timetable, courses: [] });
  expect((await loadPersonalTimetable('synthetic-account', 'pu')).classExceptions).toEqual(classExceptionsForStorage([value]));
  expect(mockCloudStore.get(exceptionsPath('synthetic-account'))?.classExceptions).toEqual(classExceptionsForStorage([value]));
  await savePersonalTimetable('synthetic-account', { ...await loadPersonalTimetable('synthetic-account', 'pu'), classExceptions: [] });
  expect((await loadPersonalTimetable('synthetic-account', 'pu')).classExceptions).toEqual([]);
});

test('online reload uses cloud arrangements and preserves an offline draft separately', async () => {
  const timetable = make('pu');
  const original = manualClassRecords(timetable)[0];
  const value = { id: 'offline-stop', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02', kind: 'cancel' as const, createdAt: '2026-11-01T00:00:00Z' };
  mockCloudStore.set(scopedPath('synthetic-account', 'pu'), timetable as unknown as Record<string, unknown>);
  jest.mocked(runTransaction).mockRejectedValueOnce(new Error('offline'));
  expect(await savePersonalTimetable('synthetic-account', { ...timetable, classExceptions: [value] })).toEqual({ stored: 'local', cloudPending: true });
  expect((await loadPersonalTimetable('synthetic-account', 'pu')).classExceptions).toBeUndefined();
  expect(JSON.parse((await AsyncStorage.getItem('campus-one-personal-timetable:synthetic-account:pu:draft'))!).classExceptions).toEqual(classExceptionsForStorage([value]));
});


test('a new device omitting exceptions preserves the current cloud arrangements', async () => {
  const timetable = make('pu');
  const original = manualClassRecords(timetable)[0];
  const value = { id: 'stop', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02', kind: 'cancel' as const, createdAt: '' };
  await savePersonalTimetable('synthetic-account', { ...timetable, classExceptions: [value] });
  await AsyncStorage.clear();
  expect(await savePersonalTimetable('synthetic-account', { ...timetable, shareWithFriends: true })).toMatchObject({ stored: 'cloud' });
  expect(mockCloudStore.get(exceptionsPath('synthetic-account'))?.classExceptions).toEqual(classExceptionsForStorage([value]));
});

test('stale explicit exception edits cannot overwrite another device and sources stay private', async () => {
  const timetable = make('pu');
  const original = { ...manualClassRecords(timetable)[0], source: { type: 'file' as const, name: '假學號_假姓名.csv', line: 3, rawText: '假個資'.repeat(30000) } };
  const value = { id: 'stop', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02', kind: 'cancel' as const, createdAt: '' };
  await savePersonalTimetable('synthetic-account', { ...timetable, classExceptions: [value] });
  const before = JSON.stringify(mockCloudStore.get(scopedPath('synthetic-account', 'pu')));
  expect(before).not.toContain('假個資');
  expect(before).not.toContain('假學號');
  await expect(savePersonalTimetable('synthetic-account', { ...timetable, classExceptions: [] })).rejects.toThrow('其他裝置');
  expect(JSON.stringify(mockCloudStore.get(scopedPath('synthetic-account', 'pu')))).toBe(before);
});

test('oversized adjustments fail before writing local or cloud data', async () => {
  const timetable = make('pu');
  const original = manualClassRecords(timetable)[0];
  const value = { id: 'large', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02', kind: 'room' as const, location: '長'.repeat(100000), createdAt: '' };
  await expect(savePersonalTimetable('synthetic-account', { ...timetable, classExceptions: [value] })).rejects.toThrow('資料過大');
  expect(mockCloudStore.size).toBe(0);
  expect(await AsyncStorage.getItem('campus-one-personal-timetable:synthetic-account:pu')).toBeNull();
});


test('successive edits use the returned revision and retain the newest arrangements', async () => {
  const timetable = make('pu');
  const original = manualClassRecords(timetable)[0];
  const value = { id: 'first', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02', kind: 'cancel' as const, createdAt: '' };
  const first = await savePersonalTimetable('synthetic-account', { ...timetable, classExceptions: [value] });
  if (first.stored !== 'cloud') throw new Error('expected cloud');
  const second = await savePersonalTimetable('synthetic-account', { ...first.timetable, classExceptions: [{ ...value, id: 'second', originalDate: '2026-11-09' }] });
  expect(second.stored).toBe('cloud');
  expect(mockCloudStore.get(exceptionsPath('synthetic-account'))).toMatchObject({ classExceptionsRevision: 2, classExceptions: [expect.objectContaining({ id: 'second' })] });
});


test('offline stale revision and a clock ahead recover on reload without losing the draft', async () => {
  const first = await savePersonalTimetable('synthetic-account', { ...make('pu'), classExceptions: [] });
  if (first.stored !== 'cloud') throw new Error('expected cloud');
  mockCloudStore.set(exceptionsPath('synthetic-account'), { schoolId: 'pu', classExceptions: [], classExceptionsRevision: 2 });
  jest.mocked(runTransaction).mockRejectedValueOnce(new Error('offline'));
  await savePersonalTimetable('synthetic-account', { ...first.timetable, updatedAt: '2099-01-01' });
  const localKey = 'campus-one-personal-timetable:synthetic-account:pu';
  const local = JSON.parse((await AsyncStorage.getItem(localKey))!);
  await AsyncStorage.setItem(localKey, JSON.stringify({ ...local, updatedAt: '2099-01-01T00:00:00Z' }));
  const latest = await loadPersonalTimetable('synthetic-account', 'pu');
  expect((await loadOfflinePersonalTimetable('synthetic-account', 'pu'))?.classExceptionsRevision).toBe(2);
  expect(latest.classExceptionsRevision).toBe(2);
  expect(await AsyncStorage.getItem('campus-one-personal-timetable:synthetic-account:pu:draft')).not.toBeNull();
  expect(await savePersonalTimetable('synthetic-account', latest)).toMatchObject({ stored: 'cloud', timetable: { classExceptionsRevision: 2 } });
});

test('sharing from a stale screen preserves remote exceptions without advancing their revision', async () => {
  const first = await savePersonalTimetable('synthetic-account', { ...make('pu'), classExceptions: [] });
  if (first.stored !== 'cloud') throw new Error('expected cloud');
  mockCloudStore.set(exceptionsPath('synthetic-account'), { schoolId: 'pu', classExceptions: [], classExceptionsRevision: 2 });
  expect(await savePersonalTimetable('synthetic-account', { ...first.timetable, shareWithFriends: true }))
    .toMatchObject({ stored: 'cloud', timetable: { shareWithFriends: true, classExceptionsRevision: 2 } });
  expect(mockCloudStore.get(scopedPath('synthetic-account', 'pu'))).not.toHaveProperty('classExceptions');
});


test('draft inspection is scoped and explicit save resolves it while ordinary saves retain it', async () => {
  const timetable = make('pu');
  const original = manualClassRecords(timetable)[0];
  const change = { id: 'draft-stop', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02', kind: 'cancel' as const, createdAt: '' };
  const first = await savePersonalTimetable('synthetic-account', { ...timetable, classExceptions: [] });
  if (first.stored !== 'cloud') throw new Error('expected cloud');
  jest.mocked(runTransaction).mockRejectedValueOnce(new Error('offline'));
  await savePersonalTimetable('synthetic-account', { ...first.timetable, classExceptions: [change] }, undefined, true);
  const current = await loadPersonalTimetable('synthetic-account', 'pu');
  expect(current.classExceptions).toEqual([]);
  const draft = await loadPersonalTimetableDraft('synthetic-account', 'pu');
  expect(draft?.classExceptions).toEqual(classExceptionsForStorage([change]));
  expect(await loadPersonalTimetableDraft('other', 'pu')).toBeNull();
  expect(await loadPersonalTimetableDraft('synthetic-account', 'ntu')).toBeNull();
  await savePersonalTimetable('synthetic-account', { ...current, shareWithFriends: true }, undefined, false);
  expect(await loadPersonalTimetableDraft('synthetic-account', 'pu')).not.toBeNull();
  jest.mocked(runTransaction).mockRejectedValueOnce(new Error('offline'));
  await savePersonalTimetable('synthetic-account', { ...current, shareWithFriends: false }, undefined, false);
  expect((await loadPersonalTimetableDraft('synthetic-account', 'pu'))?.classExceptions).toEqual(classExceptionsForStorage([change]));
  await savePersonalTimetable('synthetic-account', { ...current, classExceptions: draft!.classExceptions }, undefined, true);
  expect(await loadPersonalTimetableDraft('synthetic-account', 'pu')).toBeNull();
});

test('saving a different school never copies legacy exceptions across schools', async () => {
  mockCloudStore.set(legacyPath('synthetic-account'), { ...make('ntu'), classExceptions: [], classExceptionsRevision: 7 });
  await savePersonalTimetable('synthetic-account', make('pu'), undefined, false);
  expect(mockCloudStore.get(exceptionsPath('synthetic-account'))).toMatchObject({ classExceptions: [], classExceptionsRevision: 0 });
  expect(mockCloudStore.get(legacyPath('synthetic-account'))).toHaveProperty('classExceptionsRevision', 7);
});


test('ordinary save separates historical embedded sources with a new revision and preserves the arrangement', async () => {
  const timetable = make('pu');
  const original = { ...manualClassRecords(timetable)[0], source: { type: 'file' as const, line: 1, rawText: '合成私密來源', name: '合成檔名.csv' } };
  const value = { id: 'historical-stop', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02', kind: 'cancel' as const, createdAt: '' };
  mockCloudStore.set(scopedPath('synthetic-account', 'pu'), { ...timetable, classExceptions: [value], classExceptionsRevision: 4 });
  const saved = await savePersonalTimetable('synthetic-account', timetable, undefined, false);
  expect(saved).toMatchObject({ stored: 'cloud', timetable: { classExceptionsRevision: 5, classExceptions: classExceptionsForStorage([value]) } });
  expect(mockCloudStore.get(scopedPath('synthetic-account', 'pu'))).not.toHaveProperty('classExceptions');
  expect(JSON.stringify(mockCloudStore.get(exceptionsPath('synthetic-account')))).not.toContain('合成私密來源');
});


test('reloading a remote cancellation replaces a later offline room draft in actual occurrences', async () => {
  const timetable = make('pu');
  const original = manualClassRecords(timetable)[0];
  const stop = { id: 'remote-stop', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02', kind: 'cancel' as const, createdAt: '' };
  const first = await savePersonalTimetable('synthetic-account', { ...timetable, classExceptions: [] });
  if (first.stored !== 'cloud') throw new Error('expected cloud');
  mockCloudStore.set(exceptionsPath('synthetic-account'), { schoolId: 'pu', classExceptions: classExceptionsForStorage([stop]), classExceptionsRevision: 2 });
  jest.mocked(runTransaction).mockRejectedValueOnce(new Error('offline'));
  await savePersonalTimetable('synthetic-account', { ...first.timetable, classExceptions: [{ ...stop, id: 'offline-room', kind: 'room', location: '合成教室' }] }, undefined, true);
  const loaded = await loadPersonalTimetable('synthetic-account', 'pu');
  expect(buildPersonalToday(personalTimetableRecords(loaded), { schoolId: 'pu', now: new Date('2026-11-02T08:00:00+08:00') }).today).toEqual([]);
  expect((await loadPersonalTimetableDraft('synthetic-account', 'pu'))?.classExceptions?.[0]?.kind).toBe('room');
  await savePersonalTimetable('synthetic-account', { ...loaded, shareWithFriends: true }, undefined, false);
  expect((await loadPersonalTimetable('synthetic-account', 'pu')).classExceptionsRevision).toBe(2);
});
