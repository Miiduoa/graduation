import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { getScopedStorageKey } from '../services/scopedStorage';
import {
  ScheduleProvider,
  loadCoursesFromCache,
  useSchedule,
} from '../state/schedule';
import type { Course } from '../data/types';

const mockAuth: {
  user: { uid: string } | null;
  profile: { uid: string; schoolId: string | null } | null;
} = {
  user: { uid: 'user-a' },
  profile: { uid: 'user-a', schoolId: 'pu' },
};

const mockSchool: {
  school: { id: string } | null;
  schoolId: string | null;
} = {
  school: { id: 'pu' },
  schoolId: 'pu',
};

const mockGetCachedCourses = jest.fn();
const mockGetCachedTCCourses = jest.fn();
const mockGetAnyCachedCourses = jest.fn();
const mockGetAnyCachedTCCourses = jest.fn();
const mockListEnrollments = jest.fn();
const mockGetCourse = jest.fn();

jest.mock('../state/auth', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../state/school', () => ({
  useSchool: () => mockSchool,
}));

jest.mock('../services/puDataCache', () => ({
  getCachedCourses: (...args: unknown[]) => mockGetCachedCourses(...args),
  getCachedTCCourses: (...args: unknown[]) => mockGetCachedTCCourses(...args),
  getAnyCachedCourses: (...args: unknown[]) => mockGetAnyCachedCourses(...args),
  getAnyCachedTCCourses: (...args: unknown[]) => mockGetAnyCachedTCCourses(...args),
}));

jest.mock('../config/runtime', () => ({
  getRuntimeDataSourcePolicy: () => ({
    requestedMode: 'firebase',
    hybridPreferRealApi: true,
  }),
}));

jest.mock('../data', () => ({
  getDataSource: () => ({
    listEnrollments: (...args: unknown[]) => mockListEnrollments(...args),
    getCourse: (...args: unknown[]) => mockGetCourse(...args),
  }),
  hasDataSource: () => true,
}));

function course(id: string, name: string, schoolId?: string): Course {
  return {
    id,
    code: id,
    name,
    instructor: 'T',
    credits: 1,
    semester: '2026-1',
    schedule: [{ dayOfWeek: 1, startTime: '08:10', endTime: '09:00', location: 'R1' }],
    schoolId,
  };
}

function storageKey(feature: 'schedule-courses' | 'schedule-events', uid: string, schoolId: string) {
  return getScopedStorageKey(feature, { uid, schoolId });
}

type Snapshot = {
  courseIds: string[];
  loading: boolean;
  refresh: () => Promise<Course[]>;
};

let latest: Snapshot;

function Probe() {
  const schedule = useSchedule();
  latest = {
    courseIds: schedule.courses.map((row) => row.id),
    loading: schedule.loading,
    refresh: schedule.refreshSchedule,
  };
  return <Text>{schedule.courses.map((row) => row.name).join(',') || 'empty'}</Text>;
}

function tree() {
  return (
    <ScheduleProvider>
      <Probe />
    </ScheduleProvider>
  );
}

function setScope(uid: string, schoolId: string, profileSchoolId: string | null = schoolId) {
  mockAuth.user = { uid };
  mockAuth.profile = { uid, schoolId: profileSchoolId };
  mockSchool.school = { id: schoolId };
  mockSchool.schoolId = schoolId;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  setScope('user-a', 'pu', 'pu');
  mockGetCachedCourses.mockResolvedValue(null);
  mockGetCachedTCCourses.mockResolvedValue([]);
  mockGetAnyCachedCourses.mockResolvedValue(null);
  mockGetAnyCachedTCCourses.mockResolvedValue(null);
  mockListEnrollments.mockResolvedValue([]);
  mockGetCourse.mockResolvedValue(null);
});

