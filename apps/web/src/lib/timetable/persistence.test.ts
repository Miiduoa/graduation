import { beforeEach, expect, it, vi } from 'vitest';
import type { PersonalCourse } from '@campus/shared';

const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), transactionGet: vi.fn(), set: vi.fn(), commit: vi.fn(), runTransaction: vi.fn() }));
const auth = vi.hoisted(() => ({ currentUser: { uid: 'u-1' } as { uid: string } | null }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(() => ({})), getDocFromServer: firestore.getDoc,
  runTransaction: firestore.runTransaction, serverTimestamp: () => 'server-time' }));
vi.mock('@/lib/firebase', () => ({ getAuth: () => auth, getDb: () => ({}), isFirebaseConfigured: () => true }));

import { loadPersonalTimetable, savePersonalTimetable, retryPersonalTimetableSync, TimetableCloudSaveError, type StoredTimetable } from './persistence';
import { readTimetableCache, timetableCacheKey, writeTimetableCache } from './localCache';
import { getTimetableSyncStatus } from './syncStatus';

const course: PersonalCourse = { id: 'c1', name: '資料庫', day: 1, start: 2, end: 3, teacher: '', room: '', color: 'blue' };
const timetable = (courses = [course], schoolId = 'pu'): StoredTimetable => ({ courses, schoolId, meta: {} as never, shareWithFriends: true, updatedAt: '2026-10-01T00:00:00.000Z' });
const cloud = (value: unknown) => ({ exists: () => true, data: () => value });
const missing = () => ({ exists: () => false });
const cached = (value: StoredTimetable, pending = false, revision = 'cached') => ({ version: 2 as const, revision, pending, value });

beforeEach(() => {
  localStorage.clear();
  auth.currentUser = { uid: 'u-1' };
  Object.values(firestore).forEach((mock) => mock.mockReset());
  firestore.getDoc.mockResolvedValue(missing());
  firestore.transactionGet.mockResolvedValue(missing());
  firestore.commit.mockResolvedValue(undefined);
  firestore.runTransaction.mockImplementation(async (_db, work) => {
    await work({ get: firestore.transactionGet, set: firestore.set });
    await firestore.commit();
  });
});

it('retains deletion of the final course after a cloud failure and refresh', async () => {
  firestore.commit.mockRejectedValue(new Error('offline'));
  await expect(savePersonalTimetable('u-1', timetable([]))).rejects.toBeInstanceOf(TimetableCloudSaveError);
  firestore.getDoc.mockResolvedValue(cloud({ ...timetable(), updatedAt: '2030-01-01T00:00:00Z' }));
  expect((await loadPersonalTimetable('u-1', 'pu')).courses).toEqual([]);
  expect(getTimetableSyncStatus('u-1', 'pu').kind).toBe('pending');
});

it('caches a newer cloud version for the next offline read', async () => {
  const latest = { ...timetable([{ ...course, name: '作業系統' }]), updatedAt: '2026-10-11T00:00:00Z' };
  writeTimetableCache(localStorage, 'u-1', cached(timetable()));
  firestore.getDoc.mockResolvedValue(cloud(latest));
  expect((await loadPersonalTimetable('u-1', 'pu')).courses[0].name).toBe('作業系統');
  firestore.getDoc.mockRejectedValue(new Error('offline'));
  expect((await loadPersonalTimetable('u-1', 'pu')).courses[0].name).toBe('作業系統');
  expect(getTimetableSyncStatus('u-1', 'pu').kind).toBe('offline');
});

it('does not let a newer guest draft replace an existing account timetable', async () => {
  writeTimetableCache(localStorage, null, cached({ ...timetable(), updatedAt: '2030-01-01T00:00:00Z' }, true));
  firestore.getDoc.mockResolvedValue(cloud(timetable([{ ...course, name: '帳號的課' }])));
  expect((await loadPersonalTimetable('u-1', 'pu')).courses[0].name).toBe('帳號的課');
});

it('does not borrow guest data when an account cloud read fails', async () => {
  writeTimetableCache(localStorage, null, cached(timetable(), true));
  firestore.getDoc.mockRejectedValue(new Error('offline'));
  await expect(loadPersonalTimetable('u-1', 'pu')).rejects.toThrow('offline');
  expect(getTimetableSyncStatus('u-1', 'pu').kind).toBe('error');
});

it('carries over a same-campus guest draft only after confirming the cloud is empty', async () => {
  writeTimetableCache(localStorage, null, cached(timetable(), true));
  expect((await loadPersonalTimetable('u-1', 'pu')).courses[0].name).toBe('資料庫');
  expect(readTimetableCache(localStorage, 'u-1', 'pu')).toBeNull();
  expect(getTimetableSyncStatus('u-1', 'pu').kind).toBe('local');
});

