import {
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
} from 'firebase/firestore';
import { lostFoundSource, allocateLostFoundDocumentId } from '../../data/lostFoundSource';
import { createCachedSource } from '../../data/cachedSource';
import type { DataSource } from '../../data/source';
import { canManageLostFoundItem } from '../../data/lostFoundMeta';

let mockUid: string | null = 'owner';
let clock = { seconds: 1_700_000_000, nanoseconds: 0 };

jest.mock('../../firebase', () => ({
  getDb: () => ({}),
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
}));

jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    id: 'generated-id',
  }),
  doc: (root: unknown, ...parts: string[]) => {
    if (parts.length === 0 && root && typeof root === 'object' && 'path' in (root as object)) {
      const path = `${(root as { path: string }).path}/generated-id`;
      return { path, id: 'generated-id' };
    }
    const path = parts.join('/');
    return { path, id: parts[parts.length - 1] ?? 'generated-id' };
  },
  query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
  where: (...parts: unknown[]) => parts,
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
  runTransaction: jest.fn(),
  serverTimestamp: () => ({ __server: true }),
  deleteField: () => ({ __delete: true }),
}));

const records: Record<string, Record<string, unknown> | null> = {};

function pathKey(path: unknown) {
  if (typeof path === 'string') return path;
  if (path && typeof path === 'object' && 'path' in path) return String((path as { path: string }).path);
  return String(path);
}

function stamp() {
  clock.nanoseconds += 1;
  if (clock.nanoseconds >= 1_000_000_000) {
    clock.seconds += 1;
    clock.nanoseconds = 0;
  }
  return { seconds: clock.seconds, nanoseconds: clock.nanoseconds };
}

function materialize(data: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__delete' in (value as object)) continue;
    if (value && typeof value === 'object' && '__server' in (value as object)) {
      next[key] = stamp();
      continue;
    }
    next[key] = value;
  }
  return next;
}

function snapshot(data: Record<string, unknown> | null, path: string) {
  return {
    id: path.split('/').at(-1),
    exists: () => data !== null,
    data: () => data,
    ref: { path },
  };
}

const transaction = {
  get: jest.fn(async (path: unknown) => {
    const key = pathKey(path);
    return snapshot(records[key] ?? null, key);
  }),
  set: jest.fn((path: unknown, data: Record<string, unknown>) => {
    records[pathKey(path)] = materialize(data);
  }),
  update: jest.fn((path: unknown, data: Record<string, unknown>) => {
    const key = pathKey(path);
    const current = { ...(records[key] ?? {}) };
    for (const [field, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && '__delete' in (value as object)) {
        delete current[field];
        continue;
      }
      if (value && typeof value === 'object' && '__server' in (value as object)) {
        current[field] = stamp();
        continue;
      }
      current[field] = value;
    }
    records[key] = current;
  }),
};

function openItem(overrides: Record<string, unknown> = {}) {
  return {
    type: 'lost',
    title: '筆記本',
    description: '這是綠色封面的課程筆記本',
    category: 'books',
    location: '圖書館',
    date: '2026-10-08',
    createdAt: { seconds: 1_700_000_000, nanoseconds: 1 },
    updatedAt: { seconds: 1_700_000_100, nanoseconds: 5 },
    schoolId: 'pu',
    userId: 'owner',
    reporterId: 'owner',
    status: 'open',
    contactInfo: 'mail@school.test',
    ...overrides,
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
  contactInfo: 'mail@school.test',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'owner';
  clock = { seconds: 1_700_000_000, nanoseconds: 0 };
  for (const key of Object.keys(records)) delete records[key];
  transaction.get.mockImplementation(async (path: unknown) => {
    const key = pathKey(path);
    return snapshot(records[key] ?? null, key);
  });
  transaction.set.mockImplementation((path: unknown, data: Record<string, unknown>) => {
    records[pathKey(path)] = materialize(data);
  });
  transaction.update.mockImplementation((path: unknown, data: Record<string, unknown>) => {
    const key = pathKey(path);
    const current = { ...(records[key] ?? {}) };
    for (const [field, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && '__delete' in (value as object)) {
        delete current[field];
        continue;
      }
      if (value && typeof value === 'object' && '__server' in (value as object)) {
        current[field] = stamp();
        continue;
      }
      current[field] = value;
    }
    records[key] = current;
  });
  jest.mocked(runTransaction).mockImplementation(async (_db, update) => update(transaction as never));
  jest.mocked(getDocFromServer).mockImplementation(async (path) => {
    const key = pathKey(path);
    return snapshot(records[key] ?? null, key) as never;
  });
  jest.mocked(getDocsFromServer).mockResolvedValue({ docs: [] } as never);
});

