'use strict';

const mockDocuments = new Map();
const mockWrites = [];

function mockClone(value) {
  if (Array.isArray(value)) return value.map(mockClone);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mockClone(item)]));
  }
  return value;
}
function mockMerge(previous, update) {
  const next = { ...previous };
  for (const [key, value] of Object.entries(update)) {
    next[key] = value && Object.getPrototypeOf(value) === Object.prototype
      ? mockMerge(previous?.[key], value) : mockClone(value);
  }
  return next;
}
function mockSnapshot(path, documents = mockDocuments) {
  const data = documents.get(path);
  return { id: path.split('/').pop(), exists: documents.has(path), data: () => mockClone(data) };
}
function mockSet(reference, data, options) {
  mockWrites.push(reference.path);
  mockDocuments.set(reference.path, options?.merge
    ? mockMerge(mockDocuments.get(reference.path), data) : mockClone(data));
}
function mockRef(path) {
  return {
    path, id: path.split('/').pop(),
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    get: async () => mockSnapshot(path),
    set: async (data, options) => mockSet({ path }, data, options),
  };
}
const mockDb = {
  collection: mockRef,
  doc: mockRef,
  runTransaction: async (callback) => {
    const base = new Map([...mockDocuments].map(([path, data]) => [path, mockClone(data)]));
    const writes = [];
    const result = await callback({
      get: async (reference) => mockSnapshot(reference.path, base),
      set: (...args) => writes.push(() => mockSet(...args)),
      update: (reference, data) => writes.push(() => mockSet(reference, data, { merge: true })),
    });
    for (const write of writes) write();
    return result;
  },
};

jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockDb,
  FieldValue: { serverTimestamp: () => 'test-server-timestamp' },
}));

// Keep the actual callable, authorization, proposal claim, registry, tools and
// receipt checks. Only Firestore's transport and transaction storage are in memory.
const { Timestamp } = require('firebase-admin/firestore');
const executeAgentWrite = require('./executeAgentWrite');
const renewBook = require('../tools/renewBook');
const { libraryLoanVersion } = require('../libraryLoanSource');

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RUN_PATH = `users/alice/agentRuns/${RUN_ID}`;
const LOAN_PATH = 'schools/pu/libraryLoans/loan-1';
const MIRROR_PATH = 'users/alice/schools/pu/libraryLoans/loan-1';
const BOOK_PATH = 'schools/pu/libraryBooks/book-a';
const OTHER_BOOK_PATH = 'schools/pu/libraryBooks/book-b';
const GUARD_PATH = 'users/alice/schools/pu/serviceWriteGuards/library';
const SERVICE_PATHS = [LOAN_PATH, MIRROR_PATH, BOOK_PATH, OTHER_BOOK_PATH, GUARD_PATH];

function serviceSnapshot() {
  return SERVICE_PATHS.map((path) => [path, mockClone(mockDocuments.get(path))]);
}
function proposal(toolName, { legacy = false } = {}) {
  const input = {
    loanId: 'loan-1',
    ...(!legacy ? { expectedLoanVersion: libraryLoanVersion(mockDocuments.get(LOAN_PATH)) } : {}),
  };
  if (!legacy) expect(input.expectedLoanVersion).toMatch(/^[a-f0-9]{64}$/);
  mockDocuments.set(RUN_PATH, {
    userId: 'alice', schoolId: 'pu', status: 'completed', createdAt: Timestamp.now(),
    actionProposals: [{ toolName, input }], steps: [],
  });
  return {
    auth: { uid: 'alice' },
    data: { toolName, agentRunId: RUN_ID, input, context: { schoolId: 'pu' } },
  };
}
function expectNoServiceWrite(before) {
  expect(serviceSnapshot()).toEqual(before);
  expect(mockWrites.filter((path) => SERVICE_PATHS.includes(path))).toEqual([]);
}