it('does not display another campus cloud timetable', async () => {
  firestore.getDoc.mockResolvedValue(cloud(timetable([course], 'nchu')));
  const loaded = await loadPersonalTimetable('u-1', 'pu');
  expect(loaded.schoolId).toBe('pu');
  expect(loaded.courses).toEqual([]);
  expect(getTimetableSyncStatus('u-1', 'pu').kind).toBe('conflict');
});

it.each(['nchu', undefined])('refuses to overwrite a cloud timetable with school %s', async (schoolId) => {
  firestore.transactionGet.mockResolvedValue(cloud({ ...timetable(), schoolId }));
  await expect(savePersonalTimetable('u-1', timetable())).rejects.toBeInstanceOf(TimetableCloudSaveError);
  expect(firestore.set).not.toHaveBeenCalled();
  expect(readTimetableCache(localStorage, 'u-1', 'pu')?.pending).toBe(true);
  expect(getTimetableSyncStatus('u-1', 'pu').kind).toBe('conflict');
});

it('acknowledges a successful cloud save without leaving the copy pending', async () => {
  expect(await savePersonalTimetable('u-1', timetable())).toEqual({ stored: 'cloud' });
  expect(readTimetableCache(localStorage, 'u-1', 'pu')?.pending).toBe(false);
  expect(getTimetableSyncStatus('u-1', 'pu').kind).toBe('synced');
});

it('does not overwrite a corrupted local record or attempt cloud writes', async () => {
  const key = timetableCacheKey('u-1', 'pu');
  localStorage.setItem(key, '{broken');
  await expect(savePersonalTimetable('u-1', timetable())).rejects.toThrow();
  expect(localStorage.getItem(key)).toBe('{broken');
  expect(firestore.runTransaction).not.toHaveBeenCalled();
});

it('does not report a local save when browser storage rejects the write', async () => {
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  try {
    await expect(savePersonalTimetable('u-1', timetable())).rejects.toThrow('quota');
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(getTimetableSyncStatus('u-1', 'pu').kind).toBe('error');
  } finally { write.mockRestore(); }
});

it('does not overwrite an edit made while a cloud read was pending', async () => {
  let finish!: (value: unknown) => void;
  firestore.getDoc.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const loading = loadPersonalTimetable('u-1', 'pu');
  writeTimetableCache(localStorage, 'u-1', cached(timetable([]), true, 'new-edit'));
  finish(cloud(timetable()));
  expect((await loading).courses).toEqual([]);
  expect(readTimetableCache(localStorage, 'u-1', 'pu')?.revision).toBe('new-edit');
});

it('serializes cloud writes and does not acknowledge a newer edit early', async () => {
  let finish!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  firestore.commit.mockImplementationOnce(() => { started(); return new Promise<void>((resolve) => { finish = resolve; }); });
  const first = savePersonalTimetable('u-1', timetable());
  await firstStarted;
  const second = savePersonalTimetable('u-1', timetable([]));
  expect(readTimetableCache(localStorage, 'u-1', 'pu')?.pending).toBe(true);
  expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, second]);
  expect(firestore.runTransaction).toHaveBeenCalledTimes(2);
  expect(firestore.set.mock.calls.map((call) => call[1].courses.length)).toEqual([1, 0]);
  expect(readTimetableCache(localStorage, 'u-1', 'pu')?.value.courses).toEqual([]);
  expect(readTimetableCache(localStorage, 'u-1', 'pu')?.pending).toBe(false);
});

it('stops a transaction when the account changes before the write', async () => {
  firestore.transactionGet.mockImplementation(async () => { auth.currentUser = { uid: 'other' }; return missing(); });
  await expect(savePersonalTimetable('u-1', timetable())).rejects.toBeInstanceOf(TimetableCloudSaveError);
  expect(firestore.set).not.toHaveBeenCalled();
  expect(readTimetableCache(localStorage, 'other', 'pu')).toBeNull();
});

it('retries the saved empty revision instead of restoring old cloud courses', async () => {
  writeTimetableCache(localStorage, 'u-1', cached(timetable([]), true));
  firestore.transactionGet.mockResolvedValue(cloud(timetable()));
  await retryPersonalTimetableSync('u-1', 'pu');
  expect(firestore.set.mock.calls[0][1].courses).toEqual([]);
  expect(readTimetableCache(localStorage, 'u-1', 'pu')?.pending).toBe(false);
});
