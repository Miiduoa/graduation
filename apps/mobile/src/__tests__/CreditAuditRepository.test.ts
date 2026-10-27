import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDocs, setDoc, writeBatch } from 'firebase/firestore';
import {
  getCreditAuditStorageKey,
  getCreditChecklistStorageKey,
  loadCreditChecklistStatus,
  saveCreditChecklistStatus,
  loadCreditAuditSavedCourses,
  listStoredEnrollments,
  upsertCreditAuditEnrollment,
  syncCreditAuditCoursesToCloud,
} from '../features/academics/repository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('../firebase', () => ({ getDb: () => ({}) }));
jest.mock('../data/firestorePath', () => ({
  collectionFromSegments: (_db: unknown, names: string[]) => names.join('/'),
  docFromSegments: (_db: unknown, names: string[]) => names.join('/'),
}));
jest.mock('firebase/firestore', () => ({
  deleteDoc: jest.fn(),
  getDocs: jest.fn(),
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  writeBatch: jest.fn(),
}));

const getItemMock = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const getDocsMock = getDocs as jest.MockedFunction<typeof getDocs>;

beforeEach(() => {
  jest.clearAllMocks();
  getItemMock.mockResolvedValue(null);
});

test('does not migrate a global legacy credit list into a different campus or account', async () => {
  const one = getCreditAuditStorageKey('student-a', 'pu');
  const another = getCreditAuditStorageKey('student-b', 'pu');
  const otherSchool = getCreditAuditStorageKey('student-a', 'nchu');
  expect(one).not.toBe(another);
  expect(one).not.toBe(otherSchool);
  expect(await loadCreditAuditSavedCourses(one)).toEqual([]);
  expect(getItemMock).toHaveBeenCalledTimes(1);
  expect(getItemMock).toHaveBeenCalledWith(one);
  expect(getItemMock).not.toHaveBeenCalledWith('@credit_audit_courses');
});

test('reads only a well-formed scoped draft and refuses malformed payloads rather than overwriting them', async () => {
  const storageKey = getCreditAuditStorageKey('student-a', 'pu');
  const rows = [{
    id: 'course-a', name: '統計學', credits: 2.5, category: 'required', passed: true,
    createdAt: '2026-10-27', syncedToCloud: false,
  }];
  getItemMock.mockResolvedValueOnce(JSON.stringify(rows));
  expect(await loadCreditAuditSavedCourses(storageKey)).toEqual(rows);
  getItemMock.mockResolvedValueOnce('{bad');
  await expect(loadCreditAuditSavedCourses(storageKey)).rejects.toThrow();
  getItemMock.mockResolvedValueOnce(JSON.stringify([{ ...rows[0], credits: '2.5' }]));
  await expect(loadCreditAuditSavedCourses(storageKey)).rejects.toThrow(/內容/);
});

test('reference checklist only reads its scoped storage and rejects corrupt states', async () => {
  const key = getCreditChecklistStorageKey('student-a', 'pu', 'pu-csie-115');
  expect(key).not.toBe(getCreditChecklistStorageKey('student-b', 'pu', 'pu-csie-115'));
  expect(key).not.toBe(getCreditChecklistStorageKey('student-a', 'nchu', 'pu-csie-115'));
  expect(key).not.toBe(getCreditChecklistStorageKey('student-a', 'pu', 'another-template'));
  getItemMock.mockResolvedValueOnce(JSON.stringify({ english_proficiency: true }));
  expect(await loadCreditChecklistStatus(key)).toEqual({ english_proficiency: true });
  getItemMock.mockResolvedValueOnce(JSON.stringify({ english_proficiency: 'yes' }));
  await expect(loadCreditChecklistStatus(key)).rejects.toThrow(/驗證/);
  await saveCreditChecklistStatus(key, { english_proficiency: false });
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(key, JSON.stringify({ english_proficiency: false }));
});

test('legacy enrollment lookup includes only rows explicitly scoped to current campus', async () => {
  getDocsMock
    .mockResolvedValueOnce({ empty: true, docs: [] } as never)
    .mockResolvedValueOnce({
      docs: [
        { id: 'correct', data: () => ({ schoolId: 'pu', courseName: '本人課程', credits: 3, category: 'required', passed: true, status: 'completed', courseId: 'c1' }) },
        { id: 'other-school', data: () => ({ schoolId: 'nchu', courseName: '其他校', credits: 2, category: 'elective', passed: true, status: 'completed', courseId: 'c2' }) },
        { id: 'unknown-school', data: () => ({ courseName: '無學校來源', credits: 3, category: 'general', passed: true, status: 'completed', courseId: 'c3' }) },
      ],
    } as never);
  const rows = await listStoredEnrollments('student-a', 'pu');
  expect(rows.map((row) => row.id)).toEqual(['correct']);
});

test('cloud enrollments distinguish self-reported passed courses from pending credit', async () => {
  await upsertCreditAuditEnrollment({
    uid: 'student-a', schoolId: 'pu',
    course: { id: 'pending', name: '待確認', credits: 2.5, category: 'elective', passed: false },
  });
  expect(jest.mocked(setDoc)).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ passed: false, status: 'in_progress', source: 'credit-audit-input' }),
  );
  await upsertCreditAuditEnrollment({
    uid: 'student-a', schoolId: 'pu',
    course: { id: 'passed', name: '已確認', credits: 3, category: 'required', passed: true },
  });
  expect(jest.mocked(setDoc)).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ passed: true, status: 'completed', source: 'credit-audit-input' }),
  );

  const set = jest.fn();
  const commit = jest.fn().mockResolvedValue(undefined);
  jest.mocked(writeBatch).mockReturnValue({ set, commit } as never);
  await syncCreditAuditCoursesToCloud({
    uid: 'student-a', schoolId: 'pu',
    courses: [
      { id: 'pending', name: '待確認', credits: 2.5, category: 'elective', passed: false, createdAt: '2026-10-27', syncedToCloud: false },
      { id: 'passed', name: '已確認', credits: 3, category: 'required', passed: true, createdAt: '2026-10-27', syncedToCloud: false },
    ],
  });
  expect(set).toHaveBeenCalledTimes(2);
  expect(set.mock.calls[0][1]).toMatchObject({ passed: false, status: 'in_progress' });
  expect(set.mock.calls[1][1]).toMatchObject({ passed: true, status: 'completed' });
  expect(commit).toHaveBeenCalledTimes(1);
});