test('creates with a stable document id and confirms the server receipt', async () => {
  const result = await lostFoundSource.createLostFoundItem(input, { documentId: 'draft-1' });
  expect(pathKey(transaction.set.mock.calls[0]?.[0])).toBe('schools/pu/lostFound/draft-1');
  expect(transaction.set.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      userId: 'owner',
      reporterId: 'owner',
      schoolId: 'pu',
      status: 'open',
      date: '2026-10-08',
    }),
  );
  expect(result.id).toBe('draft-1');
  expect(result.reporterId).toBe('owner');
  expect((result as { canonical?: boolean }).canonical).toBe(true);
});

test('cannot publish for someone else or without an explicit school', async () => {
  await expect(
    lostFoundSource.createLostFoundItem({ ...input, reporterId: 'other' }, { documentId: 'x' }),
  ).rejects.toThrow('無法代其他帳號發布');
  await expect(
    lostFoundSource.createLostFoundItem({ ...input, schoolId: undefined }, { documentId: 'x' }),
  ).rejects.toThrow('範圍');
  expect(transaction.set).not.toHaveBeenCalled();
});

test('ack-loss after a committed create still succeeds when authoritative readback matches', async () => {
  jest.mocked(runTransaction).mockImplementationOnce(async (_db, update) => {
    await update(transaction as never);
    throw Object.assign(new Error('ack-loss'), { code: 'unavailable' });
  });
  const result = await lostFoundSource.createLostFoundItem(input, { documentId: 'draft-1' });
  expect(result.id).toBe('draft-1');
  expect(transaction.set).toHaveBeenCalledTimes(1);
});

test('stable create after ack-loss with missing receipt retries same id with one actual write', async () => {
  let writes = 0;
  jest.mocked(runTransaction).mockImplementation(async (_db, update) => {
    await update(transaction as never);
    writes += 1;
    if (writes === 1) throw new Error('ack-loss');
  });
  jest.mocked(getDocFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(
    lostFoundSource.createLostFoundItem(input, { documentId: 'draft-1' }),
  ).rejects.toMatchObject({ code: 'lost-found-write-unconfirmed' });
  expect(writes).toBe(1);
  expect(records['schools/pu/lostFound/draft-1']).toBeTruthy();

  transaction.set.mockClear();
  const again = await lostFoundSource.createLostFoundItem(input, { documentId: 'draft-1' });
  // Transaction may re-read for reconciliation, but must not perform another set.
  expect(transaction.set).not.toHaveBeenCalled();
  expect(again.title).toBe('筆記本');
});

test('rejects a create retry when the same document id already holds different content', async () => {
  records['schools/pu/lostFound/draft-1'] = openItem({ title: '另一本' });
  await expect(
    lostFoundSource.createLostFoundItem(input, { documentId: 'draft-1' }),
  ).rejects.toThrow('不同內容');
  expect(transaction.set).not.toHaveBeenCalled();
});

test('account switches while creating a post cannot return a success for the old user', async () => {
  jest.mocked(runTransaction).mockImplementationOnce(async (_db, update) => {
    await update(transaction as never);
    mockUid = 'new-user';
  });
  await expect(
    lostFoundSource.createLostFoundItem(input, { documentId: 'draft-1' }),
  ).rejects.toThrow('帳號已切換');
});

test('detail uses the same canonical path as creation and rejects cross-school records', async () => {
  records['schools/pu/lostFound/item-1'] = openItem();
  await lostFoundSource.getLostFoundItem('item-1', 'pu');
  expect(getDocFromServer).toHaveBeenCalledWith({ path: 'schools/pu/lostFound/item-1', id: 'item-1' });
  records['schools/pu/lostFound/item-1'] = openItem({ schoolId: 'other' });
  await expect(lostFoundSource.getLostFoundItem('item-1', 'pu')).resolves.toBeNull();
});

test('same-school legacy records remain readable after a canonical miss', async () => {
  const legacy = openItem({ userId: undefined });
  Reflect.deleteProperty(legacy, 'userId');
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot(null, 'schools/pu/lostFound/legacy-1') as never)
    .mockResolvedValueOnce(snapshot(legacy, 'lostFoundItems/legacy-1') as never);
  const item = await lostFoundSource.getLostFoundItem('legacy-1', 'pu');
  expect(item).toMatchObject({ id: 'legacy-1', schoolId: 'pu', reporterId: 'owner' });
  expect((item as { userId?: string }).userId).toBeUndefined();
  expect((item as { migrationReadOnly?: boolean }).migrationReadOnly).toBe(true);
  expect(canManageLostFoundItem(item as never, 'owner')).toBe(false);
});

