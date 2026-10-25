import { beforeEach, expect, it, vi } from 'vitest';
import {
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
} from 'firebase/firestore';
import {
  canManageLostFoundItem,
  createLostFoundItem,
  formatLostFoundCalendarDate,
  getLostFoundItem,
  listLostFoundItems,
  newLostFoundItemId,
  resolveLostFoundItem,
  toTaipeiCalendarDateInput,
  todayTaipeiCalendarDate,
  updateLostFoundItem,
} from './lostFound';

const auth = vi.hoisted(() => ({ uid: 'alice' as string | null }));

vi.mock('@/lib/firebase', () => ({
  getDb: () => ({}),
  getAuth: () => ({ currentUser: auth.uid ? { uid: auth.uid } : null }),
  isFirebaseConfigured: () => true,
}));

vi.mock('firebase/firestore', () => ({
  collection: (root: unknown, ...parts: string[]) =>
    (typeof root === 'string' ? root + '/' : '') + parts.join('/'),
  doc: (root: unknown, ...parts: string[]) => {
    const path =
      typeof root === 'string' && parts.length === 0
        ? `${root}/generated-id`
        : (typeof root === 'string' ? root + '/' : '') + parts.join('/');
    return {
      path,
      id: parts.length ? parts[parts.length - 1]! : 'generated-id',
      toString() {
        return path;
      },
    };
  },
  query: (value: unknown) => value,
  where: () => null,
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: () => 'server-time',
}));

const document = (data: Record<string, unknown> | null, id = 'item-1', ref?: string) => ({
  id,
  exists: () => data !== null,
  data: () => data,
  ref: ref ?? `schools/pu/lostFound/${id}`,
});

const records: Record<string, Record<string, unknown> | null> = {};
function pathKey(path: unknown) {
  if (typeof path === 'string') return path;
  if (path && typeof path === 'object' && 'path' in path) return String((path as { path: string }).path);
  return String(path);
}

const transaction = {
  get: vi.fn(async (path: unknown) => {
    const key = pathKey(path);
    const id = key.split('/').pop()!;
    return document(records[key] ?? null, id, key);
  }),
  set: vi.fn((path: unknown, data: Record<string, unknown>) => {
    records[pathKey(path)] = { ...data };
  }),
  update: vi.fn((path: unknown, data: Record<string, unknown>) => {
    const key = pathKey(path);
    records[key] = { ...(records[key] ?? {}), ...data };
  }),
};

const baseFields = {
  type: 'lost' as const,
  title: '黑色雨傘',
  description: '圖書館門口遺失',
  category: 'other',
  location: '圖書館',
  date: '2026-10-20',
  contactInfo: 'mail@school.test',
};

function openItem(overrides: Record<string, unknown> = {}) {
  return {
    type: 'lost',
    title: '黑色雨傘',
    description: '圖書館門口遺失',
    category: 'other',
    location: '圖書館',
    date: '2026-10-20T00:00:00.000Z',
    contactInfo: 'mail@school.test',
    userId: 'alice',
    reporterId: 'alice',
    schoolId: 'pu',
    status: 'open',
    createdAt: '2026-10-20T01:00:00.000Z',
    updatedAt: '2026-10-20T02:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.uid = 'alice';
  for (const key of Object.keys(records)) delete records[key];
  transaction.get.mockImplementation(async (path: unknown) => {
    const key = pathKey(path);
    const id = key.split('/').pop()!;
    return document(records[key] ?? null, id, key);
  });
  let stampSeq = 2;
  const materialize = (data: Record<string, unknown>) => {
    const next = { ...data };
    if (next.createdAt === 'server-time') next.createdAt = '2026-10-20T01:00:00.000Z';
    if (next.updatedAt === 'server-time') {
      // Advance realistically so receipt-retry tests see a newer revision.
      next.updatedAt = `2026-10-20T${String(stampSeq).padStart(2, '0')}:00:00.000Z`;
      stampSeq += 1;
    }
    if (next.resolvedAt === 'server-time') {
      next.resolvedAt = `2026-10-20T${String(stampSeq).padStart(2, '0')}:00:00.000Z`;
      stampSeq += 1;
    }
    return next;
  };
  transaction.set.mockImplementation((path: unknown, data: Record<string, unknown>) => {
    records[pathKey(path)] = materialize(data);
  });
  transaction.update.mockImplementation((path: unknown, data: Record<string, unknown>) => {
    const key = pathKey(path);
    records[key] = materialize({ ...(records[key] ?? {}), ...data });
  });
  vi.mocked(runTransaction).mockImplementation(async (_db, callback) =>
    callback(transaction as never),
  );
  vi.mocked(getDocFromServer).mockImplementation(async (path) => {
    const key = pathKey(path);
    const id = key.split('/').pop()!;
    return document(records[key] ?? null, id, key) as never;
  });
  vi.mocked(getDocsFromServer).mockResolvedValue({ docs: [] } as never);
});

