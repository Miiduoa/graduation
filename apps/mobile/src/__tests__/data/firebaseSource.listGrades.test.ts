import { getDocs } from 'firebase/firestore';
import { asFirebaseCourseGrades, firebaseSource } from '../../data/firebaseSource';
import { filterScopedGrades } from '../../screens/creditAudit/gradeScope';
import type { Grade } from '../../data/types';
import { mapPuOfficialGrades } from '../../data/apiAdapters/PUAdapter';

jest.mock('../../firebase', () => ({
  getDb: () => 'db',
  getAuthInstance: jest.fn(),
  getFunctionsInstance: jest.fn(),
}));
jest.mock('../../data/firestorePath', () => ({
  docFromSegments: (_db: unknown, segments: string[]) => ({ path: segments.join('/') }),
  collectionFromSegments: (_db: unknown, segments: string[]) => ({
    path: segments.join('/'),
  }),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((...args: unknown[]) => ({ path: args.slice(1).join('/') })),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  collection: jest.fn((...args: unknown[]) => ({ path: args.slice(1).join('/') })),
  query: jest.fn((ref: { path?: string }) => ({ path: ref?.path ?? 'query' })),
  where: jest.fn((...args: unknown[]) => ({ where: args })),
  orderBy: jest.fn((...args: unknown[]) => ({ orderBy: args })),
  limit: jest.fn((...args: unknown[]) => ({ limit: args })),
  addDoc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  serverTimestamp: jest.fn(),
  Timestamp: class Timestamp {},
  writeBatch: jest.fn(),
  runTransaction: jest.fn(),
  increment: jest.fn(),
  arrayUnion: jest.fn(),
  arrayRemove: jest.fn(),
}));
jest.mock('../../data/lostFoundSource', () => ({ lostFoundSource: {} }));
jest.mock('../../data/orderSource', () => ({ createOrderThroughServer: jest.fn() }));

function docsSnap(
  rows: Array<{ id: string; data: Record<string, unknown> }>,
): { docs: Array<{ id: string; data: () => Record<string, unknown> }>; size: number } {
  return {
    size: rows.length,
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

beforeEach(() => {
  jest.mocked(getDocs).mockReset();
});

test('asFirebaseCourseGrades strips forged school-official flags', () => {
  const forged = asFirebaseCourseGrades([
    {
      id: 'g1',
      userId: 'u1',
      courseId: 'c1',
      courseName: '偽校務',
      credits: 2,
      semester: '1131',
      schoolId: 'tw-pu',
      gradeSource: 'school-official',
      publishedAt: '2999-01-01T00:00:00Z',
    },
  ]);
  expect(forged[0].gradeSource).toBe('firebase-course');
});

test('firebaseSource.listGrades classifies Firestore rows as firebase-course', async () => {
  jest.mocked(getDocs).mockResolvedValue(
    docsSnap([
      {
        id: 'forged',
        data: {
          userId: 'user-a',
          courseId: 'c-forged',
          courseName: '偽造校務旗標課',
          credits: 3,
          semester: '1131',
          schoolId: 'tw-pu',
          gradeSource: 'school-official',
          publishedAt: '2999-06-01T00:00:00Z',
        },
      },
      {
        id: 'published',
        data: {
          userId: 'user-a',
          courseId: 'c-ok',
          courseName: '已發布 Firebase 課',
          credits: 2,
          semester: '1131',
          schoolId: 'tw-pu',
          gradeSource: 'school-official-offline',
          publishedAt: '2020-01-01T00:00:00Z',
        },
      },
    ]) as never,
  );

  const rows = await firebaseSource.listGrades('user-a', undefined, 'tw-pu');
  expect(rows).toHaveLength(2);
  expect(rows.every((g) => g.gradeSource === 'firebase-course')).toBe(true);

  const now = Date.parse('2024-06-01T00:00:00Z');
  const accepted = filterScopedGrades(rows, 'user-a', 'tw-pu', now);
  expect(accepted.map((g) => g.courseName)).toEqual(['已發布 Firebase 課']);
  expect(accepted.some((g) => g.courseName === '偽造校務旗標課')).toBe(false);
});

test('forged school-official Firebase row without publishedAt is filtered', async () => {
  jest.mocked(getDocs).mockResolvedValue(
    docsSnap([
      {
        id: 'no-pub',
        data: {
          userId: 'user-a',
          courseId: 'c1',
          courseName: '未發布偽校務',
          credits: 1,
          semester: '1131',
          schoolId: 'tw-pu',
          gradeSource: 'school-official',
        },
      },
    ]) as never,
  );

  const rows = await firebaseSource.listGrades('user-a', undefined, 'tw-pu');
  expect(rows[0].gradeSource).toBe('firebase-course');
  expect(filterScopedGrades(rows, 'user-a', 'tw-pu')).toEqual([]);
});

test('valid published Firebase and fresh school-adapter rows still accepted together', () => {
  const firebaseRows: Grade[] = asFirebaseCourseGrades([
    {
      id: 'fb',
      userId: 'user-a',
      courseId: 'fb1',
      courseName: 'Firebase 已發布',
      credits: 2,
      semester: '1131',
      schoolId: 'tw-pu',
      gradeSource: 'school-official',
      publishedAt: '2020-01-01T00:00:00Z',
    },
  ]);
  const schoolRows = mapPuOfficialGrades(
    [{ semester: '1131', courseName: '校務即時課', credits: 3, score: 90 }],
    { studentId: 'user-a', schoolId: 'tw-pu', gradeSource: 'school-official' },
  );

  const accepted = filterScopedGrades([...firebaseRows, ...schoolRows], 'user-a', 'tw-pu');
  expect(accepted.map((g) => g.courseName).sort()).toEqual(['Firebase 已發布', '校務即時課'].sort());
});

 test.each([undefined, null, NaN, Infinity])('GPA excludes unavailable points: %s', async (gradePoints) => {
  jest.mocked(getDocs).mockResolvedValue(docsSnap([
    { id: 'known', data: { userId: 'u', credits: 3, gradePoints: 3 } },
    { id: 'unknown', data: { userId: 'u', credits: 3, gradePoints } },
  ]) as never);
  expect(await firebaseSource.getGPA('u', 'pu')).toEqual({ gpa: 3, totalCredits: 3, totalPoints: 9 });
});
test.each([[[]], [[{ id: 'unknown', data: { credits: 3 } }]], [[{ id: 'zero', data: { credits: 0, gradePoints: 3 } }]]])('GPA is unknown without usable credits', async (...args) => {
  jest.mocked(getDocs).mockResolvedValue(docsSnap(args[0] as never) as never);
  expect(await firebaseSource.getGPA('u', 'pu')).toBeNull();
});