test('canonical metadata mismatch rejects; reporter-only legacy mutations are refused', async () => {
  records['schools/pu/lostFound/bad'] = openItem({ userId: 'owner', reporterId: 'other' });
  await expect(lostFoundSource.getLostFoundItem('bad', 'pu')).rejects.toThrow('發布者');

  const legacy = openItem({ userId: undefined });
  Reflect.deleteProperty(legacy, 'userId');
  records['lostFoundItems/legacy-1'] = legacy;
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot(null, 'schools/pu/lostFound/legacy-1') as never)
    .mockResolvedValueOnce(snapshot(legacy, 'lostFoundItems/legacy-1') as never);
  transaction.get.mockImplementation(async (path: unknown) => {
    const key = pathKey(path);
    if (key.includes('lostFoundItems')) return snapshot(legacy, key);
    return snapshot(null, key);
  });
  await expect(
    lostFoundSource.updateLostFoundItem('legacy-1', { title: '不可' }, 'pu', {
      expectedRevision: null,
    }),
  ).rejects.toThrow('只有發布者');
  expect(transaction.update).not.toHaveBeenCalled();
});

test('a canonical read failure never masquerades as a successful fallback or an empty result', async () => {
  jest.mocked(getDocFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(lostFoundSource.getLostFoundItem('item-1', 'pu')).rejects.toThrow(
    'permission-denied',
  );
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
});

test('unsigned reads fail before hitting Firestore', async () => {
  mockUid = null;
  await expect(lostFoundSource.listLostFoundItems('pu')).rejects.toMatchObject({
    code: 'permission-denied',
  });
  await expect(lostFoundSource.getLostFoundItem('item-1', 'pu')).rejects.toMatchObject({
    code: 'permission-denied',
  });
  expect(getDocsFromServer).not.toHaveBeenCalled();
  expect(getDocFromServer).not.toHaveBeenCalled();
});

test('list merges both actual same-school collections with canonical IDs taking precedence', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce({
      docs: [snapshot(openItem({ title: '最新版' }), 'schools/pu/lostFound/item-1')],
    } as never)
    .mockResolvedValueOnce({
      docs: [
        snapshot(openItem({ title: '舊版' }), 'lostFoundItems/item-1'),
        snapshot(openItem(), 'lostFoundItems/legacy-2'),
      ],
    } as never);
  const rows = await lostFoundSource.listLostFoundItems('pu');
  expect(rows).toHaveLength(2);
  expect(rows.find((item) => item.id === 'item-1')?.title).toBe('最新版');
});

test('only the persisted owner can update; unauthorized userId and other school are blocked', async () => {
  records['schools/pu/lostFound/item-1'] = openItem();
  await lostFoundSource.updateLostFoundItem(
    'item-1',
    { title: '補充描述', reporterId: 'other', schoolId: 'other' },
    'pu',
    { expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 } },
  );
  expect(transaction.update).toHaveBeenCalled();
  expect(records['schools/pu/lostFound/item-1']?.title).toBe('補充描述');

  transaction.update.mockClear();
  records['schools/pu/lostFound/item-1'] = openItem({ userId: 'other', reporterId: 'other' });
  await expect(
    lostFoundSource.updateLostFoundItem('item-1', { title: '不能修改' }, 'pu', {
      expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 },
    }),
  ).rejects.toThrow('只有發布者');
  expect(transaction.update).not.toHaveBeenCalled();
});