it('creates with a stable document id and confirms the server receipt', async () => {
  const item = await createLostFoundItem('pu', 'draft-1', baseFields);
  expect(pathKey(transaction.set.mock.calls[0]?.[0])).toBe('schools/pu/lostFound/draft-1');
  expect(transaction.set.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      title: '黑色雨傘',
      userId: 'alice',
      reporterId: 'alice',
      schoolId: 'pu',
      status: 'open',
    }),
  );
  expect(item.id).toBe('draft-1');
  expect(item.canonical).toBe(true);
});

it('reconciles a duplicate retry of the same create intent without writing again', async () => {
  records['schools/pu/lostFound/draft-1'] = openItem({
    date: new Date('2026-10-20').toISOString(),
    createdAt: '2026-10-20T01:00:00.000Z',
  });
  // Normalize date the same way create does
  records['schools/pu/lostFound/draft-1'] = openItem({
    date: new Date(baseFields.date).toISOString(),
    createdAt: '2026-10-20T01:00:00.000Z',
    updatedAt: undefined,
  });
  delete records['schools/pu/lostFound/draft-1']!.updatedAt;
  const item = await createLostFoundItem('pu', 'draft-1', baseFields);
  expect(transaction.set).not.toHaveBeenCalled();
  expect(item.title).toBe('黑色雨傘');
});

it('rejects a create retry when the same document id already holds different content', async () => {
  records['schools/pu/lostFound/draft-1'] = openItem({ title: '另一把傘' });
  await expect(createLostFoundItem('pu', 'draft-1', baseFields)).rejects.toThrow('不同內容');
  expect(transaction.set).not.toHaveBeenCalled();
});

it('reads legacy lostFoundItems when canonical is absent', async () => {
  vi.mocked(getDocFromServer)
    .mockResolvedValueOnce(document(null, 'legacy-1') as never)
    .mockResolvedValueOnce(
      document(
        openItem({
          userId: undefined,
          reporterId: 'alice',
          schoolId: 'pu',
        }),
        'legacy-1',
      ) as never,
    );
  const legacy = openItem({ schoolId: 'pu', userId: undefined });
  Reflect.deleteProperty(legacy, 'userId');
  vi.mocked(getDocFromServer)
    .mockReset()
    .mockResolvedValueOnce({
      id: 'legacy-1',
      exists: () => false,
      data: () => null,
      ref: 'schools/pu/lostFound/legacy-1',
    } as never)
    .mockResolvedValueOnce({
      id: 'legacy-1',
      exists: () => true,
      data: () => legacy,
      ref: 'lostFoundItems/legacy-1',
    } as never);

  const item = await getLostFoundItem('legacy-1', 'pu');
  expect(item?.canonical).toBe(false);
  expect(item?.userId).toBeUndefined();
  expect(item?.reporterId).toBe('alice');
  expect(canManageLostFoundItem(item!, 'alice')).toBe(false);
});

it('lists canonical over legacy when ids collide and keeps school scope', async () => {
  const legacyDoc = {
    id: 'shared',
    exists: () => true,
    data: () => openItem({ title: 'legacy', schoolId: 'pu', userId: 'alice' }),
    ref: 'lostFoundItems/shared',
  };
  const canonicalDoc = {
    id: 'shared',
    exists: () => true,
    data: () => openItem({ title: 'canonical', schoolId: 'pu', userId: 'alice' }),
    ref: 'schools/pu/lostFound/shared',
  };
  const otherSchool = {
    id: 'other',
    exists: () => true,
    data: () => openItem({ title: 'wrong school', schoolId: 'ntu', userId: 'alice' }),
    ref: 'lostFoundItems/other',
  };
  vi.mocked(getDocsFromServer)
    .mockResolvedValueOnce({ docs: [canonicalDoc] } as never)
    .mockResolvedValueOnce({ docs: [legacyDoc, otherSchool] } as never);
  const rows = await listLostFoundItems('pu');
  expect(rows).toHaveLength(1);
  expect(rows[0].title).toBe('canonical');
  expect(rows[0].canonical).toBe(true);
});

