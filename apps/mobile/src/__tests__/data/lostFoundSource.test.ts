import { addDoc, getDocFromServer, getDocsFromServer, runTransaction } from 'firebase/firestore';
import { lostFoundSource } from '../../data/lostFoundSource';
import { createCachedSource } from '../../data/cachedSource';
import type { DataSource } from '../../data/source';

let mockUid: string | null = 'owner';
const mockUpdate = jest.fn();
const mockGet = jest.fn();
jest.mock('../../firebase', () => ({
  getDb: () => ({}),
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
}));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: (_: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
  where: (...parts: unknown[]) => parts,
  addDoc: jest.fn(),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
  runTransaction: jest.fn(),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));
function row(overrides: Record<string, unknown> = {}) {
  return {
    type: 'lost',
    title: '筆記本',
    description: '這是綠色封面的課程筆記本',
    category: 'books',
    location: '圖書館',
    date: '2026-10-08',
    createdAt: '2026-10-08T01:00:00Z',
    schoolId: 'pu',
    userId: 'owner',
    reporterId: 'owner',
    status: 'open',
    ...overrides,
  };
}
function snapshot(data: Record<string, unknown> | null, path = 'schools/pu/lostFound/item-1') {
  return {
    id: path.split('/').at(-1),
    exists: () => data !== null,
    data: () => data,
    ref: { path },
  };
}
const input = {
  type: 'lost' as const,
  title: '筆記本',
  description: '這是綠色封面的課程筆記本',
  category: 'books' as const,
  location: '圖書館',
  date: '2026-10-08',
  schoolId: 'pu',
  reporterId: 'owner',
};
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'owner';
  jest.mocked(getDocFromServer).mockResolvedValue(snapshot(row()) as never);
  jest.mocked(getDocsFromServer).mockResolvedValue({ docs: [] } as never);
  jest.mocked(addDoc).mockResolvedValue({ path: 'schools/pu/lostFound/item-1' } as never);
  mockGet.mockResolvedValue(snapshot(row()));
  jest
    .mocked(runTransaction)
    .mockImplementation(async (_, update) => update({ get: mockGet, update: mockUpdate } as never));
});

test('creates canonical school records using the actual Firebase UID required by rules', async () => {
  const result = await lostFoundSource.createLostFoundItem(input);
  expect(addDoc).toHaveBeenCalledWith(
    { path: 'schools/pu/lostFound' },
    expect.objectContaining({
      userId: 'owner',
      reporterId: 'owner',
      schoolId: 'pu',
      createdAt: 'SERVER_TIMESTAMP',
      status: 'open',
    }),
  );
  expect(result.id).toBe('item-1');
  expect(result.reporterId).toBe('owner');
});

test('cannot publish for someone else or without an explicit school', async () => {
  await expect(
    lostFoundSource.createLostFoundItem({ ...input, reporterId: 'other' }),
  ).rejects.toThrow('無法代其他帳號發布');
  await expect(
    lostFoundSource.createLostFoundItem({ ...input, schoolId: undefined }),
  ).rejects.toThrow('範圍');
  expect(addDoc).not.toHaveBeenCalled();
});

test('a failed readback is not a confirmed publication', async () => {
  jest.mocked(getDocFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(lostFoundSource.createLostFoundItem(input)).rejects.toMatchObject({
    code: 'lost-found-write-unconfirmed',
  });
});

test('account switches while creating a post cannot return a success for the old user', async () => {
  jest.mocked(addDoc).mockImplementationOnce(async () => {
    mockUid = 'new-user';
    return { path: 'saved' } as never;
  });
  await expect(lostFoundSource.createLostFoundItem(input)).rejects.toThrow('帳號已切換');
});

test('detail uses the same canonical path as creation and rejects cross-school records', async () => {
  await lostFoundSource.getLostFoundItem('item-1', 'pu');
  expect(getDocFromServer).toHaveBeenCalledWith({ path: 'schools/pu/lostFound/item-1' });
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot(row({ schoolId: 'other' })) as never);
  await expect(lostFoundSource.getLostFoundItem('item-1', 'pu')).resolves.toBeNull();
});

test('same-school legacy records remain readable after a canonical miss', async () => {
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot(null) as never)
    .mockResolvedValueOnce(snapshot(row(), 'lostFoundItems/legacy-1') as never);
  await expect(lostFoundSource.getLostFoundItem('legacy-1', 'pu')).resolves.toMatchObject({
    id: 'legacy-1',
    schoolId: 'pu',
  });
  expect(getDocFromServer).toHaveBeenLastCalledWith({ path: 'lostFoundItems/legacy-1' });
});

test('a canonical read failure never masquerades as a successful fallback or an empty result', async () => {
  jest.mocked(getDocFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(lostFoundSource.getLostFoundItem('item-1', 'pu')).rejects.toThrow(
    'permission-denied',
  );
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
});

test('list merges both actual same-school collections with canonical IDs taking precedence', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce({ docs: [snapshot(row({ title: '最新版' }))] } as never)
    .mockResolvedValueOnce({
      docs: [
        snapshot(row({ title: '舊版' }), 'lostFoundItems/item-1'),
        snapshot(row(), 'lostFoundItems/legacy-2'),
      ],
    } as never);
  const rows = await lostFoundSource.listLostFoundItems('pu');
  expect(rows).toHaveLength(2);
  expect(rows.find((item) => item.id === 'item-1')?.title).toBe('最新版');
  expect(getDocsFromServer).toHaveBeenCalledWith(
    expect.objectContaining({ constraints: [['schoolId', '==', 'pu']] }),
  );
});

test('only the persisted owner can update; client identity fields cannot be rewritten', async () => {
  await lostFoundSource.updateLostFoundItem(
    'item-1',
    { title: '補充描述', reporterId: 'other', schoolId: 'other' },
    'pu',
  );
  expect(mockUpdate).toHaveBeenCalledWith(
    { path: 'schools/pu/lostFound/item-1' },
    { title: '補充描述', updatedAt: 'SERVER_TIMESTAMP' },
  );
  mockUpdate.mockClear();
  mockGet.mockResolvedValueOnce(snapshot(row({ userId: 'other', reporterId: 'other' })));
  await expect(
    lostFoundSource.updateLostFoundItem('item-1', { title: '不能修改' }, 'pu'),
  ).rejects.toThrow('只有發布者');
  expect(mockUpdate).not.toHaveBeenCalled();
});

test('legacy records missing rules ownership are not silently self-assigned', async () => {
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot(null) as never)
    .mockResolvedValueOnce(snapshot(row({ userId: undefined }), 'lostFoundItems/item-1') as never);
  mockGet.mockResolvedValueOnce(snapshot(row({ userId: undefined }), 'lostFoundItems/item-1'));
  await expect(lostFoundSource.resolveLostFoundItem('item-1', 'pu')).rejects.toThrow('只有發布者');
  expect(mockUpdate).not.toHaveBeenCalled();
});

test('lost-found cached source methods preserve the school argument and propagate failures', async () => {
  const get = jest.fn().mockRejectedValue(new Error('offline'));
  const list = jest.fn().mockRejectedValue(new Error('offline'));
  const source = createCachedSource({
    getLostFoundItem: get,
    listLostFoundItems: list,
  } as unknown as DataSource);
  await expect(source.getLostFoundItem('item-1', 'pu')).rejects.toThrow('offline');
  await expect(source.listLostFoundItems('pu')).rejects.toThrow('offline');
  expect(get).toHaveBeenCalledWith('item-1', 'pu');
  expect(list).toHaveBeenCalledWith('pu');
});
