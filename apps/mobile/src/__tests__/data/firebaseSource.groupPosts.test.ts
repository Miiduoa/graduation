import { getDocs } from 'firebase/firestore';
import { firebaseSource } from '../../data/firebaseSource';
import { postNuniWebFn } from '../../services/nuniWebFn';
const mockUser = { uid: 'alice' };
let mockCurrentUser: typeof mockUser | null = mockUser;
jest.mock('../../services/nuniWebFn', () => ({ postNuniWebFn: jest.fn() }));
jest.mock('../../firebase', () => ({
  getDb: () => 'db',
  getAuthInstance: () => ({ currentUser: mockCurrentUser }),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = mockUser;
  jest.mocked(postNuniWebFn).mockResolvedValue({ posts: [{
    id: 'legacy', body: '歷史公開貼文', createdAt: { seconds: 100, nanoseconds: 1000000 },
  }] });
});

test('共用貼文來源使用 hosted 可見性政策，保留舊貼文及日期格式', async () => {
  const posts = await firebaseSource.listGroupPosts('g1', { limit: 30 });
  expect(postNuniWebFn).toHaveBeenCalledWith('listGroupDiscussionPage', { groupId: 'g1', pageSize: 30 }, 'alice');
  expect(posts).toEqual([{ id: 'legacy', groupId: 'g1', body: '歷史公開貼文', createdAt: '1970-01-01T00:01:40.001Z' }]);
  expect(getDocs).not.toHaveBeenCalled();
});

test('hosted 拒絕時不回退到未篩選查詢', async () => {
  jest.mocked(postNuniWebFn).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(firebaseSource.listGroupPosts('g1')).rejects.toThrow('permission-denied');
  expect(getDocs).not.toHaveBeenCalled();
});

test('登入狀態失效或切換帳號不回傳舊內容', async () => {
  mockCurrentUser = null;
  await expect(firebaseSource.listGroupPosts('g1')).rejects.toThrow('請先登入');
  expect(postNuniWebFn).not.toHaveBeenCalled();
  mockCurrentUser = mockUser;
  jest.mocked(postNuniWebFn).mockImplementationOnce(async () => {
    mockCurrentUser = { uid: 'bob' };
    return { posts: [] };
  });
  await expect(firebaseSource.listGroupPosts('g1')).rejects.toThrow('帳號已變更');
});
