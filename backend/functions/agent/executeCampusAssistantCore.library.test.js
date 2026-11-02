'use strict';

const { transactionStore } = require('../testSupport/transactionStore');
let mockStore;
let mockNextId = 0;
const mockReads = [];
const mockModel = jest.fn();
const mockWebSearch = jest.fn(async () => null);

function mockSnapshot(path) {
  const data = mockStore.docs.get(path);
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data };
}

function mockDoc(path) {
  return {
    path, id: path.split('/').pop(),
    collection: (name) => mockCollection(`${path}/${name}`),
    get: async () => { mockReads.push(path); return mockSnapshot(path); },
  };
}

function mockCollection(path, filters = [], maximum = Infinity) {
  return {
    path, filters, maximum,
    doc: (id = `loan-${String(++mockNextId).padStart(8, '0')}`) => mockDoc(`${path}/${id}`),
    where: (field, operator, value) => mockCollection(path, [...filters, { field, operator, value }], maximum),
    limit: (count) => mockCollection(path, filters, count),
    get: async () => mockQuery({ path, filters, maximum }),
  };
}

function mockQuery(query) {
  mockReads.push(query.path);
  const docs = [...mockStore.docs]
    .filter(([path, data]) => path.startsWith(`${query.path}/`) &&
      !path.slice(query.path.length + 1).includes('/') && query.filters.every(({ field, operator, value }) => {
        if (operator === '==') return data[field] === value;
        if (operator === 'in') return value.includes(data[field]);
        throw new Error(`Unsupported fixture query: ${operator}`);
      }))
    .slice(0, query.maximum)
    .map(([path]) => mockSnapshot(path));
  return { docs, size: docs.length, empty: docs.length === 0 };
}

const mockDb = {
  doc: mockDoc,
  collection: mockCollection,
  runTransaction: jest.fn((callback) => mockStore.db.runTransaction((tx) => callback({
    ...tx,
    get: async (reference) => {
      if (Array.isArray(reference.filters)) return mockQuery(reference);
      mockReads.push(reference.path);
      return tx.get(reference);
    },
  }))),
};

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
const borrowBook = require('./tools/borrowBook');
const renewBook = require('./tools/renewBook');
const getLibraryLoans = require('./tools/getLibraryLoans');
const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const { connectCampusServiceData } = require('./semanticCampusData');

const day = 86400000;
const started = Date.parse('2026-11-02T00:00:00.000Z');
let now;
const actor = (uid = 'alice', schoolId = 'pu') => ({ uid, schoolId });
function loanPath(id, uid = 'alice', schoolId = 'pu') {
  return `users/${uid}/schools/${schoolId}/libraryLoans/${id}`;
}
function snapshot() {
  return new Map(mockStore.docs);
}
function expectDraft(result, toolName, loanId) {
  expect(result.actions).toEqual([expect.objectContaining({
    action: 'queue_action', requiresConfirmation: true, status: 'pending_confirmation',
    params: expect.objectContaining({ toolName, input: { loanId }, agentRunId: 'library-fixture-run' }),
  })]);
  expect(result.citations).toContainEqual(expect.objectContaining({ id: 'campus-agent-confirmation' }));
  expect(result.content).toContain('確認後才會');
  expect(result.content).not.toMatch(/已成功續借|已完成還書|\[object Object\]/);
}
async function run(intent, message, { uid = 'alice', schoolId = 'pu' } = {}) {
  return executeCampusAssistantCore({
    request: {
      auth: uid ? { uid, token: { role: 'student' } } : null,
      data: { messages: [{ role: 'user', content: message }], context: { schoolId } },
    },
    runId: 'library-fixture-run', startedAt: now, routingIntent: intent,
  });
}

