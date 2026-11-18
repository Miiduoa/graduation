'use strict';

let mockDocuments;
let mockReadHook;
const mockReads = [];
const mockWrite = jest.fn(() => { throw new Error('Planning must not write'); });
const mockModel = jest.fn();
const mockWebSearch = jest.fn();

function mockSnapshot(path) {
  const data = mockDocuments.get(path);
  if (data instanceof Error) throw data;
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data };
}

function mockRef(path, filters = [], ordering = [], maximum = Infinity) {
  return {
    path,
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    where: (field, operator, value) => mockRef(path, [...filters, { field, operator, value }], ordering, maximum),
    orderBy: (field, direction = 'asc') => mockRef(path, filters, [...ordering, { field, direction }], maximum),
    limit: (count) => mockRef(path, filters, ordering, count),
    set: mockWrite, update: mockWrite, create: mockWrite, delete: mockWrite, add: mockWrite,
    get: async () => {
      mockReads.push(path);
      if (mockReadHook) await mockReadHook(path);
      if (path.split('/').length % 2 === 0) return mockSnapshot(path);
      const failure = mockDocuments.get(path);
      if (failure instanceof Error) throw failure;
      const comparable = (value) => typeof value?.toMillis === 'function' ? value.toMillis()
        : value instanceof Date ? value.getTime() : value;
      const docs = [...mockDocuments]
        .filter(([key, data]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/') &&
          filters.every(({ field, operator, value }) => {
            if (operator === '==') return data[field] === value;
            if (operator === 'array-contains') return Array.isArray(data[field]) && data[field].includes(value);
            throw new Error(`Unsupported fixture query: ${operator}`);
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

const mockDb = { collection: mockRef, doc: mockRef, runTransaction: mockWrite, batch: mockWrite };
jest.mock('firebase-admin/firestore', () => {
  const actual = jest.requireActual('firebase-admin/firestore');
  return { ...actual, getFirestore: () => mockDb };
});
jest.mock('../assistantAgent', () => ({
  ...jest.requireActual('../assistantAgent'),
  callAssistantModelWithTools: (...args) => mockModel(...args),
  answerWithServerWebSearch: (...args) => mockWebSearch(...args),
}));

// The classifier, core, authorization, registry and canonical assignment reader stay real.
const { classifyIntent } = require('./classifyIntent');
const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const getAssignments = require('./tools/getAssignments');

const databaseTask = {
  id: 'database-work', groupId: 'database', groupName: '資料庫', schoolId: 'pu',
  title: '資料庫練習', dueAt: '2030-01-02T00:00:00.000Z',
};
const englishTask = {
  id: 'english-work', groupId: 'english', groupName: '英文', schoolId: 'pu',
  title: '英文報告', dueAt: '2030-01-03T00:00:00.000Z',
};
const explicitEnglish = '幫我把作業「英文報告」拆成讀書計畫';

function seedTask(task) {
  mockDocuments.set(`users/alice/groups/${task.groupId}`, { schoolId: task.schoolId, status: 'active' });
  mockDocuments.set(`groups/${task.groupId}`, { schoolId: task.schoolId, type: 'course', name: task.groupName });
  mockDocuments.set(`groups/${task.groupId}/members/alice`, { status: 'active', role: 'student' });
  mockDocuments.set(`groups/${task.groupId}/assignments/${task.id}`, {
    title: task.title, dueAt: task.dueAt, schoolId: task.schoolId, groupId: task.groupId, status: 'published',
  });
}

async function run(message = explicitEnglish, { uid = 'alice', schoolId = 'pu', groupId, prefetched } = {}) {
  const intent = classifyIntent(message).name;
  expect(intent).toBe('assignment_planning');
  return executeCampusAssistantCore({
    request: {
      auth: uid ? { uid, token: { role: 'student' } } : null,
      data: { messages: [{ role: 'user', content: message }], context: { schoolId, groupId } },
    },
    runId: 'assignment-target-fixture-run', startedAt: Date.now(), routingIntent: intent, prefetched,
  });
}

function expectTarget(result, task) {
  expect(result.content).toContain(task.title);
  const expectedDeadline = {
    '2030-01-01T00:00:00.000Z': '1 月 1 日（二）08:00',
    '2030-01-02T00:00:00.000Z': '1 月 2 日（三）08:00',
    '2030-01-03T00:00:00.000Z': '1 月 3 日（四）08:00',
  }[task.dueAt];
  expect(expectedDeadline).toBeDefined();
  expect(result.content).toContain(`截止時間：${expectedDeadline}`);
  expect(result.citations).toEqual([{ type: 'assignment', id: task.id, label: task.title }]);
  expect(result.actions).toEqual([
    expect.objectContaining({
      action: 'split_assignment', requiresConfirmation: true, status: 'pending_confirmation',
      params: { assignmentId: task.id, groupId: task.groupId },
      evidenceRefs: [{ type: 'assignment', id: task.id, label: task.title }],
    }),
    expect.objectContaining({
      action: 'schedule_reminder', requiresConfirmation: true, status: 'pending_confirmation',
      params: { title: task.title, dueDate: task.dueAt },
      evidenceRefs: [{ type: 'assignment', id: task.id, label: task.title }],
    }),
  ]);
}

function expectClarification(result) {
  expect(result.actions).toEqual([]);
  expect(result.citations).toEqual([]);
  expect(result.content).toMatch(/課程|哪一|同名|確認|指定|找不到|對不到|名稱/);
  expect(result.content).not.toContain('我先用');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReads.length = 0;
  mockReadHook = undefined;
  mockModel.mockResolvedValue({ provider: 'none', content: '', errors: [] });
  mockWebSearch.mockImplementation(() => { throw new Error('Unexpected external search'); });
  mockDocuments = new Map([
    ['users/alice', { schoolId: 'pu', role: 'student' }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['users/alice/settings/assistantPermissions', { createPersonalTodoReminder: true }],
  ]);
  seedTask(englishTask);
  seedTask(databaseTask);
});

afterEach(() => {
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockWebSearch).not.toHaveBeenCalled();
});

test.each([
  explicitEnglish,
  '幫我把英文報告作業拆成讀書計畫',
])('the real source-backed fallback preserves the explicit later assignment: %s', async (message) => {
  const before = new Map(mockDocuments);
  const result = await run(message);
  expectTarget(result, englishTask);
  expect(result.content).not.toContain(databaseTask.title);
  expect(result.debug.modelProvider).toBe('none');
  expect(mockModel).toHaveBeenCalledTimes(1);
  expect(mockReads).toContain('groups/english/assignments');
  expect(mockReads).toContain('groups/database/assignments');
  expect(mockDocuments).toEqual(before);
});

test('the same explicit title in two courses asks for the course without planning either assignment', async () => {
  seedTask({ ...databaseTask, title: '期中報告' });
  seedTask({ ...englishTask, title: '期中報告' });
  const result = await run('幫我把作業「期中報告」拆成讀書計畫');
  expectClarification(result);
});

test('same-title assignments with the same document ID in different courses remain ambiguous', async () => {
  seedTask({ ...databaseTask, title: '期中報告' });
  mockDocuments.delete('groups/english/assignments/english-work');
  seedTask({ ...englishTask, id: databaseTask.id, title: '期中報告' });
  const result = await run('幫我把作業「期中報告」拆成讀書計畫');
  expectClarification(result);
});

test('an explicit course disambiguates the same title and binds all draft fields to that course', async () => {
  seedTask({ ...databaseTask, title: '期中報告' });
  const target = { ...englishTask, title: '期中報告' };
  seedTask(target);
  const result = await run('幫我把英文的作業「期中報告」拆成讀書計畫');
  expectTarget(result, target);
});

test('an unknown explicit assignment cannot fall back to the earliest unrelated assignment', async () => {
  const result = await run('幫我把作業「不存在的期末專題」拆成讀書計畫');
  expectClarification(result);
});

test('an unknown explicit course cannot fall through to a known assignment in another course', async () => {
  const result = await run('幫我把數學的作業「英文報告」拆成讀書計畫');
  expectClarification(result);
});

test('a generic request keeps the earliest-deadline behavior and confirmation requirements', async () => {
  const earliest = { ...englishTask, dueAt: '2030-01-01T00:00:00.000Z' };
  seedTask(earliest);
  const result = await run('幫我把作業拆成讀書計畫');
  expectTarget(result, earliest);
});

test('closed personal todo permission preserves the selected assignment but creates no actions', async () => {
  mockDocuments.set('users/alice/settings/assistantPermissions', { createPersonalTodoReminder: false });
  const result = await run();
  expect(result.content).toContain(englishTask.title);
  expect(result.content).not.toContain(databaseTask.title);
  expect(result.actions).toEqual([]);
  expect(result.citations).toEqual([{ type: 'assignment', id: englishTask.id, label: englishTask.title }]);
});

test('a matching title in another school does not become a candidate for this school', async () => {
  seedTask({ id: 'foreign-work', groupId: 'foreign', groupName: '外校課程', schoolId: 'ntu',
    title: '外校專題', dueAt: '2029-01-01T00:00:00.000Z' });
  const result = await run('幫我把作業「外校專題」拆成讀書計畫');
  expectClarification(result);
  expect(mockReads.some((path) => path.startsWith('groups/foreign'))).toBe(false);
});

test('an unauthorized selected campus rejects before reading any assignments', async () => {
  await expect(run(explicitEnglish, { schoolId: 'ntu' })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads.some((path) => path.includes('/assignments'))).toBe(false);
});

test('revoked school membership rejects before reading any assignments', async () => {
  mockDocuments.set('schools/pu/members/alice', { status: 'inactive' });
  await expect(run()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads.some((path) => path.includes('/assignments'))).toBe(false);
});

test('revoked course membership does not substitute another authorized course assignment', async () => {
  mockDocuments.set('groups/english/members/alice', { status: 'inactive' });
  await expect(run()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads).not.toContain('groups/english/assignments');
});

test('course revocation after reading assignments is caught by the real source recheck', async () => {
  let englishMembershipReads = 0;
  mockReadHook = (path) => {
    if (path === 'groups/english/members/alice' && ++englishMembershipReads === 2) {
      mockDocuments.set(path, { status: 'inactive' });
    }
  };
  await expect(run()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads).toContain('groups/english/assignments');
  expect(englishMembershipReads).toBe(2);
});

test('a failed assignment source propagates instead of selecting a task from the remaining course', async () => {
  const failure = new Error('assignment-source-unavailable');
  mockDocuments.set('groups/english/assignments', failure);
  await expect(run()).rejects.toBe(failure);
});

test('an assignment bound to a different school is rejected instead of used or replaced', async () => {
  const path = 'groups/english/assignments/english-work';
  mockDocuments.set(path, { ...mockDocuments.get(path), schoolId: 'ntu' });
  await expect(run()).rejects.toMatchObject({ code: 'failed-precondition' });
});

test.each([
  { uid: 'bob', schoolId: 'pu' },
  { uid: 'alice', schoolId: 'ntu' },
])('prefetch from another scope is discarded before choosing the canonical target: %j', async (scope) => {
  const result = await run(explicitEnglish, { prefetched: {
    scope, assignments: [{ ...englishTask, id: 'forged-work', groupId: 'foreign' }],
  } });
  expectTarget(result, englishTask);
  expect(JSON.stringify(result)).not.toContain('forged-work');
  expect(mockReads).toContain('groups/english/assignments');
});

test('a scoped prefetch produced by the real reader retains exact assignment identity', async () => {
  const assignments = await getAssignments.execute({ uid: 'alice', schoolId: 'pu' }, {});
  expect(assignments.map((assignment) => assignment.id)).toEqual([databaseTask.id, englishTask.id]);
  mockReads.length = 0;
  const result = await run(explicitEnglish, { prefetched: { scope: { uid: 'alice', schoolId: 'pu' }, assignments } });
  expectTarget(result, englishTask);
  expect(mockReads.some((path) => path.includes('/assignments'))).toBe(false);
});

test('anonymous planning does not read private assignments or create actions', async () => {
  const result = await run(explicitEnglish, { uid: null });
  expect(result.content).toContain('先登入');
  expect(result.actions).toEqual([]);
  expect(mockReads.some((path) => path.includes('/assignments') || path.startsWith('users/'))).toBe(false);
});