test('switching school A→B never displays or persists A courses into B', async () => {
  const keyA = storageKey('schedule-courses', 'user-a', 'pu');
  const keyB = storageKey('schedule-courses', 'user-a', 'nthu');
  await AsyncStorage.setItem(keyA, JSON.stringify([course('a-1', 'School A Class', 'pu')]));
  await AsyncStorage.setItem(keyB, JSON.stringify([course('b-1', 'School B Class', 'nthu')]));

  const view = render(tree());
  await view.findByText('School A Class');

  setScope('user-a', 'nthu', 'nthu');
  view.rerender(tree());

  await view.findByText('School B Class');
  expect(view.queryByText('School A Class')).toBeNull();
  expect(latest.courseIds).toEqual(['b-1']);

  await waitFor(async () => {
    const rawB = await AsyncStorage.getItem(keyB);
    expect(rawB).toBeTruthy();
    expect(JSON.parse(rawB as string).map((row: Course) => row.id)).toEqual(['b-1']);
  });
  const rawA = JSON.parse((await AsyncStorage.getItem(keyA)) as string);
  expect(rawA.map((row: Course) => row.id)).toEqual(['a-1']);
});

test('switching Firebase account A→B never displays or persists A courses into B', async () => {
  const keyA = storageKey('schedule-courses', 'user-a', 'pu');
  const keyB = storageKey('schedule-courses', 'user-b', 'pu');
  await AsyncStorage.setItem(keyA, JSON.stringify([course('a-1', 'Account A Class', 'pu')]));
  await AsyncStorage.setItem(keyB, JSON.stringify([course('b-1', 'Account B Class', 'pu')]));

  const view = render(tree());
  await view.findByText('Account A Class');

  setScope('user-b', 'pu', 'pu');
  view.rerender(tree());

  await view.findByText('Account B Class');
  expect(view.queryByText('Account A Class')).toBeNull();
  expect(latest.courseIds).toEqual(['b-1']);

  await waitFor(async () => {
    expect(JSON.parse((await AsyncStorage.getItem(keyB)) as string).map((row: Course) => row.id)).toEqual([
      'b-1',
    ]);
  });
  expect(JSON.parse((await AsyncStorage.getItem(keyA)) as string).map((row: Course) => row.id)).toEqual([
    'a-1',
  ]);
});

test('unresolved school-A refresh cannot overwrite school-B courses', async () => {
  const keyA = storageKey('schedule-courses', 'user-a', 'pu');
  const keyB = storageKey('schedule-courses', 'user-a', 'nthu');
  await AsyncStorage.setItem(keyA, JSON.stringify([course('a-1', 'School A Class', 'pu')]));
  await AsyncStorage.setItem(keyB, JSON.stringify([course('b-1', 'School B Class', 'nthu')]));

  const view = render(tree());
  await view.findByText('School A Class');

  const pending = deferred<unknown[]>();
  mockListEnrollments.mockImplementation(() => pending.promise);

  let refreshPromise!: Promise<Course[]>;
  await act(async () => {
    refreshPromise = latest.refresh();
  });

  setScope('user-a', 'nthu', 'nthu');
  view.rerender(tree());
  await view.findByText('School B Class');

  mockGetCourse.mockResolvedValue(course('a-remote', 'Late A Remote', 'pu'));
  await act(async () => {
    pending.resolve([{ courseId: 'a-remote', status: 'enrolled' }]);
    await refreshPromise;
  });

  expect(view.queryByText('Late A Remote')).toBeNull();
  expect(view.queryByText('School A Class')).toBeNull();
  expect(latest.courseIds).toEqual(['b-1']);
  expect(JSON.parse((await AsyncStorage.getItem(keyB)) as string).map((row: Course) => row.id)).toEqual([
    'b-1',
  ]);
});

test('unknown-school PU cache fallback never happens', async () => {
  mockGetCachedCourses.mockResolvedValue(null);
  mockGetAnyCachedCourses.mockResolvedValue({
    courses: [{ code: 'PU101', name: 'PU Secret', periods: [1], dayOfWeek: 1 }],
  });

  await expect(
    loadCoursesFromCache({ schoolId: 'nthu', profileSchoolId: 'nthu' }),
  ).resolves.toEqual([]);
  expect(mockGetCachedCourses).not.toHaveBeenCalled();
  expect(mockGetAnyCachedCourses).not.toHaveBeenCalled();
  expect(mockGetCachedTCCourses).not.toHaveBeenCalled();
  expect(mockGetAnyCachedTCCourses).not.toHaveBeenCalled();

  await expect(
    loadCoursesFromCache({ schoolId: 'pu', profileSchoolId: 'nthu' }),
  ).resolves.toEqual([]);
  expect(mockGetCachedCourses).not.toHaveBeenCalled();
  expect(mockGetAnyCachedCourses).not.toHaveBeenCalled();
  expect(mockGetCachedTCCourses).not.toHaveBeenCalled();
  expect(mockGetAnyCachedTCCourses).not.toHaveBeenCalled();
});