it('blocks update and resolve for unauthorized owners and school-mismatched reads', async () => {
  records['schools/pu/lostFound/item-1'] = openItem({ userId: 'bob', reporterId: 'bob' });
  await expect(
    updateLostFoundItem('item-1', 'pu', '2026-10-20T02:00:00.000Z', { title: '改標題' }),
  ).rejects.toThrow('只有發布者');
  expect(transaction.update).not.toHaveBeenCalled();

  await expect(
    resolveLostFoundItem('item-1', 'pu', '2026-10-20T02:00:00.000Z'),
  ).rejects.toThrow('只有發布者');

  vi.mocked(getDocFromServer).mockResolvedValueOnce({
    id: 'item-1',
    exists: () => true,
    data: () => openItem({ schoolId: 'ntu' }),
    ref: 'schools/pu/lostFound/item-1',
  } as never);
  // locate hits canonical first with wrong schoolId in data → null from readItem
  const mismatched = await getLostFoundItem('item-1', 'pu');
  // schoolId on row differs from requested school → null
  expect(mismatched).toBeNull();
});

it('does not allow editing reporterId-only legacy documents', async () => {
  const legacy = openItem({ userId: undefined });
  Reflect.deleteProperty(legacy, 'userId');
  records['lostFoundItems/legacy-1'] = legacy;
  transaction.get.mockImplementation(async (path: unknown) => {
    const key = pathKey(path);
    if (key.includes('lostFoundItems')) {
      return {
        id: 'legacy-1',
        exists: () => true,
        data: () => legacy,
        ref: 'lostFoundItems/legacy-1',
      };
    }
    return document(null, 'legacy-1');
  });
  vi.mocked(getDocFromServer)
    .mockReset()
    .mockResolvedValueOnce({
      id: 'legacy-1',
      exists: () => false,
      data: () => null,
      ref: 'schools/pu/lostFound/legacy-1',
    } as never)
    .mockResolvedValueOnce({
      id: 'legacy-1',
      exists: () => true,
      data: () => legacy,
      ref: 'lostFoundItems/legacy-1',
    } as never);

  await expect(
    updateLostFoundItem('legacy-1', 'pu', null, { title: '不可編輯' }),
  ).rejects.toThrow('只有發布者');
  expect(transaction.update).not.toHaveBeenCalled();
});

it('rejects concurrent edits when expectedUpdatedAt no longer matches', async () => {
  records['schools/pu/lostFound/item-1'] = openItem({
    updatedAt: '2026-10-21T00:00:00.000Z',
  });
  await expect(
    updateLostFoundItem('item-1', 'pu', '2026-10-20T02:00:00.000Z', {
      title: '較新內容已被他人更新',
    }),
  ).rejects.toThrow('其他操作更新');
  expect(transaction.update).not.toHaveBeenCalled();
});

it('updates and resolves with authoritative receipts', async () => {
  records['schools/pu/lostFound/item-1'] = openItem();
  const updated = await updateLostFoundItem('item-1', 'pu', '2026-10-20T02:00:00.000Z', {
    title: '黑色折疊傘',
  });
  expect(pathKey(transaction.update.mock.calls[0]?.[0])).toBe('schools/pu/lostFound/item-1');
  expect(transaction.update.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ title: '黑色折疊傘', updatedAt: 'server-time' }),
  );
  expect(updated.title).toBe('黑色折疊傘');

  records['schools/pu/lostFound/item-1'] = openItem({
    title: '黑色折疊傘',
    updatedAt: '2026-10-20T03:00:00.000Z',
  });
  const resolved = await resolveLostFoundItem('item-1', 'pu', '2026-10-20T03:00:00.000Z');
  expect(transaction.update.mock.calls.at(-1)?.[1]).toEqual(
    expect.objectContaining({ status: 'resolved' }),
  );
  expect(resolved.status).toBe('resolved');
});

it('fences create when the account switches before receipt confirmation', async () => {
  vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
    await callback(transaction as never);
    auth.uid = 'bob';
  });
  await expect(createLostFoundItem('pu', 'draft-1', baseFields)).rejects.toThrow('帳號已切換');
});

it('surfaces unconfirmed writes when the receipt cannot be read back', async () => {
  vi.mocked(getDocFromServer).mockRejectedValueOnce(new Error('network'));
  await expect(createLostFoundItem('pu', 'draft-1', baseFields)).rejects.toThrow('無法讀回確認');
});

it('allocates document ids under the school collection path', () => {
  expect(newLostFoundItemId('pu')).toBe('generated-id');
});

it('requires sign-in for list reads', async () => {
  auth.uid = null;
  await expect(listLostFoundItems('pu')).rejects.toMatchObject({ code: 'permission-denied' });
});

