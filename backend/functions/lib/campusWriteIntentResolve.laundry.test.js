'use strict';

const mockDocuments = new Map();
const mockReads = [];
let mockReadError = false;

function mockCollection(path, filters = [], maximum = Infinity) {
  return {
    doc: (id) => ({
      collection: (name) => mockCollection(`${path}/${id}/${name}`),
      get: async () => {
        mockReads.push(`${path}/${id}`);
        if (mockReadError) throw new Error('unavailable');
        const data = mockDocuments.get(`${path}/${id}`);
        return { id, exists: data !== undefined, data: () => data };
      },
    }),
    where: (field, op, value) => mockCollection(path, [...filters, { field, op, value }], maximum),
    limit: (count) => mockCollection(path, filters, count),
    get: async () => {
      mockReads.push(path);
      if (mockReadError) throw new Error('unavailable');
      const docs = [...mockDocuments]
        .filter(([key, data]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/') &&
          filters.every(({ field, op, value }) => op === '==' && data[field] === value))
        .slice(0, maximum)
        .map(([key, data]) => ({ id: key.split('/').pop(), data: () => data }));
      return { docs, empty: docs.length === 0 };
    },
  };
}

jest.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: mockCollection }) }));
const { resolveWashReserveInput } = require('./campusWriteIntentResolve');
const path = (id, school = 'pu') => `schools/${school}/washingMachines/${id}`;
const reserve = (selector = '') => resolveWashReserveInput(`幫我預約明天晚上八點洗衣機 ${selector}`, 'pu');

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-17T04:00:00Z'));
  mockDocuments.clear();
  mockReads.length = 0;
  mockReadError = false;
  mockDocuments.set(path('A1'), { status: 'available', dormitory: 'A' });
  mockDocuments.set(path('A2'), { status: 'available', dormitory: 'A' });
});
afterEach(() => jest.useRealTimers());

test.each(['A2', 'A2 A2', 'A棟 A2', '「A2」'])('honors the exact ID %s instead of the first available machine', async (selector) => {
  expect(await reserve(selector)).toMatchObject({ machineId: 'A2', dormitory: 'A' });
  expect(mockReads).toEqual([path('A2')]);
});

test('recognizes an ID beside Chinese text without spaces', async () => {
  expect(await resolveWashReserveInput('幫我預約A2洗衣機明天晚上八點', 'pu')).toMatchObject({ machineId: 'A2' });
});

test.each(['A999', 'A20', 'a2', 'A2 A1', 'A2 A999', 'A2/A1', '第2台', '二號機', '機台：../A2', '指定甲號機', '機台：二', 'Ａ９９９', '二號', '第二部洗衣機', 'A2 或 3', 'A2 和 3號', '二號或A2'])('%s never falls back to another machine', async (selector) => {
  expect(await reserve(selector)).toBeNull();
  expect(mockReads).not.toContain('schools/pu/washingMachines');
});

test.each([
  '幫我預約 2 或 A2 洗衣機明天晚上八點',
  '幫我預約 2 和 3 洗衣機明天晚上八點',
  '幫我預約甲號洗衣機明天晚上八點',
  '幫我預約洗衣機「甲」明天晚上八點',
  '幫我預約洗衣機「甲」或A2明天晚上八點',
  '幫我預約機台編號二 或A2洗衣機明天晚上八點',
])('asks for clarification for unsupported or ambiguous selectors: %s', async (message) => {
  mockDocuments.set(path('3'), { status: 'available' });
  expect(await resolveWashReserveInput(message, 'pu')).toBeNull();
});

test('does not use a prefix match or a limited candidate list', async () => {
  mockDocuments.clear();
  for (let i = 10; i < 17; i++) mockDocuments.set(path(`A${i}`), { status: 'available' });
  expect(await reserve('A1')).toBeNull();
  mockDocuments.set(path('A2'), { status: 'available' });
  expect(await reserve('A2')).toMatchObject({ machineId: 'A2' });
});

test.each(['reserved', 'inUse', 'offline'])('unavailable explicit machine (%s) does not select A1', async (status) => {
  mockDocuments.set(path('A2'), { status, dormitory: 'A' });
  expect(await reserve('A2')).toBeNull();
});

test('only resolves the machine in the requested school', async () => {
  mockDocuments.delete(path('A2'));
  mockDocuments.set(path('A2', 'other'), { status: 'available', dormitory: 'A' });
  expect(await reserve('A2')).toBeNull();
  expect(mockReads).toEqual([path('A2')]);
});

test('fails closed on an explicit-machine source read failure', async () => {
  mockReadError = true;
  expect(await reserve('A2')).toBeNull();
  expect(mockReads).toEqual([path('A2')]);
});

test.each(['B棟', 'F棟', 'Ｆ棟'])('does not change conflicting %s to fit the machine', async (dormitory) => {
  expect(await reserve(`${dormitory} A2`)).toBeNull();
});

test('supports exact labeled numeric and hyphenated IDs', async () => {
  for (const id of ['2', 'washer-east']) mockDocuments.set(path(id), { status: 'available', dormitory: 'A' });
  expect(await reserve('機台編號：2')).toMatchObject({ machineId: '2' });
  expect(await reserve('washer-east')).toMatchObject({ machineId: 'washer-east' });
});

test('keeps the existing selection for an unspecified machine, including dates and times', async () => {
  expect(await resolveWashReserveInput('幫我預約2026-11-18 20:00 A棟洗衣機', 'pu'))
    .toMatchObject({ machineId: 'A1', dormitory: 'A棟' });
  expect(await reserve()).toMatchObject({ machineId: 'A1', dormitory: '宿舍' });
  expect(await reserve('A棟')).toMatchObject({ machineId: 'A1', dormitory: 'A棟' });
  expect(await resolveWashReserveInput('幫我預約洗衣機 11月18號 晚上八點', 'pu'))
    .toMatchObject({ machineId: 'A1' });
  expect(await resolveWashReserveInput('幫我預約洗衣機 2026-11-18 20:00', 'pu'))
    .toMatchObject({ machineId: 'A1' });
});

test('does not interpret the minutes before punctuation as another machine', async () => {
  expect(await resolveWashReserveInput('幫我預約洗衣機 20:00, A2', 'pu')).toMatchObject({ machineId: 'A2' });
  expect(await resolveWashReserveInput('幫我預約洗衣機 20:00, 明天', 'pu')).toMatchObject({ machineId: 'A1' });
});

test('keeps the existing fallback when no machine is available and none is specified', async () => {
  mockDocuments.set(path('A1'), { status: 'reserved' });
  mockDocuments.set(path('A2'), { status: 'reserved' });
  expect(await reserve()).toMatchObject({ machineId: 'A1' });
});

test('does not create a draft without a time or a machine source', async () => {
  expect(await resolveWashReserveInput('幫我預約洗衣機 A2', 'pu')).toBeNull();
  mockDocuments.clear();
  expect(await reserve()).toBeNull();
});