beforeEach(() => {
  mockDocuments.clear();
  mockWrites.length = 0;
  const loan = {
    userId: 'alice', schoolId: 'pu', bookId: 'book-a', bookTitle: '資料結構',
    status: 'borrowed', renewCount: 0,
    borrowedAt: Timestamp.fromDate(new Date('2026-11-17T00:00:00Z')),
    dueAt: Timestamp.fromDate(new Date('2026-12-01T00:00:00Z')),
  };
  for (const [path, data] of [
    ['users/alice', { schoolId: 'pu', role: 'student' }],
    ['schools/pu/members/alice', { status: 'active', role: 'student' }],
    ['users/alice/settings/assistantPermissions', { renewBook: true, returnBook: true }],
    [LOAN_PATH, loan], [MIRROR_PATH, mockClone(loan)],
    [BOOK_PATH, { title: '資料結構', availableCopies: 0, available: 0 }],
    [OTHER_BOOK_PATH, { title: '另一筆書籍', availableCopies: 0, available: 0 }],
  ]) mockDocuments.set(path, data);
});

test.each(['renewBook', 'returnBook'])('%s confirms an unchanged reviewed source once', async (toolName) => {
  const request = proposal(toolName);
  const result = await executeAgentWrite(request);

  expect(result).toMatchObject({ success: true, toolName });
  const canonical = mockDocuments.get(LOAN_PATH);
  expect(mockDocuments.get(MIRROR_PATH)).toEqual(canonical);
  if (toolName === 'renewBook') {
    expect(canonical.renewCount).toBe(1);
    expect(canonical.dueAt.toDate().toISOString()).toBe('2026-12-08T00:00:00.000Z');
  } else {
    expect(canonical.status).toBe('returned');
    expect(mockDocuments.get(BOOK_PATH).availableCopies).toBe(1);
  }
  expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('completed');

  const beforeReplay = serviceSnapshot();
  const runBeforeReplay = mockClone(mockDocuments.get(RUN_PATH));
  mockWrites.length = 0;
  await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'already-exists' });
  expectNoServiceWrite(beforeReplay);
  expect(mockDocuments.get(RUN_PATH)).toEqual(runBeforeReplay);
});

test.each([
  ['renewBook', 'bookId', 'book-b'], ['returnBook', 'bookId', 'book-b'],
  ['renewBook', 'bookTitle', '不同書名'], ['returnBook', 'bookTitle', '不同書名'],
])('%s rejects a canonical %s change after the preview without trusting the old mirror', async (toolName, field, value) => {
  const request = proposal(toolName);
  mockDocuments.set(LOAN_PATH, { ...mockDocuments.get(LOAN_PATH), [field]: value });
  const before = serviceSnapshot();

  await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'failed-precondition' });

  expectNoServiceWrite(before);
  expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('unverified');
  expect(mockDocuments.get(RUN_PATH).steps.some((step) => step.output?.success === true)).toBe(false);
});

test('a normal renewal invalidates an older Agent preview instead of consuming the second renewal', async () => {
  const request = proposal('renewBook');
  await renewBook.execute({ uid: 'alice', schoolId: 'pu' }, { loanId: 'loan-1' });
  const before = serviceSnapshot();
  mockWrites.length = 0;

  await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'failed-precondition' });

  expectNoServiceWrite(before);
  expect(mockDocuments.get(LOAN_PATH).renewCount).toBe(1);
  expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('unverified');
});

test.each(['strip', 'replace'])('the client cannot %s the reviewed version while confirming', async (change) => {
  const request = proposal('renewBook');
  const input = { ...request.data.input };
  if (change === 'strip') delete input.expectedLoanVersion;
  else input.expectedLoanVersion = '0'.repeat(64);
  const before = serviceSnapshot();

  await expect(executeAgentWrite({ ...request, data: { ...request.data, input } }))
    .rejects.toMatchObject({ code: 'permission-denied' });

  expectNoServiceWrite(before);
  expect(mockDocuments.get(RUN_PATH).actionClaims).toBeUndefined();
});

test.each(['renewBook', 'returnBook'])('%s refuses an old saved proposal without a source version', async (toolName) => {
  const request = proposal(toolName, { legacy: true });
  const before = serviceSnapshot();

  await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'failed-precondition' });

  expectNoServiceWrite(before);
  expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('unverified');
  await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'already-exists' });
  expectNoServiceWrite(before);
});