test('edit conflict vs original base; same-intent retry after ack-loss writes once', async () => {
  records['schools/pu/lostFound/item-1'] = openItem({
    updatedAt: { seconds: 1_700_000_200, nanoseconds: 9 },
  });
  await expect(
    lostFoundSource.updateLostFoundItem(
      'item-1',
      { title: '較舊的編輯' },
      'pu',
      { expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 } },
    ),
  ).rejects.toThrow('其他操作更新');
  expect(transaction.update).not.toHaveBeenCalled();

  records['schools/pu/lostFound/item-1'] = openItem();
  let writes = 0;
  jest.mocked(runTransaction).mockImplementation(async (_db, update) => {
    await update(transaction as never);
    writes += 1;
    if (writes === 1) throw new Error('ack-loss');
  });
  jest.mocked(getDocFromServer).mockImplementation(async (path) => {
    const key = pathKey(path);
    if (writes === 1 && key.endsWith('item-1')) throw new Error('offline');
    return snapshot(records[key] ?? null, key) as never;
  });
  await expect(
    lostFoundSource.updateLostFoundItem(
      'item-1',
      { title: '補上特徵' },
      'pu',
      { expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 } },
    ),
  ).rejects.toMatchObject({ code: 'lost-found-write-unconfirmed' });
  expect(writes).toBe(1);
  expect(records['schools/pu/lostFound/item-1']?.title).toBe('補上特徵');

  jest.mocked(getDocFromServer).mockImplementation(async (path) => {
    const key = pathKey(path);
    return snapshot(records[key] ?? null, key) as never;
  });
  transaction.update.mockClear();
  const receipt = await lostFoundSource.updateLostFoundItem(
    'item-1',
    { title: '補上特徵' },
    'pu',
    { expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 } },
  );
  expect(transaction.update).not.toHaveBeenCalled();
  expect(receipt.title).toBe('補上特徵');
});

test('newer different change is rejected instead of overwritten', async () => {
  records['schools/pu/lostFound/item-1'] = openItem({
    title: '別人剛改的標題',
    updatedAt: { seconds: 1_700_000_300, nanoseconds: 1 },
  });
  await expect(
    lostFoundSource.updateLostFoundItem(
      'item-1',
      { title: '我的舊意圖' },
      'pu',
      { expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 } },
    ),
  ).rejects.toThrow('其他操作更新');
});

test('empty contactInfo intentionally clears the stored field', async () => {
  records['schools/pu/lostFound/item-1'] = openItem();
  const updated = await lostFoundSource.updateLostFoundItem(
    'item-1',
    { contactInfo: '' },
    'pu',
    { expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 } },
  );
  expect(records['schools/pu/lostFound/item-1']?.contactInfo).toBeUndefined();
  expect(updated.contactInfo).toBeUndefined();
});

test('resolve commit receipt lost then same-intent retry writes once; owner already-resolved is no-write reconciliation', async () => {
  records['schools/pu/lostFound/item-1'] = openItem();
  let writes = 0;
  jest.mocked(runTransaction).mockImplementation(async (_db, update) => {
    await update(transaction as never);
    writes += 1;
    if (writes === 1) throw new Error('ack-loss');
  });
  jest.mocked(getDocFromServer).mockImplementation(async (path) => {
    const key = pathKey(path);
    if (writes === 1 && key.endsWith('item-1')) throw new Error('offline');
    return snapshot(records[key] ?? null, key) as never;
  });
  await expect(
    lostFoundSource.resolveLostFoundItem('item-1', 'pu', {
      expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 },
    }),
  ).rejects.toMatchObject({ code: 'lost-found-write-unconfirmed' });
  expect(writes).toBe(1);
  expect(records['schools/pu/lostFound/item-1']?.status).toBe('resolved');

  jest.mocked(getDocFromServer).mockImplementation(async (path) => {
    const key = pathKey(path);
    return snapshot(records[key] ?? null, key) as never;
  });
  transaction.update.mockClear();
  await lostFoundSource.resolveLostFoundItem('item-1', 'pu', {
    expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 },
  });
  expect(transaction.update).not.toHaveBeenCalled();

  // Web (or prior App) already resolved with advanced timestamp: owner no-op, not a foreign action.
  records['schools/pu/lostFound/item-1'] = openItem({
    status: 'resolved',
    updatedAt: { seconds: 1_700_000_400, nanoseconds: 42 },
  });
  transaction.update.mockClear();
  await lostFoundSource.resolveLostFoundItem('item-1', 'pu', {
    expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 },
  });
  expect(transaction.update).not.toHaveBeenCalled();
  expect((await lostFoundSource.getLostFoundItem('item-1', 'pu'))?.status).toBe('resolved');
  expect((await lostFoundSource.getLostFoundItem('item-1', 'pu'))?.userId).toBe('owner');
});

