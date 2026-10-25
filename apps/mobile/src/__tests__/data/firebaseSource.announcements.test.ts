import { doc, getDoc, getDocs } from 'firebase/firestore';
import { firebaseSource } from '../../data/firebaseSource';
import { createCachedSource } from '../../data/cachedSource';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../firebase', () => ({
  getDb: () => 'db',
  getAuthInstance: jest.fn(),
  getFunctionsInstance: jest.fn(),
}));
jest.mock('../../data/firestorePath', () => ({
  docFromSegments: (_db: unknown, segments: string[]) => ({ path: segments.join('/') }),
  collectionFromSegments: jest.fn(),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((...args: unknown[]) => ({ path: args.slice(1).join('/') })),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
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

function snapshot(path: string, data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    id: path.split('/').pop(),
    data: () => data,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(getDoc).mockReset();
  jest.mocked(getDocs).mockReset();
  jest.mocked(doc).mockImplementation((...args: unknown[]) => ({ path: args.slice(1).join('/') }) as never);
});

test('reads school-scoped announcements and rejects another school document', async () => {
  jest.mocked(getDoc).mockImplementation(async (ref: { path: string }) => {
    if (ref.path === 'schools/pu/announcements/a1') {
      return snapshot(ref.path, { title: '靜宜公告', schoolId: 'pu' }) as never;
    }
    if (ref.path === 'schools/nthu/announcements/a1') {
      return snapshot(ref.path, { title: '清華偽裝', schoolId: 'pu' }) as never;
    }
    return snapshot(ref.path, null) as never;
  });
  await expect(firebaseSource.getAnnouncement('a1', 'pu')).resolves.toMatchObject({
    title: '靜宜公告',
    schoolId: 'pu',
  });
  await expect(firebaseSource.getAnnouncement('a1', 'nthu')).resolves.toBeNull();
});

test('does not treat a global announcement as another school', async () => {
  jest.mocked(getDoc).mockImplementation(async (ref: { path: string }) => {
    if (ref.path === 'announcements/a1') {
      return snapshot(ref.path, { title: '未標學校', schoolId: 'pu' }) as never;
    }
    return snapshot(ref.path, null) as never;
  });
  await expect(firebaseSource.getAnnouncement('a1', 'nthu')).resolves.toBeNull();
  await expect(firebaseSource.getAnnouncement('a1', 'pu')).resolves.toMatchObject({
    title: '未標學校',
    schoolId: 'pu',
  });
});

test('announcement detail preserves full text and visibility metadata without reopening hidden canonical records', async () => {
  const visible = {
    title: '期中成績繳交作業提醒', schoolId: 'pu',
    body: '完整說明。\n\n請檢附文件。', summary: '摘要。',
    audience: 'staff', studentFeed: false, visible: true,
  };
  jest.mocked(getDoc).mockImplementation(async (ref: { path: string }) => {
    if (ref.path === 'schools/pu/announcements/visible') return snapshot(ref.path, visible) as never;
    return snapshot(ref.path, { ...visible, visible: false }) as never;
  });
  await expect(firebaseSource.getAnnouncement('visible', 'pu')).resolves.toMatchObject(visible);
  jest.mocked(getDoc).mockClear();
  await expect(firebaseSource.getAnnouncement('hidden', 'pu')).resolves.toBeNull();
  expect(getDoc).toHaveBeenCalledTimes(1);
  expect((jest.mocked(getDoc).mock.calls[0][0] as { path: string }).path).toBe('schools/pu/announcements/hidden');
});

test.each(['pu', undefined])('hidden legacy announcements are omitted for school %s', async (schoolId) => {
  jest.mocked(getDoc).mockImplementation(async (ref: { path: string }) =>
    snapshot(ref.path, ref.path.startsWith('schools/') ? null : { title: '下架公告', schoolId: 'pu', visible: false }) as never,
  );
  await expect(firebaseSource.getAnnouncement('hidden', schoolId)).resolves.toBeNull();
});

test.each(['pu', undefined])('announcement lists omit hidden rows and preserve public metadata for school %s', async (schoolId) => {
  const visible = {
    title: '期中成績繳交作業提醒', schoolId: 'pu', publishedAt: '2026-10-25T00:00:00Z',
    body: '完整內容。', summary: '摘要。', audience: 'staff', studentFeed: false, visible: true,
  };
  jest.mocked(getDocs).mockResolvedValue({ docs: [
    snapshot('announcements/visible', visible),
    snapshot('announcements/hidden', { ...visible, title: '下架公告', visible: false }),
  ] } as never);
  const rows = await firebaseSource.listAnnouncements(schoolId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: 'visible', ...visible });
});

test('actual Firebase course reads and cache stay on the explicitly requested school', async () => {
  jest.mocked(getDoc).mockImplementation(async (ref: { path: string }) => {
    const schoolId = ref.path.split('/')[1];
    return snapshot(ref.path, { name: `${schoolId} course`, schoolId }) as never;
  });
  const cached = createCachedSource(firebaseSource);
  await expect(cached.getCourse('shared', 'pu')).resolves.toMatchObject({ name: 'pu course' });
  await expect(cached.getCourse('shared', 'ntu')).resolves.toMatchObject({ name: 'ntu course' });
  expect(jest.mocked(getDoc).mock.calls.map(([ref]) => (ref as { path: string }).path))
    .toEqual(['schools/pu/courses/shared', 'schools/ntu/courses/shared']);
  jest.mocked(getDoc).mockClear();
  await expect(cached.getCourse('shared', 'ntu')).resolves.toMatchObject({ schoolId: 'ntu' });
  expect(getDoc).not.toHaveBeenCalled();
});

test('scoped course read rejects wrong-school data and legacy fallback requires a matching school', async () => {
  jest.mocked(getDoc).mockImplementation(async (ref: { path: string }) => {
    if (ref.path === 'schools/ntu/courses/corrupt') {
      return snapshot(ref.path, { name: 'Wrong school', schoolId: 'pu' }) as never;
    }
    if (ref.path.startsWith('courses/')) {
      return snapshot(ref.path, { name: 'Legacy PU', schoolId: 'tw-pu' }) as never;
    }
    return snapshot(ref.path, null) as never;
  });
  await expect(firebaseSource.getCourse('corrupt', 'ntu')).resolves.toBeNull();
  await expect(firebaseSource.getCourse('legacy', 'ntu')).resolves.toBeNull();
  await expect(firebaseSource.getCourse('legacy', 'tw-pu')).resolves.toMatchObject({ schoolId: 'pu' });
});

test('a failed scoped course read never substitutes a global legacy course', async () => {
  jest.mocked(getDoc).mockRejectedValue(new Error('permission-denied'));
  await expect(firebaseSource.getCourse('shared', 'ntu')).rejects.toThrow();
  expect(jest.mocked(getDoc).mock.calls.map(([ref]) => (ref as { path: string }).path))
    .toEqual(['schools/ntu/courses/shared']);
});
