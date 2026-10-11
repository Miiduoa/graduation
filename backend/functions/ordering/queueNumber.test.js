'use strict';

const SERVER_TIME = { serverTimestamp: true };
let mockNow = new Date();
const mockStore = new Map();

function mockMaterialize(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) out[key] = value === SERVER_TIME ? new Date(mockNow) : value;
  return out;
}

function mockDocRef(path) {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name) => mockCollectionRef(`${path}/${name}`),
  };
}

function mockSnap(path) {
  const data = mockStore.get(path);
  return { exists: data !== undefined, id: path.split('/').pop(), ref: mockDocRef(path), data: () => data };
}

function mockCollectionRef(path, filters = [], max = Infinity) {
  return {
    doc: (id) => mockDocRef(`${path}/${id}`),
    where: (field, op, value) => mockCollectionRef(path, [...filters, [field, op, value]], max),
    limit: (count) => mockCollectionRef(path, filters, count),
    get: async () => {
      const depth = path.split('/').length + 1;
      const docs = [...mockStore.keys()]
        .filter((key) => key.startsWith(`${path}/`) && key.split('/').length === depth)
        .map(mockSnap)
        .filter((snap) =>
          filters.every(([field, op, value]) => {
            const actual = snap.data()[field];
            if (op === '<') return actual < value;
            if (op === '==') return actual === value;
            throw new Error(`unsupported op ${op}`);
          }),
        )
        .slice(0, max);
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}

const mockDb = {
  collection: (name) => mockCollectionRef(name),
  runTransaction: async (fn) => {
    const writes = [];
    const tx = {
      get: async (ref) => mockSnap(ref.path),
      set: (ref, data, options) => writes.push({ ref, data, options }),
    };
    const result = await fn(tx);
    for (const { ref, data, options } of writes) {
      const value = mockMaterialize(data);
      mockStore.set(ref.path, options?.merge ? { ...mockStore.get(ref.path), ...value } : value);
    }
    return result;
  },
  batch: () => {
    const deletes = [];
    return {
      delete: (ref) => deletes.push(ref.path),
      commit: async () => deletes.forEach((path) => mockStore.delete(path)),
    };
  },
};

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockDb,
  FieldValue: { serverTimestamp: () => SERVER_TIME },
}));

const { allocateQueueSerial, runDailyQueueReset } = require('./queueNumber');

const taipei = (text) => new Date(`${text}+08:00`);
async function issueAt(text, vendorId = 'v1') {
  mockNow = taipei(text);
  return allocateQueueSerial(mockDb, { schoolId: 'pu', vendorId, now: mockNow });
}
const counters = 'schools/pu/queueCounters';

beforeEach(() => {
  mockStore.clear();
  mockStore.set('schools/pu', { name: '靜宜' });
});

test('台灣早上 7:59 和 8:01 是同一天，號碼接著發（003 → 004），不在 UTC 換日時歸零', async () => {
  expect(await issueAt('2026-10-13T07:00:00')).toBe(1);
  expect(await issueAt('2026-10-13T07:30:00')).toBe(2);
  expect(await issueAt('2026-10-13T07:59:00')).toBe(3);
  expect(await issueAt('2026-10-13T08:01:00')).toBe(4);
  expect(mockStore.get(`${counters}/v1__tpe__2026-10-13`)).toMatchObject({ date: '2026-10-13', nextSerial: 4 });
});

test('台灣 23:59 到隔天 00:01 換日，號碼從 1 開始', async () => {
  expect(await issueAt('2026-10-13T23:50:00')).toBe(1);
  expect(await issueAt('2026-10-13T23:59:00')).toBe(2);
  expect(await issueAt('2026-10-14T00:01:00')).toBe(1);
  expect(await issueAt('2026-10-14T00:02:00')).toBe(2);
});

test('不同店各自計數', async () => {
  expect(await issueAt('2026-10-13T12:00:00', 'v1')).toBe(1);
  expect(await issueAt('2026-10-13T12:01:00', 'v2')).toBe(1);
  expect(await issueAt('2026-10-13T12:02:00', 'v1')).toBe(2);
});

describe('換版當天：同一個台灣日期不重號', () => {
  test('今天凌晨記在前一天 UTC 鍵、8 點後記在當天 UTC 鍵：新鍵從兩個裡最大的接著發', async () => {
    // 台灣 10/13 03:00 發到 12 號（舊版記在 UTC 10/12）
    mockStore.set(`${counters}/v1__2026-10-12`, { date: '2026-10-12', nextSerial: 12, updatedAt: taipei('2026-10-13T03:00:00') });
    // 台灣 10/13 08:00 以後舊版在 UTC 10/13 從 1 重新發到 5
    mockStore.set(`${counters}/v1__2026-10-13`, { date: '2026-10-13', nextSerial: 5, updatedAt: taipei('2026-10-13T09:00:00') });
    expect(await issueAt('2026-10-13T10:00:00')).toBe(13);
    expect(await issueAt('2026-10-13T10:01:00')).toBe(14);
  });

  test('前一天 UTC 鍵最後一次更新在昨天（台灣時間）：那些號是昨天的，今天從 1 開始', async () => {
    mockStore.set(`${counters}/v1__2026-10-12`, { date: '2026-10-12', nextSerial: 40, updatedAt: taipei('2026-10-12T20:00:00') });
    expect(await issueAt('2026-10-13T10:00:00')).toBe(1);
  });

  test('換版那一刻還在跑的舊版請求又發了號：新版下一號接在它後面', async () => {
    mockStore.set(`${counters}/v1__2026-10-13`, { date: '2026-10-13', nextSerial: 5, updatedAt: taipei('2026-10-13T09:00:00') });
    expect(await issueAt('2026-10-13T10:00:00')).toBe(6);
    // 舊版寫進舊鍵 7 號
    mockStore.set(`${counters}/v1__2026-10-13`, { date: '2026-10-13', nextSerial: 7, updatedAt: taipei('2026-10-13T10:00:05') });
    expect(await issueAt('2026-10-13T10:00:10')).toBe(8);
  });

  test('舊鍵沒有 updatedAt：保守算進今天', async () => {
    mockStore.set(`${counters}/v1__2026-10-13`, { date: '2026-10-13', nextSerial: 9 });
    expect(await issueAt('2026-10-13T10:00:00')).toBe(10);
  });

  test('隔天舊鍵都不算：新的一天從 1 開始', async () => {
    mockStore.set(`${counters}/v1__2026-10-13`, { date: '2026-10-13', nextSerial: 30, updatedAt: taipei('2026-10-13T23:00:00') });
    expect(await issueAt('2026-10-14T00:01:00')).toBe(1);
  });
});

test('每日清理：台灣日期比今天早的新鍵和舊 UTC 鍵都清掉，今天的留著', async () => {
  mockStore.set(`${counters}/v1__2026-10-12`, { date: '2026-10-12', nextSerial: 3 });
  mockStore.set(`${counters}/v1__2026-10-13`, { date: '2026-10-13', nextSerial: 4 });
  mockStore.set(`${counters}/v1__tpe__2026-10-13`, { date: '2026-10-13', nextSerial: 20 });
  mockStore.set(`${counters}/v1__tpe__2026-10-14`, { date: '2026-10-14', nextSerial: 1 });
  const deleted = await runDailyQueueReset(mockDb, taipei('2026-10-14T00:05:00'));
  expect(deleted).toBe(3);
  expect([...mockStore.keys()].filter((key) => key.startsWith(counters))).toEqual([`${counters}/v1__tpe__2026-10-14`]);
});
