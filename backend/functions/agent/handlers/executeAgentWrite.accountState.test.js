'use strict';

const mockDocuments = new Map();
const mockWrites = [];
const mockAccountReads = [];
let mockAfterClaim;
let mockAccountReadFailure = false;

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
    get: async () => {
      if (path === 'users/alice') mockAccountReads.push('admission');
      return mockSnapshot(path);
    },
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
      get: async (reference) => {
        if (reference.path === 'users/alice') {
          mockAccountReads.push('transaction');
          if (mockAccountReadFailure) throw new Error('account source unavailable');
        }
        return mockSnapshot(reference.path, base);
      },
      set: (...args) => writes.push(() => mockSet(...args)),
      update: (reference, data) => writes.push(() => mockSet(reference, data, { merge: true })),
    });
    for (const write of writes) write();
    // Deterministically change the source only after a real proposal claim commits.
    if (mockAfterClaim && mockDocuments.get(RUN_PATH)?.actionClaims?.['0']?.status === 'started') {
      const hook = mockAfterClaim;
      mockAfterClaim = undefined;
      hook();
    }
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
function proposal(toolName) {
  const input = {
    loanId: 'loan-1',
    expectedLoanVersion: libraryLoanVersion(mockDocuments.get(LOAN_PATH)),
  };
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
  mockAccountReads.length = 0;
  mockAfterClaim = undefined;
  mockAccountReadFailure = false;
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

// These are end-to-end callable regressions through the real admission guard,
// claim, tool registry, service writer and receipt checks, with only storage fake.
for (const toolName of ['renewBook', 'returnBook']) {
  test.each(['disabled', 'suspended', 'inactive', 'deleted', 'deleting', 'unreadable'])(
    `${toolName} stops when the account becomes %s after claim`, async (state) => {
      const request = proposal(toolName);
      const before = serviceSnapshot();
      let changedAfterClaim = false;
      mockAfterClaim = () => {
        expect(mockAccountReads).toContain('admission');
        expect(mockAccountReads).not.toContain('transaction');
        expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('started');
        changedAfterClaim = true;
        if (state === 'unreadable') mockAccountReadFailure = true;
        else mockDocuments.set('users/alice', {
          ...mockDocuments.get('users/alice'),
          ...(state === 'deleting' ? { accountDeletionInProgress: true } : { status: state }),
        });
      };

      await expect(executeAgentWrite(request)).rejects.toMatchObject({
        code: state === 'unreadable' ? 'invalid-argument' : 'failed-precondition',
      });

      expect(changedAfterClaim).toBe(true);
      expect(mockAccountReads).toContain('transaction');
      expectNoServiceWrite(before);
      const saved = mockDocuments.get(RUN_PATH);
      expect(saved.actionClaims['0'].status).toBe('unverified');
      expect(saved.steps).toEqual([expect.objectContaining({ output: expect.objectContaining({ success: false }) })]);

      // Re-enabling cannot turn an already attempted confirmation into a replay.
      mockDocuments.set('users/alice', { schoolId: 'pu', status: 'active' });
      mockAccountReadFailure = false;
      await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'already-exists' });
      expectNoServiceWrite(before);
    },
  );

  test.each(['active', undefined, 'missing-profile'])(`${toolName} preserves the existing account policy for %s`, async (status) => {
    const request = proposal(toolName);
    mockAfterClaim = () => {
      if (status === 'missing-profile') mockDocuments.delete('users/alice');
      else mockDocuments.set('users/alice', { schoolId: 'pu', status });
    };
    const result = await executeAgentWrite(request);
    expect(result).toMatchObject({ success: true, toolName });
    expect(mockAccountReads).toContain('transaction');
    expect(mockDocuments.get(MIRROR_PATH)).toEqual(mockDocuments.get(LOAN_PATH));
    expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('completed');
    if (toolName === 'renewBook') expect(mockDocuments.get(LOAN_PATH).renewCount).toBe(1);
    else {
      expect(mockDocuments.get(LOAN_PATH).status).toBe('returned');
      expect(mockDocuments.get(BOOK_PATH).availableCopies).toBe(1);
    }
  });
}