test('owner-authorized returned row reconciles resolve without resolveBase metadata', async () => {
  records['schools/pu/lostFound/item-1'] = openItem({
    status: 'returned',
    updatedAt: { seconds: 1_700_000_500, nanoseconds: 7 },
  });
  transaction.update.mockClear();
  await lostFoundSource.resolveLostFoundItem('item-1', 'pu', {
    expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 },
  });
  expect(transaction.update).not.toHaveBeenCalled();
  expect((await lostFoundSource.getLostFoundItem('item-1', 'pu'))?.status).toBe('returned');
});

test('stale resolve while row is still open with newer revision is a conflict', async () => {
  records['schools/pu/lostFound/item-1'] = openItem({
    updatedAt: { seconds: 1_700_000_300, nanoseconds: 9 },
  });
  await expect(
    lostFoundSource.resolveLostFoundItem('item-1', 'pu', {
      expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 },
    }),
  ).rejects.toThrow('其他操作更新');
  expect(transaction.update).not.toHaveBeenCalled();
});

test('returned/expired same-content rows refuse edit same-state shortcut', async () => {
  for (const status of ['returned', 'expired'] as const) {
    records['schools/pu/lostFound/item-1'] = openItem({
      status,
      title: '筆記本',
      updatedAt: { seconds: 1_700_000_600, nanoseconds: 1 },
    });
    transaction.update.mockClear();
    await expect(
      lostFoundSource.updateLostFoundItem(
        'item-1',
        { title: '筆記本' },
        'pu',
        { expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 } },
      ),
    ).rejects.toThrow('已結案');
    expect(transaction.update).not.toHaveBeenCalled();
  }
});

test('transaction rejection after commit is recoverable via receipt for create/edit/resolve', async () => {
  // Create
  let writes = 0;
  jest.mocked(runTransaction).mockImplementation(async (_db, update) => {
    await update(transaction as never);
    writes += 1;
    throw new Error('NETWORK_AFTER_COMMIT');
  });
  const created = await lostFoundSource.createLostFoundItem(input, { documentId: 'stable-ack' });
  expect(created.id).toBe('stable-ack');
  expect(writes).toBe(1);

  // Edit
  records['schools/pu/lostFound/item-1'] = openItem();
  writes = 0;
  const edited = await lostFoundSource.updateLostFoundItem(
    'item-1',
    { title: '補上特徵後的標題' },
    'pu',
    { expectedRevision: { seconds: 1_700_000_100, nanoseconds: 5 } },
  );
  expect(edited.title).toBe('補上特徵後的標題');
  expect(writes).toBe(1);

  // Resolve
  records['schools/pu/lostFound/item-1'] = openItem({
    updatedAt: { seconds: 1_700_000_700, nanoseconds: 3 },
  });
  writes = 0;
  await lostFoundSource.resolveLostFoundItem('item-1', 'pu', {
    expectedRevision: { seconds: 1_700_000_700, nanoseconds: 3 },
  });
  expect(records['schools/pu/lostFound/item-1']?.status).toBe('resolved');
  expect(writes).toBe(1);
});

test('scope predicate failures fence writes before success', async () => {
  await expect(
    lostFoundSource.createLostFoundItem(input, {
      documentId: 'draft-1',
      assertCurrentScope: async () => false,
    }),
  ).rejects.toThrow('切換');
  expect(transaction.set).not.toHaveBeenCalled();
});

test('allocates document ids under the school collection path', () => {
  expect(allocateLostFoundDocumentId('pu')).toBe('generated-id');
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