async function borrowRenewThenBorrow() {
  const first = await borrowBook.execute(actor(), { bookId: 'book-a' });
  await renewBook.execute(actor(), { loanId: first.loanId });
  now += day;
  const second = await borrowBook.execute(actor(), { bookId: 'book-b' });
  const a = mockStore.docs.get(loanPath(first.loanId));
  const b = mockStore.docs.get(loanPath(second.loanId));
  expect(a.dueAt).toBeInstanceOf(Timestamp);
  expect(b.dueAt).toBeInstanceOf(Timestamp);
  expect(a.renewCount).toBe(1);
  expect(a.dueAt.toMillis()).toBeGreaterThan(b.dueAt.toMillis());
  mockReads.length = 0;
  mockDb.runTransaction.mockClear();
  return { first, second, a, b };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNextId = 0;
  now = started;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockModel.mockImplementation(() => { throw new Error('Unexpected provider call'); });
  mockWebSearch.mockResolvedValue(null);
  mockReads.length = 0;
  mockStore = transactionStore([
    ['users/alice', { schoolId: 'pu', role: 'student' }],
    ['users/bob', { schoolId: 'pu', role: 'student' }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['schools/pu/members/bob', { status: 'active' }],
    ['schools/ntu/members/alice', { status: 'active' }],
    ['schools/pu/libraryBooks/book-a', { title: '資料結構', availableCopies: 1, available: 1 }],
    ['schools/pu/libraryBooks/book-b', { title: '演算法', availableCopies: 1, available: 1 }],
    ['schools/pu/libraryBooks/book-bob', { title: 'Bob 的借閱', availableCopies: 1, available: 1 }],
    ['schools/ntu/libraryBooks/book-ntu', { title: '另一校園的借閱', availableCopies: 1, available: 1 }],
  ]);
});

