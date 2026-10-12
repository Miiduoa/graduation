import { beforeEach, expect, it, vi } from 'vitest';
import {
  acknowledgeTimetableCache,
  preferLocalTimetable,
  readTimetableCache,
  timetableCacheKey,
  TimetableLocalReadError,
  writeTimetableCache,
  type TimetableCache,
} from './localCache';

const value = { schoolId: 'pu', courses: [], updatedAt: '2026-10-12T00:00:00.000Z' };
const copy: TimetableCache = { version: 2, revision: 'r1', pending: true, value };
beforeEach(() => localStorage.clear());

it('separates accounts, guests and campuses without delimiter collisions', () => {
  const keys = [timetableCacheKey(null, 'pu'), timetableCacheKey('local', 'pu'),
    timetableCacheKey('a:b', 'c'), timetableCacheKey('a', 'b:c'), timetableCacheKey('a', 'pu')];
  expect(new Set(keys).size).toBe(keys.length);
});

it('keeps different campuses independently', () => {
  writeTimetableCache(localStorage, 'u', copy);
  writeTimetableCache(localStorage, 'u', { ...copy, value: { ...value, schoolId: 'nchu' } });
  expect(readTimetableCache(localStorage, 'u', 'pu')?.value.schoolId).toBe('pu');
  expect(readTimetableCache(localStorage, 'u', 'nchu')?.value.schoolId).toBe('nchu');
  expect(readTimetableCache(localStorage, 'other', 'pu')).toBeNull();
});

it('reads only a matching legacy campus and leaves the original untouched', () => {
  const raw = JSON.stringify(value);
  localStorage.setItem('campus-one-personal-timetable:u', raw);
  expect(readTimetableCache(localStorage, 'u', 'pu')?.value).toEqual(value);
  expect(readTimetableCache(localStorage, 'u', 'nchu')).toBeNull();
  expect(localStorage.getItem('campus-one-personal-timetable:u')).toBe(raw);
});

it('does not let an account named local claim legacy guest data', () => {
  localStorage.setItem('campus-one-personal-timetable:local', JSON.stringify(value));
  expect(readTimetableCache(localStorage, 'local', 'pu')).toBeNull();
  expect(readTimetableCache(localStorage, null, 'pu')?.value).toEqual(value);
});

it('preserves invalid JSON instead of treating it as an empty timetable', () => {
  const key = timetableCacheKey('u', 'pu');
  localStorage.setItem(key, '{broken');
  expect(() => readTimetableCache(localStorage, 'u', 'pu')).toThrow(TimetableLocalReadError);
  expect(localStorage.getItem(key)).toBe('{broken');
});

it.each([null, [], {}, { ...copy, pending: 'true' }, { ...copy, version: 3 },
  { ...copy, value: { ...value, schoolId: 'nchu' } },
  { ...copy, value: { ...value, updatedAt: 'not-a-date' } },
  { ...copy, value: { ...value, courses: 'missing' } },
])('rejects an invalid scoped record: %j', (invalid) => {
  localStorage.setItem(timetableCacheKey('u', 'pu'), JSON.stringify(invalid));
  expect(() => readTimetableCache(localStorage, 'u', 'pu')).toThrow(TimetableLocalReadError);
});

it('does not hide a storage access failure', () => {
  const storage = { getItem: () => { throw new Error('blocked'); }, setItem: vi.fn() };
  expect(() => readTimetableCache(storage, 'u', 'pu')).toThrow(TimetableLocalReadError);
});

it('keeps an empty pending revision even when the cloud timestamp is newer', () => {
  expect(preferLocalTimetable(copy, Date.parse('2030-01-01T00:00:00Z'))).toBe(true);
  expect(preferLocalTimetable(null, 0)).toBe(false);
});

it('compares timestamps for a non-pending legacy copy', () => {
  expect(preferLocalTimetable({ ...copy, pending: false }, Date.parse('2026-10-01T00:00:00Z'))).toBe(true);
  expect(preferLocalTimetable({ ...copy, pending: false }, Date.parse('2026-10-13T00:00:00Z'))).toBe(false);
});

it('acknowledges only the revision that actually reached the server', () => {
  writeTimetableCache(localStorage, 'u', { ...copy, revision: 'newer' });
  expect(acknowledgeTimetableCache(localStorage, 'u', 'pu', 'r1')).toBe(false);
  expect(readTimetableCache(localStorage, 'u', 'pu')?.pending).toBe(true);
  expect(acknowledgeTimetableCache(localStorage, 'u', 'pu', 'newer')).toBe(true);
  expect(readTimetableCache(localStorage, 'u', 'pu')?.pending).toBe(false);
});