test('matching Providence profile retains expired-cache recovery while offline', async () => {
  mockGetCachedCourses.mockResolvedValue(null);
  mockGetCachedTCCourses.mockResolvedValue(null);
  mockGetAnyCachedCourses.mockResolvedValue({
    courses: [{ code: 'PU101', name: 'Retained PU Class', periods: [1], dayOfWeek: 1 }],
  });
  mockGetAnyCachedTCCourses.mockResolvedValue([
    { id: 99, name: 'Retained TC Class', course_code: 'TC101' },
  ]);
  const restored = await loadCoursesFromCache({ schoolId: 'pu', profileSchoolId: 'tw-pu' });
  expect(restored.map((entry) => entry.name)).toEqual(['Retained PU Class', 'Retained TC Class']);
  expect(mockGetAnyCachedCourses).toHaveBeenCalledTimes(1);
  expect(mockGetAnyCachedTCCourses).toHaveBeenCalledTimes(1);
});

test('unresolved school profile cannot read PU cache or fetch private enrollments', async () => {
  await expect(loadCoursesFromCache({ schoolId: 'pu' })).resolves.toEqual([]);
  expect(mockGetCachedCourses).not.toHaveBeenCalled();
  mockAuth.profile = null;
  render(tree());
  await waitFor(() => expect(latest.loading).toBe(false));
  await act(async () => { await latest.refresh(); });
  expect(mockListEnrollments).not.toHaveBeenCalled();
  expect(mockGetCachedCourses).not.toHaveBeenCalled();
});

test('unscoped legacy courses and events are not imported into a scope', async () => {
  await AsyncStorage.setItem(
    '@schedule_courses',
    JSON.stringify([course('legacy-course', 'Legacy Course', 'pu')]),
  );
  await AsyncStorage.setItem(
    '@schedule_events',
    JSON.stringify([
      {
        id: 'legacy-event',
        title: 'Legacy Event',
        dayOfWeek: 2,
        startTime: '10:00',
        endTime: '11:00',
        type: 'personal',
      },
    ]),
  );

  const view = render(tree());
  await waitFor(() => expect(latest.loading).toBe(false));

  expect(view.queryByText('Legacy Course')).toBeNull();
  expect(latest.courseIds).toEqual([]);
  expect(await AsyncStorage.getItem('@schedule_courses')).toContain('Legacy Course');
  expect(await AsyncStorage.getItem(storageKey('schedule-courses', 'user-a', 'pu'))).toBe(
    JSON.stringify([]),
  );
});

test('existing scoped offline schedule still loads without remote data', async () => {
  const key = storageKey('schedule-courses', 'user-a', 'pu');
  await AsyncStorage.setItem(key, JSON.stringify([course('offline-1', 'Offline PU Class', 'pu')]));
  mockListEnrollments.mockRejectedValue(new Error('offline'));

  const view = render(tree());
  await view.findByText('Offline PU Class');
  expect(latest.courseIds).toEqual(['offline-1']);
});

test('an adapter returning another school course is rejected', async () => {
  setScope('user-a', 'ntu', 'ntu');
  mockListEnrollments.mockResolvedValue([{ courseId: 'wrong', status: 'enrolled', schoolId: 'ntu' }]);
  mockGetCourse.mockResolvedValue(course('wrong', 'Other School Class', 'pu'));
  const view = render(tree());
  await waitFor(() => expect(mockGetCourse).toHaveBeenCalledWith('wrong', 'ntu'));
  await waitFor(() => expect(latest.loading).toBe(false));
  expect(view.queryByText('Other School Class')).toBeNull();
  expect(latest.courseIds).toEqual([]);
});