afterEach(() => {
  expect(mockModel).not.toHaveBeenCalled();
  expect(mockWebSearch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

test('the real reader preserves dates produced by borrowing and renewal as usable ISO strings', async () => {
  const { first, second, a, b } = await borrowRenewThenBorrow();
  const before = snapshot();
  const result = await getLibraryLoans.execute(actor(), {});
  expect(result.loans).toEqual([
    expect.objectContaining({ id: first.loanId, dueAt: a.dueAt.toDate().toISOString(), borrowedAt: a.borrowedAt.toDate().toISOString() }),
    expect.objectContaining({ id: second.loanId, dueAt: b.dueAt.toDate().toISOString(), borrowedAt: b.borrowedAt.toDate().toISOString() }),
  ]);
  expect(mockStore.docs).toEqual(before);
  expect(mockDb.runTransaction).not.toHaveBeenCalled();
});

test('the real semantic library card retains loan dates after verifying current school membership', async () => {
  const { a, b } = await borrowRenewThenBorrow();
  const before = snapshot();
  const cards = await connectCampusServiceData({
    uid: 'alice', schoolId: 'pu', utterance: '我的借閱紀錄', destinations: ['/library'],
  });
  expect(cards).toEqual([expect.objectContaining({
    destination: '/library', status: 'available', source: 'campus-platform',
    items: [
      { title: '資料結構', detail: `到期 ${a.dueAt.toDate().toISOString()}` },
      { title: '演算法', detail: `到期 ${b.dueAt.toDate().toISOString()}` },
    ],
  })]);
  expect(cards[0].message).toContain('仍需到官方圖書館帳戶查核');
  expect(mockReads.filter((path) => path === 'schools/pu/members/alice')).toHaveLength(2);
  expect(mockStore.docs).toEqual(before);
  expect(mockDb.runTransaction).not.toHaveBeenCalled();
});

test.each([['renew_book', 'renewBook'], ['return_book', 'returnBook']])(
  '%s drafts the earliest due loan after borrow A, renew A, then borrow B without executing it',
  async (intent, toolName) => {
    const { second } = await borrowRenewThenBorrow();
    const before = snapshot();
    const result = await run(intent, intent === 'renew_book' ? '幫我續借快到期的書' : '幫我還快到期的書');
    expectDraft(result, toolName, second.loanId);
    expect(result.content).toContain('書籍：演算法');
    expect(result.content).toMatch(/到期：[^\n]*11\s*月\s*17/);
    expect(mockStore.docs).toEqual(before);
    expect(mockDb.runTransaction).not.toHaveBeenCalled();
    expect(mockReads).toContain('users/alice/schools/pu/libraryLoans');
  },
);

test.each([['renew_book', 'renewBook'], ['return_book', 'returnBook']])(
  '%s keeps an explicitly named later-due book instead of substituting the earliest loan',
  async (intent, toolName) => {
    const { first } = await borrowRenewThenBorrow();
    const before = snapshot();
    const result = await run(intent, `${intent === 'renew_book' ? '續借' : '還'}《資料結構》`);
    expectDraft(result, toolName, first.loanId);
    expect(result.content).toContain('書籍：資料結構');
    expect(result.content).toMatch(/到期：[^\n]*11\s*月\s*23/);
    expect(mockStore.docs).toEqual(before);
    expect(mockDb.runTransaction).not.toHaveBeenCalled();
  },
);

test.each([['renew_book', 'renewBook'], ['return_book', 'returnBook']])(
  '%s preserves an explicit loan ID and still requires confirmation',
  async (intent, toolName) => {
    const { first } = await borrowRenewThenBorrow();
    const before = snapshot();
    const result = await run(intent, `${intent === 'renew_book' ? '續借' : '還書'} 借閱：${first.loanId}`);
    expectDraft(result, toolName, first.loanId);
    expect(mockStore.docs).toEqual(before);
    expect(mockDb.runTransaction).not.toHaveBeenCalled();
  },
);

test.each([['renew_book', 'renewBook'], ['return_book', 'returnBook']])(
  '%s does not sort an unknown due date ahead of a valid loan date',
  async (intent, toolName) => {
    const { first, second } = await borrowRenewThenBorrow();
    for (const path of [loanPath(first.loanId), `schools/pu/libraryLoans/${first.loanId}`]) {
      mockStore.docs.set(path, { ...mockStore.docs.get(path), dueAt: null });
    }
    const before = snapshot();
    const result = await run(intent, intent === 'renew_book' ? '幫我續借' : '幫我還書');
    expectDraft(result, toolName, second.loanId);
    expect(result.content).toMatch(/到期：[^\n]*11\s*月\s*17/);
    expect(mockStore.docs).toEqual(before);
    expect(mockDb.runTransaction).not.toHaveBeenCalled();
  },
);

test('each authorized account and school reads only its own loan collection', async () => {
  const { second } = await borrowRenewThenBorrow();
  const bob = await borrowBook.execute(actor('bob'), { bookId: 'book-bob' });
  const ntu = await borrowBook.execute(actor('alice', 'ntu'), { bookId: 'book-ntu' });
  mockDb.runTransaction.mockClear();
  const before = snapshot();
  for (const [uid, schoolId, expectedId, title] of [
    ['alice', 'pu', second.loanId, '演算法'],
    ['bob', 'pu', bob.loanId, 'Bob 的借閱'],
    ['alice', 'ntu', ntu.loanId, '另一校園的借閱'],
  ]) {
    mockReads.length = 0;
    const result = await run('renew_book', '幫我續借快到期的書', { uid, schoolId });
    expectDraft(result, 'renewBook', expectedId);
    expect(result.content).toContain(`書籍：${title}`);
    expect(mockReads.filter((path) => path.includes('/libraryLoans'))).toEqual([
      `users/${uid}/schools/${schoolId}/libraryLoans`,
    ]);
  }
  expect(mockStore.docs).toEqual(before);
  expect(mockDb.runTransaction).not.toHaveBeenCalled();
});

test('an unauthorized selected campus fails before reading any private loan collection', async () => {
  await borrowRenewThenBorrow();
  const before = snapshot();
  await expect(run('return_book', '幫我還書', { uid: 'bob', schoolId: 'ntu' }))
    .rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads.filter((path) => path.includes('/libraryLoans'))).toEqual([]);
  expect(mockStore.docs).toEqual(before);
  expect(mockDb.runTransaction).not.toHaveBeenCalled();
});

test.each(['renew_book', 'return_book'])('%s requires sign-in before reading private loans', async (intent) => {
  const before = snapshot();
  const result = await run(intent, '處理我的借閱', { uid: null });
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('先登入');
  expect(mockReads.filter((path) => path.includes('/libraryLoans'))).toEqual([]);
  expect(mockStore.docs).toEqual(before);
  expect(mockDb.runTransaction).not.toHaveBeenCalled();
});
