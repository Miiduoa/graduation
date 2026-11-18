'use strict';

let mockDocuments;
const mockReads = [];
const mockQueries = [];
const mockModel = jest.fn();
const mockWebSearch = jest.fn(async () => null);
const mockWrite = jest.fn(() => { throw new Error('Leave status must not write'); });

function mockSnapshot(path) {
  const data = mockDocuments.get(path);
  if (data instanceof Error) throw data;
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data };
}

function mockDoc(path) {
  return {
    path, id: path.split('/').pop(),
    collection: (name) => mockCollection(`${path}/${name}`),
    get: async () => { mockReads.push(path); return mockSnapshot(path); },
    set: mockWrite, update: mockWrite, delete: mockWrite,
  };
}

function mockCollection(path, filters = [], ordering = [], maximum = Infinity) {
  return {
    doc: (id) => mockDoc(`${path}/${id}`),
    where: (field, operator, value) => mockCollection(path, [...filters, { field, operator, value }], ordering, maximum),
    orderBy: (field, direction = 'asc') => mockCollection(path, filters, [...ordering, { field, direction }], maximum),
    limit: (count) => mockCollection(path, filters, ordering, count),
    add: mockWrite,
    get: async () => {
      mockReads.push(path);
      mockQueries.push({ path, filters, ordering, maximum });
      const failure = mockDocuments.get(path);
      if (failure instanceof Error) throw failure;
      const comparable = (value) => typeof value?.toMillis === 'function' ? value.toMillis()
        : value instanceof Date ? value.getTime() : value;
      const docs = [...mockDocuments]
        .filter(([key, data]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/') &&
          filters.every(({ field, operator, value }) => {
            if (operator !== '==') throw new Error(`Unsupported fixture query: ${operator}`);
            return data[field] === value;
          }) && ordering.every(({ field }) => data[field] !== undefined))
        .sort(([leftPath, left], [rightPath, right]) => {
          for (const { field, direction } of ordering) {
            const a = comparable(left[field]);
            const b = comparable(right[field]);
            if (a !== b) return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1);
          }
          return leftPath.localeCompare(rightPath);
        })
        .slice(0, maximum)
        .map(([key]) => mockSnapshot(key));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  };
}

const mockDb = { doc: mockDoc, collection: mockCollection, runTransaction: mockWrite, batch: mockWrite };

jest.mock('firebase-admin/firestore', () => {
  const actual = jest.requireActual('firebase-admin/firestore');
  return {
    ...actual,
    getFirestore: () => mockDb,
    FieldValue: { serverTimestamp: () => actual.Timestamp.fromMillis(Date.now()) },
  };
});
jest.mock('../assistantAgent', () => ({
  ...jest.requireActual('../assistantAgent'),
  callAssistantModelWithTools: (...args) => mockModel(...args),
  callAssistantModel: (...args) => mockModel(...args),
  answerWithServerWebSearch: (...args) => mockWebSearch(...args),
}));

const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const getLeaveRequestStatus = require('./tools/getLeaveRequestStatus');
const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const started = Date.parse('2030-01-01T00:00:00Z');
const createdAt = (offset) => Timestamp.fromMillis(started + offset * 1000);

async function run({ uid = 'alice', schoolId = 'pu', prefetched } = {}) {
  return executeCampusAssistantCore({
    request: {
      auth: uid ? { uid, token: { role: 'student' } } : null,
      data: { messages: [{ role: 'user', content: '我的假單審核到哪了？' }], context: { schoolId } },
    },
    runId: 'leave-status-fixture-run', startedAt: started, routingIntent: 'leave_status', prefetched,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReads.length = 0;
  mockQueries.length = 0;
  mockModel.mockImplementation(() => { throw new Error('Unexpected provider call'); });
  mockDocuments = new Map([
    ['users/alice', { schoolId: 'pu', role: 'student' }],
    ['users/bob', { schoolId: 'pu', role: 'student' }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['schools/ntu/members/alice', { status: 'active' }],
    ['schools/pu/members/bob', { status: 'active' }],
    ['leaveRequests/pu-canonical', {
      uid: 'alice', schoolId: 'pu', source: 'campus-one', kind: 'sick',
      startDate: '2030-02-01', endDate: '2030-02-02', status: 'partial',
      courses: [{ courseId: 'pu-course', reviewStatus: 'approved' }], createdAt: createdAt(2),
    }],
    ['leaveRequests/pu-legacy', {
      uid: 'alice', schoolId: 'pu', date: '2030-02-03', type: '事假',
      status: 'approved', courseId: 'legacy-course', groupId: 'legacy-group', createdAt: createdAt(1),
    }],
    ...Array.from({ length: 12 }, (_, index) => [`leaveRequests/foreign-${index}`, {
      uid: 'alice', schoolId: 'ntu', source: 'campus-one', date: `2099-12-${String(index + 1).padStart(2, '0')}`,
      type: '他校假別', status: 'rejected', createdAt: createdAt(100 + index),
    }]),
    ['leaveRequests/unknown-school', {
      uid: 'alice', date: '2098-01-01', type: '校籍不明', status: 'approved', createdAt: createdAt(200),
    }],
    ['leaveRequests/bob-pu', {
      uid: 'bob', schoolId: 'pu', date: '2031-01-01', type: '公假', status: 'pending', createdAt: createdAt(300),
    }],
  ]);
});

afterEach(() => {
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockModel).not.toHaveBeenCalled();
  expect(mockWebSearch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

test('the real tool scopes before its limit so twelve newer foreign records cannot hide local canonical and legacy records', async () => {
  const before = new Map(mockDocuments);
  const result = await getLeaveRequestStatus.execute({ uid: 'alice', schoolId: 'pu' }, { limit: 10 });
  expect(result).toEqual({ count: 2, items: [
    { requestId: 'pu-canonical', date: '2030-02-01 至 2030-02-02', type: '病假', status: 'partial',
      courseId: 'pu-course', createdAt: createdAt(2).toDate().toISOString() },
    { requestId: 'pu-legacy', date: '2030-02-03', type: '事假', status: 'approved', courseId: 'legacy-course',
      groupId: 'legacy-group', createdAt: createdAt(1).toDate().toISOString() },
  ] });
  expect(mockQueries).toEqual([expect.objectContaining({
    path: 'leaveRequests', maximum: 10,
    filters: expect.arrayContaining([
      { field: 'uid', operator: '==', value: 'alice' },
      { field: 'schoolId', operator: '==', value: 'pu' },
    ]),
  })]);
  expect(mockDocuments).toEqual(before);
});

test('the real core renders only selected-school canonical and source-less legacy statuses without actions', async () => {
  const before = new Map(mockDocuments);
  const result = await run();
  expect(result.content).toContain('2030-02-01 至 2030-02-02｜病假｜部分課程已核閱');
  expect(result.content).toContain('2030-02-03｜事假｜已核准');
  expect(result.content).not.toMatch(/2099|2098|2031|他校假別|校籍不明|沒有請假申請紀錄/);
  expect(result.actions).toEqual([]);
  expect(result.debug.sourcesUsed).toBe(2);
  expect(mockDocuments).toEqual(before);
});

test('switching the authorized campus returns that campus newest ten rows, not the profile campus', async () => {
  const result = await run({ schoolId: 'ntu' });
  expect(result.debug.sourcesUsed).toBe(10);
  expect(result.content).toContain('2099-12-12｜他校假別｜已駁回');
  expect(result.content).toContain('2099-12-03｜他校假別｜已駁回');
  expect(result.content).not.toMatch(/2030-02|2099-12-0[12]|2098|2031/);
  expect(result.actions).toEqual([]);
});

test('switching the account does not return the previous account records from the same campus', async () => {
  const result = await run({ uid: 'bob' });
  expect(result.debug.sourcesUsed).toBe(1);
  expect(result.content).toContain('2031-01-01｜公假｜待審核');
  expect(result.content).not.toMatch(/2030-02|2099|2098/);
  expect(result.actions).toEqual([]);
});

test('foreign prefetched status data cannot replace a real selected-campus query', async () => {
  const result = await run({ prefetched: {
    scope: { uid: 'alice', schoolId: 'ntu' },
    leaveRequests: [{ date: '2099-12-31', type: 'foreign-prefetch', status: 'approved' }],
  } });
  expect(result.debug.sourcesUsed).toBe(2);
  expect(result.content).not.toMatch(/2099|foreign-prefetch/);
});

test('anonymous requests require sign-in before reading leave records', async () => {
  const result = await run({ uid: null });
  expect(result.content).toContain('先登入');
  expect(result.actions).toEqual([]);
  expect(mockReads).not.toContain('leaveRequests');
});

test('missing school context asks for a campus without reading any account-wide leave records', async () => {
  mockDocuments.set('users/alice', { role: 'student' });
  const result = await run({ schoolId: null });
  expect(result.content).toContain('先選擇學校');
  expect(result.content).not.toMatch(/2030-02|2099|2098|沒有請假申請紀錄/);
  expect(result.actions || []).toEqual([]);
  expect(mockReads).not.toContain('leaveRequests');
});

test('an unauthorized selected campus rejects before reading leave records', async () => {
  await expect(run({ uid: 'bob', schoolId: 'ntu' })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads).not.toContain('leaveRequests');
});

test('inactive membership rejects before reading leave records', async () => {
  mockDocuments.set('schools/pu/members/alice', { status: 'inactive' });
  await expect(run()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads).not.toContain('leaveRequests');
});

test('membership source failure is propagated instead of reading leave records', async () => {
  const failure = new Error('membership unavailable');
  mockDocuments.set('schools/pu/members/alice', failure);
  await expect(run()).rejects.toBe(failure);
  expect(mockReads).not.toContain('leaveRequests');
});

test('an unavailable leave source reports the failure without falling back or claiming an empty history', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockDocuments.set('leaveRequests', new Error('source unavailable'));
  const result = await run();
  expect(result.content).toContain('目前無法讀取請假紀錄');
  expect(result.content).not.toMatch(/沒有請假申請紀錄|2030-02|2099|2098|2031/);
  expect(result.actions).toEqual([]);
  expect(mockQueries).toHaveLength(1);
});

test('leave source authorization failure remains an error rather than an empty history', async () => {
  const failure = new HttpsError('permission-denied', 'fixture authorization denied');
  mockDocuments.set('leaveRequests', failure);
  await expect(run()).rejects.toBe(failure);
  expect(mockQueries).toHaveLength(1);
});

test('an empty selected campus stays empty even when the account has records elsewhere', async () => {
  mockDocuments.delete('leaveRequests/pu-canonical');
  mockDocuments.delete('leaveRequests/pu-legacy');
  const result = await run();
  expect(result.content).toContain('沒有請假申請紀錄');
  expect(result.content).not.toMatch(/2099|2098|2031/);
  expect(result.actions).toEqual([]);
});
