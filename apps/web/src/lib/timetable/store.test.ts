import { beforeEach, expect, it, vi } from 'vitest';
import type { PersonalCourse } from '@campus/shared';

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  paths: [] as string[],
}));
const auth = vi.hoisted(() => ({
  currentUser: { uid: 'u-1', getIdToken: async () => 'id-token' } as {
    uid: string;
    getIdToken: () => Promise<string>;
  } | null,
}));
const firebase = vi.hoisted(() => ({ configured: true, functionsConfigured: true }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db: unknown, ...parts: string[]) => {
    const path = parts.join('/');
    firestore.paths.push(path);
    return { path };
  }),
  getDoc: (ref: { path: string }) => firestore.getDoc(ref),
  getDocs: vi.fn(),
  query: vi.fn(),
  serverTimestamp: () => 'server-time',
  setDoc: (ref: { path: string }, data: unknown, options?: unknown) =>
    firestore.setDoc(ref, data, options),
  updateDoc: vi.fn(),
  where: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => auth,
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}`,
  isFirebaseConfigured: () => firebase.configured,
}));
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => firebase.functionsConfigured,
}));

import { httpsCallable } from 'firebase/functions';
import {
  TIMETABLE_DEVICE_ONLY_STORED_COPY,
  TIMETABLE_DEVICE_ONLY_SUBMIT_COPY,
  createCourseAppeal,
  createServerShare,
  loadAppealTeacherStatus,
  loadFriendTimetable,
  loadPersonalTimetable,
  revokeServerShare,
  savePersonalTimetable,
  type StoredTimetable,
} from './store';

function cloudSnap(data: unknown, exists = true) {
  return { exists: () => exists, data: () => data };
}

function mockCloud(options: {
  canonical?: { exists?: boolean; data?: unknown };
  legacy?: { exists?: boolean; data?: unknown };
}) {
  firestore.getDoc.mockImplementation(async (ref: { path: string }) => {
    const canonical = ref.path.includes('/schools/') && ref.path.includes('personalTimetable');
    const target = canonical ? options.canonical : options.legacy;
    if (!target || target.exists === false) return cloudSnap(undefined, false);
    return cloudSnap(target.data);
  });
}

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

const storedTimetable = (courses: PersonalCourse[] = [course]): StoredTimetable => ({
  courses,
  meta: {} as never,
  shareWithFriends: true,
  updatedAt: '2026-10-01T00:00:00.000Z',
  schoolId: 'pu',
});

beforeEach(() => {
  localStorage.clear();
  firestore.getDoc.mockReset();
  firestore.setDoc.mockReset();
  firestore.paths = [];
  auth.currentUser = { uid: 'u-1', getIdToken: async () => 'id-token' };
  firebase.configured = true;
  firebase.functionsConfigured = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(httpsCallable).mockClear();
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
  mockCloud({
    canonical: {
      data: { courses: [], schoolId: 'pu', updatedAt: { toMillis: () => Date.now() - 60_000 } },
    },
  });
  const loaded = await loadPersonalTimetable('u-1', 'pu');
  // Scoped local save wins over cloud; web save stays device-only.
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
  mockCloud({
    canonical: {
      data: {
        courses: [{ ...course, id: 'c-2', name: '作業系統' }],
        schoolId: 'pu',
        updatedAt: { toMillis: () => Date.parse('2026-10-11T00:00:00.000Z') },
      },
    },
  });
  const loaded = await loadPersonalTimetable('u-1', 'pu');
  expect(loaded.courses.map((item) => item.name)).toEqual(['作業系統']);
  expect(firestore.paths[0]).toBe('users/u-1/schools/pu/personalTimetable/current');
});

it('rejects canonical cloud records without exact schoolId provenance instead of pretending empty', async () => {
  mockCloud({
    canonical: {
      data: {
        courses: [course],
        updatedAt: { toMillis: () => Date.parse('2026-10-11T00:00:00.000Z') },
      },
    },
  });
  await expect(loadPersonalTimetable('u-1', 'nthu', 'school:u-1')).rejects.toThrow(
    '雲端課表格式異常',
  );
  await expect(loadPersonalTimetable('u-1', 'pu', 'school:u-1')).rejects.toThrow(
    '雲端課表格式異常',
  );
  expect(firestore.setDoc).not.toHaveBeenCalled();
});

it('does not mix explicitly tagged remote university timetables when switching campuses', async () => {
  firestore.getDoc.mockImplementation(async (ref: { path: string }) => {
    if (ref.path.includes('/schools/nthu/')) {
      return cloudSnap({
        courses: [{ ...course, id: 'nthu-course', name: '清大資料' }],
        schoolId: 'nthu',
        updatedAt: { toMillis: () => Date.parse('2026-10-11T00:00:00.000Z') },
      });
    }
    if (ref.path.includes('/schools/pu/')) return cloudSnap(undefined, false);
    return cloudSnap({ schoolId: 'nthu', courses: [course] });
  });
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
  expect(
    (await loadPersonalTimetable('u-1', 'nthu', 'school:u-1')).courses.map((row) => row.name),
  ).toEqual(['清大資料']);
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
});

it('lets an empty canonical timetable win over a matching legacy document', async () => {
  mockCloud({
    canonical: {
      data: {
        courses: [],
        schoolId: 'pu',
        shareWithFriends: true,
        updatedAt: { toMillis: () => Date.parse('2026-10-01T00:00:00.000Z') },
      },
    },
    legacy: {
      data: {
        courses: [course],
        schoolId: 'pu',
        updatedAt: { toMillis: () => Date.parse('2026-10-20T00:00:00.000Z') },
      },
    },
  });
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
  expect(firestore.getDoc).toHaveBeenCalledTimes(1);
});

it('reads legacy cloud only when canonical is absent and legacy.schoolId matches exactly', async () => {
  mockCloud({
    canonical: { exists: false },
    legacy: {
      data: {
        courses: [{ ...course, name: '舊路徑課程' }],
        schoolId: 'pu',
        updatedAt: { toMillis: () => Date.parse('2026-10-11T00:00:00.000Z') },
      },
    },
  });
  expect(
    (await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses.map((row) => row.name),
  ).toEqual(['舊路徑課程']);
  mockCloud({
    canonical: { exists: false },
    legacy: {
      data: {
        courses: [course],
        schoolId: 'nthu',
        updatedAt: { toMillis: () => Date.parse('2026-10-11T00:00:00.000Z') },
      },
    },
  });
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
});

it('loads a friend timetable from the selected school canonical path', async () => {
  mockCloud({
    canonical: {
      data: {
        courses: [{ ...course, name: '好友課' }],
        schoolId: 'nthu',
        shareWithFriends: true,
      },
    },
  });
  const loaded = await loadFriendTimetable('friend-1', 'nthu');
  expect(loaded?.courses.map((row) => row.name)).toEqual(['好友課']);
  expect(firestore.paths[0]).toBe('users/friend-1/schools/nthu/personalTimetable/current');
  mockCloud({
    canonical: {
      data: { courses: [course], schoolId: 'pu', shareWithFriends: true },
    },
  });
  expect(await loadFriendTimetable('friend-1', 'nthu')).toBeNull();
});

it('writes ensureTimetableIndex only to the canonical path for the appeal school', async () => {
  mockCloud({ canonical: { exists: false } });
  await createCourseAppeal(
    {
      schoolId: 'nthu',
      studentUid: 'u-1',
      courseId: 'c-1',
      courseName: '資料庫',
      offeringId: '資料庫|',
      title: '申訴',
      body: '說明',
    },
    'appeal-1',
    [course],
  );
  expect(firestore.setDoc.mock.calls[0][0].path).toBe(
    'users/u-1/schools/nthu/personalTimetable/current',
  );
  expect(firestore.setDoc.mock.calls[0][1]).toMatchObject({ schoolId: 'nthu' });
  expect(firestore.paths.some((path) => path === 'users/u-1/personalTimetable/current')).toBe(
    false,
  );
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
  [
    'oversized course list',
    JSON.stringify({ schoolId: 'pu', courses: Array.from({ length: 81 }, () => course), meta: {} }),
  ],
  ['foreign scoped school', JSON.stringify({ schoolId: 'ntu', courses: [course], meta: {} })],
])(
  'preserves %s from a damaged scoped copy instead of treating it as empty',
  async (_label, raw) => {
    const key = 'campus-one-personal-timetable:school:u-1:pu';
    localStorage.setItem(key, raw);
    await expect(loadPersonalTimetable('u-1', 'pu', 'school:u-1')).rejects.toThrow();
    await expect(
      savePersonalTimetable(
        'u-1',
        {
          courses: [course],
          meta: {} as never,
          shareWithFriends: true,
          updatedAt: new Date().toISOString(),
          schoolId: 'pu',
        },
        'school:u-1',
      ),
    ).rejects.toThrow();
    expect(localStorage.getItem(key)).toBe(raw);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  },
);

it('retains a mismatched unscoped legacy school without exposing it', async () => {
  const legacyKey = 'campus-one-personal-timetable:u-1';
  const raw = JSON.stringify({ schoolId: 'ntu', courses: [course] });
  localStorage.setItem(legacyKey, raw);
  firestore.getDoc.mockResolvedValue({ exists: () => false });
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
  expect(localStorage.getItem(legacyKey)).toBe(raw);
});

it('does not claim an unscoped legacy copy with no school or silently migrate it', async () => {
  const key = 'campus-one-personal-timetable:u-1';
  const raw = JSON.stringify({ courses: [course], updatedAt: '2026-10-12T00:00:00Z' });
  localStorage.setItem(key, raw);
  firestore.getDoc.mockResolvedValue({ exists: () => false });
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
  expect(localStorage.getItem(key)).toBe(raw);
});

it('rejects a scoped timetable missing the school marker without erasing it', async () => {
  const key = 'campus-one-personal-timetable:school:u-1:pu';
  const raw = JSON.stringify({ courses: [course], updatedAt: '2026-10-12T00:00:00Z' });
  localStorage.setItem(key, raw);
  await expect(
    savePersonalTimetable(
      'u-1',
      {
        courses: [course],
        meta: {} as never,
        shareWithFriends: true,
        updatedAt: '',
        schoolId: 'pu',
      },
      'school:u-1',
    ),
  ).rejects.toThrow('資料');
  expect(localStorage.getItem(key)).toBe(raw);
});

it('preserves an intentional empty local timetable against an older cloud snapshot', async () => {
  const schoolOwner = 'school:u-1';
  const updated = await savePersonalTimetable(
    'u-1',
    {
      courses: [],
      meta: {} as never,
      shareWithFriends: false,
      updatedAt: '2026-10-14T00:00:00.000Z',
      schoolId: 'pu',
    },
    schoolOwner,
  );
  expect(updated).toEqual({ stored: 'local' });
  const raw = localStorage.getItem('campus-one-personal-timetable:school:u-1:pu');
  expect(raw).toContain('"courses":[]');
  mockCloud({
    canonical: {
      data: {
        courses: [course],
        shareWithFriends: true,
        updatedAt: { toMillis: () => Date.parse('2026-10-01T00:00:00.000Z') },
        schoolId: 'pu',
      },
    },
  });
  const loaded = await loadPersonalTimetable('u-1', 'pu', schoolOwner);
  expect(loaded.courses).toEqual([]);
  expect(loaded.shareWithFriends).toBe(false);
  expect(localStorage.getItem('campus-one-personal-timetable:school:u-1:pu')).toBe(raw);
});

it('does not treat a foreign legacy timetable or a missing timestamp as a fresh empty edit', async () => {
  const key = 'campus-one-personal-timetable:u-1';
  const remote = { ...course, name: '雲端學期課程' };
  mockCloud({
    canonical: {
      data: {
        courses: [remote],
        schoolId: 'pu',
        updatedAt: { toMillis: () => Date.parse('2026-10-11T00:00:00.000Z') },
      },
    },
  });
  localStorage.setItem(key, JSON.stringify({ courses: [course], schoolId: 'ntu' }));
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([remote]);
  localStorage.setItem(key, JSON.stringify({ courses: [course], schoolId: 'pu' }));
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([remote]);
  expect(firestore.setDoc).not.toHaveBeenCalled();
});

it('surfaces an uncached account read failure without adopting guest data or claiming an empty timetable', async () => {
  const guest = JSON.stringify(storedTimetable());
  localStorage.setItem('campus-one-personal-timetable:local:pu', guest);
  firestore.getDoc.mockRejectedValue(new Error('offline'));
  await expect(loadPersonalTimetable('u-1', 'pu', 'school:u-1')).rejects.toThrow('offline');
  await expect(loadPersonalTimetable('u-1', 'pu')).rejects.toThrow('offline');
  expect(localStorage.getItem('campus-one-personal-timetable:local:pu')).toBe(guest);
  expect(localStorage.getItem('campus-one-personal-timetable:school:u-1:pu')).toBeNull();
  expect(firestore.setDoc).not.toHaveBeenCalled();
});

it('preserves an intentional device-only deletion without comparing it to legacy cloud timestamps', async () => {
  await savePersonalTimetable('u-1', storedTimetable([]), 'school:u-1');
  const key = 'campus-one-personal-timetable:school:u-1:pu';
  const saved = localStorage.getItem(key);
  mockCloud({
    canonical: {
      data: { ...storedTimetable(), updatedAt: '2099-01-01T00:00:00.000Z' },
    },
  });
  expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([]);
  expect(localStorage.getItem(key)).toBe(saved);
  expect(firestore.getDoc).not.toHaveBeenCalled();
  expect(firestore.setDoc).not.toHaveBeenCalled();
});

it.each(['found', 'missing', 'offline'])(
  'retains a device edit made while a legacy cloud read is pending (%s)',
  async (outcome) => {
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    firestore.getDoc.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const loading = loadPersonalTimetable('u-1', 'pu', 'school:u-1');
    await savePersonalTimetable('u-1', storedTimetable([]), 'school:u-1');
    const key = 'campus-one-personal-timetable:school:u-1:pu';
    const saved = localStorage.getItem(key);
    if (outcome === 'offline') fail(new Error('offline'));
    else
      finish({
        exists: () => outcome === 'found',
        data: () => storedTimetable(),
      });
    expect((await loading).courses).toEqual([]);
    expect(localStorage.getItem(key)).toBe(saved);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  },
);

it.each([
  ['missing payload', null],
  ['non-array courses', { ...storedTimetable(), courses: 'not-a-course-list' }],
  ['invalid course row', { ...storedTimetable(), courses: [null] }],
  [
    'oversized course list',
    { ...storedTimetable(), courses: Array.from({ length: 81 }, () => course) },
  ],
  ['invalid metadata', { ...storedTimetable(), meta: [] }],
  ['invalid school marker', { ...storedTimetable(), schoolId: { id: 'pu' } }],
])(
  'refuses %s in an uncached cloud record without turning it into an empty timetable',
  async (_label, data) => {
    mockCloud({ canonical: { data } });
    await expect(loadPersonalTimetable('u-1', 'pu', 'school:u-1')).rejects.toThrow(
      '雲端課表格式異常',
    );
    expect(localStorage.length).toBe(0);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  },
);

it.each(['offline', 'malformed'])(
  'keeps a recoverable same-school legacy copy when the cloud is %s',
  async (outcome) => {
    const key = 'campus-one-personal-timetable:u-1';
    const raw = JSON.stringify(storedTimetable());
    localStorage.setItem(key, raw);
    if (outcome === 'offline') firestore.getDoc.mockRejectedValue(new Error('offline'));
    else mockCloud({ canonical: { data: { ...storedTimetable(), courses: 'not-a-course-list' } } });
    expect((await loadPersonalTimetable('u-1', 'pu', 'school:u-1')).courses).toEqual([course]);
    expect(localStorage.getItem(key)).toBe(raw);
    expect(localStorage.getItem('campus-one-personal-timetable:school:u-1:pu')).toBeNull();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  },
);

it.each(['platform:account-a', 'nuni:account-a', 'school:u-2', 'guest'])(
  'does not read a Firebase account timetable into the different local owner %s',
  async (owner) => {
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => storedTimetable() });
    expect((await loadPersonalTimetable('u-1', 'pu', owner)).courses).toEqual([]);
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  },
);

it('does not let a guest device copy replace an existing account cloud record for an old caller', async () => {
  const guest = JSON.stringify({ ...storedTimetable(), updatedAt: '2099-01-01T00:00:00.000Z' });
  localStorage.setItem('campus-one-personal-timetable:local:pu', guest);
  const remote = { ...course, name: '帳號原有課程' };
  mockCloud({ canonical: { data: storedTimetable([remote]) } });
  expect((await loadPersonalTimetable('u-1', 'pu')).courses).toEqual([remote]);
  expect(localStorage.getItem('campus-one-personal-timetable:local:pu')).toBe(guest);
});

it('does not call Cloud Functions for teacher status when the functions base URL is unset', async () => {
  firebase.functionsConfigured = false;
  const call = vi.fn();
  vi.mocked(httpsCallable).mockReturnValue(call as never);
  expect(await loadAppealTeacherStatus('pu', ['資料庫｜王老師'])).toEqual({});
  expect(httpsCallable).not.toHaveBeenCalled();
});

it('calls Cloud Functions for teacher status when the functions base URL is set', async () => {
  const call = vi.fn().mockResolvedValue({ data: { assigned: { '資料庫｜王老師': true } } });
  vi.mocked(httpsCallable).mockReturnValue(call as never);
  expect(await loadAppealTeacherStatus('pu', ['資料庫｜王老師'])).toEqual({
    '資料庫｜王老師': true,
  });
  expect(httpsCallable).toHaveBeenCalled();
  expect(call).toHaveBeenCalledWith({ schoolId: 'pu', offeringIds: ['資料庫｜王老師'] });
});

it('creates a timetable share through the same-origin /api/fn route', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      result: {
        token: 'share-token',
        path: '/timetable/s/share-token',
        expiresAt: '2026-10-31T00:00:00.000Z',
      },
    }),
  });
  const snapshot = {
    courses: [course],
    meta: { school: '', year: '', semester: '', className: '', credits: 0, title: '我的課表' },
  };
  await expect(createServerShare('pu', '我的課表', snapshot)).resolves.toEqual({
    token: 'share-token',
    path: '/timetable/s/share-token',
    expiresAt: '2026-10-31T00:00:00.000Z',
  });
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/createTimetableShare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token' },
    body: JSON.stringify({
      data: { schoolId: 'pu', name: '我的課表', courses: snapshot.courses, meta: snapshot.meta },
    }),
    cache: 'no-store',
  });
  expect(httpsCallable).not.toHaveBeenCalled();
});

it('revokes a timetable share through the same-origin /api/fn route', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ result: { ok: true } }),
  });
  await expect(revokeServerShare('share-token')).resolves.toEqual({ ok: true });
  expect(fetchMock.mock.calls[0][0]).toBe('/api/fn/revokeTimetableShare');
});

it('surfaces 尚未啟用 when the same-origin share route is not configured', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => ({ error: { status: 'UNAVAILABLE', message: '尚未啟用' } }),
  });
  await expect(createServerShare('pu', '我的課表')).rejects.toMatchObject({
    code: 'functions-unconfigured',
    message: '課表分享尚未啟用',
  });
});

it('retains separately saved class exceptions when an older timetable writer omits the field', async () => {
  const { classMeetingKey, manualClassRecords, classExceptionsForStorage } = await import('@campus/shared');
  const timetable = storedTimetable();
  timetable.meta = { school: '', year: '115', semester: '1', className: '', credits: 0, title: '' };
  const original = manualClassRecords(timetable)[0];
  const value = { id: 'stop', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02',
    kind: 'cancel' as const, createdAt: '2026-11-01T00:00:00Z' };
  await savePersonalTimetable(null, { ...timetable, classExceptions: [value] });
  await savePersonalTimetable(null, { ...timetable, courses: [] });
  expect((await loadPersonalTimetable(null, 'pu')).classExceptions).toEqual(classExceptionsForStorage([value]));
  await savePersonalTimetable(null, { ...timetable, classExceptions: [] });
  expect((await loadPersonalTimetable(null, 'pu')).classExceptions).toEqual([]);
});
