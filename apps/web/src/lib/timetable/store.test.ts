import { beforeEach, expect, it, vi } from 'vitest';
import type { PersonalCourse } from '@campus/shared';

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  setDoc: vi.fn(),
}));
const auth = vi.hoisted(() => ({ currentUser: { uid: 'u-1' } as { uid: string } | null }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(() => ({})),
  getDoc: firestore.getDoc,
  getDocFromServer: firestore.getDoc,
  getDocs: vi.fn(),
  query: vi.fn(),
  serverTimestamp: () => 'server-time',
  setDoc: firestore.setDoc,
  runTransaction: vi.fn(async (_db, work) => {
    let commit: unknown;
    await work({
      get: async () => ({ exists: () => false }),
      set: (...args: unknown[]) => { commit = firestore.setDoc(...args); },
    });
    await commit;
  }),
  updateDoc: vi.fn(),
  where: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => auth,
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  isFirebaseConfigured: () => true,
}));

import {
  TimetableCloudSaveError,
  loadPersonalTimetable,
  savePersonalTimetable,
} from './store';

const course: PersonalCourse = {
  id: 'c-1',
  name: '資料庫',
  day: 1,
  start: 2,
  end: 3,
  teacher: '',
  room: '',
  color: 'blue',
};

beforeEach(() => {
  localStorage.clear();
  firestore.getDoc.mockReset();
  firestore.setDoc.mockReset();
  auth.currentUser = { uid: 'u-1' };
});

it('keeps the browser copy when the cloud save fails, so a refresh shows the same timetable', async () => {
  firestore.setDoc.mockRejectedValue(new Error('offline'));
  const timetable = {
    courses: [course],
    meta: {} as never,
    shareWithFriends: true,
    updatedAt: new Date().toISOString(),
    schoolId: 'pu',
  };
  await expect(savePersonalTimetable('u-1', timetable)).rejects.toBeInstanceOf(
    TimetableCloudSaveError,
  );
  firestore.getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({ courses: [], schoolId: 'pu', updatedAt: { toMillis: () => Date.now() - 60_000 } }),
  });
  const loaded = await loadPersonalTimetable('u-1', 'pu');
  expect(loaded.courses.map((item) => item.name)).toEqual(['資料庫']);
});

it('stores only in the browser without a school account and reads it back after a refresh', async () => {
  auth.currentUser = null;
  const saved = await savePersonalTimetable(null, {
    courses: [course],
    meta: {} as never,
    shareWithFriends: true,
    updatedAt: new Date().toISOString(),
    schoolId: 'pu',
  });
  expect(saved.stored).toBe('local');
  expect(firestore.setDoc).not.toHaveBeenCalled();
  const loaded = await loadPersonalTimetable(null, 'pu');
  expect(loaded.courses.map((item) => item.name)).toEqual(['資料庫']);
});

it('carries the signed-out browser timetable over after the school login when the cloud has none', async () => {
  auth.currentUser = null;
  await savePersonalTimetable(null, {
    courses: [course],
    meta: {} as never,
    shareWithFriends: true,
    updatedAt: new Date().toISOString(),
    schoolId: 'pu',
  });
  firestore.getDoc.mockResolvedValue({ exists: () => false });
  const loaded = await loadPersonalTimetable('u-1', 'pu');
  expect(loaded.courses.map((item) => item.name)).toEqual(['資料庫']);
});

it('prefers a newer cloud copy over an older browser copy', async () => {
  localStorage.setItem(
    'campus-one-personal-timetable:u-1',
    JSON.stringify({ courses: [course], updatedAt: '2026-10-01T00:00:00.000Z', schoolId: 'pu' }),
  );
  firestore.getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({
      courses: [{ ...course, id: 'c-2', name: '作業系統' }],
      schoolId: 'pu',
      updatedAt: { toMillis: () => Date.parse('2026-10-11T00:00:00.000Z') },
    }),
  });
  const loaded = await loadPersonalTimetable('u-1', 'pu');
  expect(loaded.courses.map((item) => item.name)).toEqual(['作業系統']);
});
