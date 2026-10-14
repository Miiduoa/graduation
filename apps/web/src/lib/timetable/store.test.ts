import { beforeEach, expect, it, vi } from 'vitest';
import type { PersonalCourse } from '@campus/shared';

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  setDoc: vi.fn(),
}));
const auth = vi.hoisted(() => ({ currentUser: { uid: 'u-1' } as { uid: string } | null }));
const firebase = vi.hoisted(() => ({ configured: true }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(() => ({})),
  getDoc: firestore.getDoc,
  getDocs: vi.fn(),
  query: vi.fn(),
  serverTimestamp: () => 'server-time',
  setDoc: firestore.setDoc,
  updateDoc: vi.fn(),
  where: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => auth,
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  isFirebaseConfigured: () => firebase.configured,
}));

import {
  TIMETABLE_DEVICE_ONLY_STORED_COPY,
  TIMETABLE_DEVICE_ONLY_SUBMIT_COPY,
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
  firebase.configured = true;
});

it('keeps imported timetables on this device and does not send them to the cloud', async () => {
  const timetable = {
    courses: [course],
    meta: {} as never,
    shareWithFriends: true,
    updatedAt: new Date().toISOString(),
    schoolId: 'pu',
  };
  await expect(savePersonalTimetable('u-1', timetable)).resolves.toEqual({ stored: 'local' });
  expect(firestore.setDoc).not.toHaveBeenCalled();
  expect(TIMETABLE_DEVICE_ONLY_SUBMIT_COPY).toBe('存在這台裝置');
  expect(TIMETABLE_DEVICE_ONLY_STORED_COPY).toBe('已存在這台裝置，換手機或清除瀏覽器資料就會不見');
  expect(TIMETABLE_DEVICE_ONLY_STORED_COPY).not.toMatch(/已儲存|已同步/);
  firestore.getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({ courses: [], updatedAt: { toMillis: () => Date.now() - 60_000 } }),
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
      updatedAt: { toMillis: () => Date.parse('2026-10-11T00:00:00.000Z') },
    }),
  });
  const loaded = await loadPersonalTimetable('u-1', 'pu');
  expect(loaded.courses.map((item) => item.name)).toEqual(['作業系統']);
});

it.each(['campus-one-personal-timetable:u-1', 'campus-one-personal-timetable:u-1:pu'])(
  'recovers the same school-account legacy key %s without migrating or deleting it',
  async (key) => {
    const raw = JSON.stringify({
      courses: [course],
      updatedAt: '2026-10-01T00:00:00.000Z',
      schoolId: 'pu',
    });
    localStorage.setItem(key, raw);
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    const loaded = await loadPersonalTimetable('u-1', 'pu', 'school:u-1');
    expect(loaded.courses.map((item) => item.name)).toEqual(['資料庫']);
    expect(localStorage.getItem(key)).toBe(raw);
    expect(localStorage.getItem('campus-one-personal-timetable:school:u-1:pu')).toBeNull();
  },
);

it('recovers the same school-account legacy copy when Firebase is unavailable', async () => {
  firebase.configured = false;
  localStorage.setItem(
    'campus-one-personal-timetable:u-1',
    JSON.stringify({ courses: [course], schoolId: 'pu' }),
  );
  const loaded = await loadPersonalTimetable('u-1', 'pu', 'school:u-1');
  expect(loaded.courses.map((item) => item.name)).toEqual(['資料庫']);
  expect(firestore.getDoc).not.toHaveBeenCalled();
});

it('does not resurrect a legacy copy after an empty timetable is saved in the new namespace', async () => {
  localStorage.setItem(
    'campus-one-personal-timetable:u-1',
    JSON.stringify({ courses: [course], schoolId: 'pu' }),
  );
  firestore.getDoc.mockResolvedValue({ exists: () => false });
  await savePersonalTimetable(
    'u-1',
    {
      courses: [],
      meta: {} as never,
      shareWithFriends: true,
      updatedAt: '',
      schoolId: 'pu',
    },
    'school:u-1',
  );
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
  expect(JSON.parse(localStorage.getItem('campus-one-personal-timetable:u-1')!).courses).toEqual([
    course,
  ]);
});

it.each(['platform:account-a', 'nuni:account-a', 'school:u-2', 'guest'])(
  'never exposes a school-account legacy copy through the different owner %s',
  async (owner) => {
    localStorage.setItem(
      'campus-one-personal-timetable:u-1',
      JSON.stringify({ courses: [course], schoolId: 'pu' }),
    );
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    expect((await loadPersonalTimetable('u-1', 'pu', owner)).courses).toEqual([]);
  },
);

it('keeps school and uid boundaries when falling back to legacy storage', async () => {
  localStorage.setItem(
    'campus-one-personal-timetable:u-1',
    JSON.stringify({ courses: [course], schoolId: 'other' }),
  );
  firestore.getDoc.mockResolvedValue({ exists: () => false });
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
  expect((await loadPersonalTimetable('u-2', 'other', 'school:u-2')).courses).toEqual([]);
  expect((await loadPersonalTimetable(null, 'other', 'school:u-1')).courses).toEqual([]);
});


it.each([
  ['invalid JSON', '{broken'],
  ['non-array course list', JSON.stringify({ schoolId: 'pu', courses: 'missing-list', meta: {} })],
  ['oversized course list', JSON.stringify({ schoolId: 'pu', courses: Array.from({ length: 81 }, () => course), meta: {} })],
  ['foreign scoped school', JSON.stringify({ schoolId: 'ntu', courses: [course], meta: {} })],
])('preserves %s from a damaged scoped copy instead of treating it as empty', async (_label, raw) => {
  const key = 'campus-one-personal-timetable:school:u-1:pu';
  localStorage.setItem(key, raw);
  await expect(loadPersonalTimetable('u-1', 'pu', 'school:u-1')).rejects.toThrow();
  await expect(savePersonalTimetable('u-1', {
    courses: [course], meta: {} as never, shareWithFriends: true,
    updatedAt: new Date().toISOString(), schoolId: 'pu',
  }, 'school:u-1')).rejects.toThrow();
  expect(localStorage.getItem(key)).toBe(raw);
  expect(firestore.setDoc).not.toHaveBeenCalled();
});

it('retains a mismatched unscoped legacy school without exposing it', async () => {
  const legacyKey = 'campus-one-personal-timetable:u-1';
  const raw = JSON.stringify({ schoolId: 'ntu', courses: [course] });
  localStorage.setItem(legacyKey, raw);
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
  expect(localStorage.getItem(legacyKey)).toBe(raw);
});