it('can retry an edit after its commit succeeds but receipt read fails', async () => {
  const path = 'schools/pu/lostFound/item-1';
  records[path] = openItem({ updatedAt: '2026-10-20T01:00:00.000Z' });
  const read = vi.mocked(getDocFromServer);
  read
    .mockImplementationOnce(async () => document(records[path], 'item-1', path) as never)
    .mockRejectedValueOnce(new Error('receipt lost'));
  await expect(
    updateLostFoundItem('item-1', 'pu', '2026-10-20T01:00:00.000Z', {
      title: '同一個已提交的編輯',
    }),
  ).rejects.toThrow('無法讀回確認');
  expect(records[path]?.title).toBe('同一個已提交的編輯');
  expect(records[path]?.updatedAt).not.toBe('2026-10-20T01:00:00.000Z');
  await expect(
    updateLostFoundItem('item-1', 'pu', '2026-10-20T01:00:00.000Z', {
      title: '同一個已提交的編輯',
    }),
  ).resolves.toMatchObject({ title: '同一個已提交的編輯' });
});

it('can retry resolve after its commit succeeds but receipt read fails', async () => {
  const path = 'schools/pu/lostFound/item-1';
  records[path] = openItem({ updatedAt: '2026-10-20T01:00:00.000Z' });
  vi.mocked(getDocFromServer)
    .mockImplementationOnce(async () => document(records[path], 'item-1', path) as never)
    .mockRejectedValueOnce(new Error('receipt lost'));
  await expect(
    resolveLostFoundItem('item-1', 'pu', '2026-10-20T01:00:00.000Z'),
  ).rejects.toThrow('無法讀回確認');
  expect(records[path]?.status).toBe('resolved');
  await expect(
    resolveLostFoundItem('item-1', 'pu', '2026-10-20T01:00:00.000Z'),
  ).resolves.toMatchObject({ status: 'resolved' });
});

it('rejects a stale edit retry when the server holds a genuinely different newer intent', async () => {
  const path = 'schools/pu/lostFound/item-1';
  records[path] = openItem({
    title: '別人剛改的標題',
    updatedAt: '2026-10-20T05:00:00.000Z',
  });
  await expect(
    updateLostFoundItem('item-1', 'pu', '2026-10-20T01:00:00.000Z', {
      title: '我的舊編輯',
    }),
  ).rejects.toThrow('其他操作更新');
  expect(transaction.update).not.toHaveBeenCalled();
});

it('an explicit empty contact removes the old contact', async () => {
  const path = 'schools/pu/lostFound/item-1';
  records[path] = openItem();
  const receipt = await updateLostFoundItem('item-1', 'pu', '2026-10-20T02:00:00.000Z', {
    title: '黑色折疊傘',
    contactInfo: '',
  });
  expect(transaction.update.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ contactInfo: '', title: '黑色折疊傘' }),
  );
  expect(receipt.contactInfo ?? '').toBe('');
  expect(records[path]?.contactInfo).toBe('');
});

it('lists the complete collection without a silent 100-row cap', async () => {
  const docs = Array.from({ length: 101 }, (_, index) => ({
    id: `item-${index}`,
    exists: () => true,
    data: () =>
      openItem({
        title: `物品 ${index}`,
        userId: index === 100 ? 'alice' : 'other',
        reporterId: index === 100 ? 'alice' : 'other',
        createdAt: `2026-10-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    ref: `schools/pu/lostFound/item-${index}`,
  }));
  vi.mocked(getDocsFromServer)
    .mockResolvedValueOnce({ docs } as never)
    .mockResolvedValueOnce({ docs: [] } as never);
  const rows = await listLostFoundItems('pu');
  expect(rows).toHaveLength(101);
  expect(rows.some((row) => row.id === 'item-100' && row.userId === 'alice')).toBe(true);
});

it('formats calendar dates in Taipei without inventing a clock time', () => {
  expect(formatLostFoundCalendarDate('2026-10-24')).toBe('2026/10/24');
  expect(formatLostFoundCalendarDate('2026-10-24T00:00:00.000Z')).toBe('2026/10/24');
  // Stored UTC midnight is still the Taipei calendar day of that instant.
  expect(toTaipeiCalendarDateInput('2026-10-23T16:00:00.000Z')).toBe('2026-10-24');
});

it('defaults today with the Taiwan calendar day around the midnight boundary', () => {
  // 2026-10-24 00:30 in Taipei == 2026-10-23 16:30 UTC
  const taipeiEarly = new Date('2026-10-23T16:30:00.000Z');
  expect(todayTaipeiCalendarDate(taipeiEarly)).toBe('2026-10-24');
  // UTC ISO slice would wrongly yield 2026-10-23.
  expect(taipeiEarly.toISOString().slice(0, 10)).toBe('2026-10-23');
});
