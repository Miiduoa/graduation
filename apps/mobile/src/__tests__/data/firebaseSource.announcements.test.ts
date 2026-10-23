import { doc, getDoc } from 'firebase/firestore';
import { firebaseSource } from '../../data/firebaseSource';

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

beforeEach(() => {
  jest.mocked(getDoc).mockReset();
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
