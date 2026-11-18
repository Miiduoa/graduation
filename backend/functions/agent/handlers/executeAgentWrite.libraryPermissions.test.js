'use strict';

const mockDocuments = new Map();
const mockWrites = [];
const mockPermissionReads = [];
let mockAfterClaim;
let mockBeforeServiceCommit;
let mockPermissionReadFailure = false;
let mockNextId = 0;

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
function mockSnapshot(reference, documents = mockDocuments) {
  if (reference.filters) {
    const docs = [...documents].filter(([path, row]) =>
      path.startsWith(`${reference.path}/`) && !path.slice(reference.path.length + 1).includes('/') &&
      reference.filters.every(([field, operator, value]) =>
        operator === '==' ? row[field] === value : operator === 'in' && value.includes(row[field])))
      .map(([path]) => mockSnapshot(mockRef(path), documents));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  const data = documents.get(reference.path);
  return { id: reference.id, exists: documents.has(reference.path), data: () => mockClone(data) };
}
function mockSet(reference, data, options) {
  mockWrites.push(reference.path);
  mockDocuments.set(reference.path, options?.merge
    ? mockMerge(mockDocuments.get(reference.path), data) : mockClone(data));
}
function mockRead(reference, phase, documents) {
  if (reference.path === PERMISSIONS_PATH) {
    mockPermissionReads.push(phase);
    if (mockPermissionReadFailure) throw new Error('permission source unavailable');
  }
  return mockSnapshot(reference, documents);
}
function mockRef(path, filters) {
  return {
    path, id: path.split('/').pop(), filters,
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id ?? `new-loan-${++mockNextId}`}`),
    where: (field, operator, value) => mockRef(path, [...(filters || []), [field, operator, value]]),
    get: async () => mockRead(mockRef(path, filters), 'admission', mockDocuments),
    set: async (data, options) => mockSet({ path }, data, options),
  };
}
const mockDb = {
  collection: mockRef,
  doc: mockRef,
  runTransaction: async (callback) => {
    // Retrying replaces the snapshot and discards every previously staged write.
    for (;;) {
      const base = new Map([...mockDocuments].map(([path, data]) => [path, mockClone(data)]));
      const writes = [];
      const result = await callback({
        get: async (reference) => mockRead(reference, 'transaction', base),
        set: (...args) => writes.push(args),
        create: (...args) => writes.push(args),
        update: (reference, data) => writes.push([reference, data, { merge: true }]),
      });
      if (mockBeforeServiceCommit && writes.some(([reference]) => isServicePath(reference.path))) {
        const hook = mockBeforeServiceCommit;
        mockBeforeServiceCommit = undefined;
        hook();
        continue;
      }
      for (const write of writes) mockSet(...write);
      if (mockAfterClaim && mockDocuments.get(RUN_PATH)?.actionClaims?.['0']?.status === 'started') {
        const hook = mockAfterClaim;
        mockAfterClaim = undefined;
        hook();
      }
      return result;
    }
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

// Exercise the real admission guard, claim, registry, library writers and receipt
// verification. Only the Firestore transport and atomic storage are replaced.
const { Timestamp } = require('firebase-admin/firestore');
const executeAgentWrite = require('./executeAgentWrite');
const { libraryLoanVersion } = require('../libraryLoanSource');
const libraryTools = {
  borrowBook: require('../tools/borrowBook'),
  renewBook: require('../tools/renewBook'),
  returnBook: require('../tools/returnBook'),
};
const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RUN_PATH = `users/alice/agentRuns/${RUN_ID}`;
const PERMISSIONS_PATH = 'users/alice/settings/assistantPermissions';
const LOAN_PATH = 'schools/pu/libraryLoans/loan-1';
const MIRROR_PATH = 'users/alice/schools/pu/libraryLoans/loan-1';
const BOOK_PATH = 'schools/pu/libraryBooks/book-a';
const BORROW_BOOK_PATH = 'schools/pu/libraryBooks/book-b';
const isServicePath = (path) => /\/library(?:Loans|Books)\/|\/serviceWriteGuards\//.test(path);

function serviceSnapshot() {
  return [...mockDocuments].filter(([path]) => isServicePath(path)).map(mockClone);
}
function proposal(toolName) {
  const input = toolName === 'borrowBook' ? { bookId: 'book-b' } : {
    loanId: 'loan-1', expectedLoanVersion: libraryLoanVersion(mockDocuments.get(LOAN_PATH)),
  };
  mockDocuments.set(RUN_PATH, {
    userId: 'alice', schoolId: 'pu', status: 'completed', createdAt: Timestamp.now(),
    actionProposals: [{ toolName, input }], steps: [],
  });
  return { auth: { uid: 'alice' }, data: { toolName, agentRunId: RUN_ID, input, context: { schoolId: 'pu' } } };
}
function expectNoServiceWrite(before) {
  expect(serviceSnapshot()).toEqual(before);
  expect(mockWrites.filter(isServicePath)).toEqual([]);
}
function changePermission(state, toolName) {
  if (state === 'unreadable') mockPermissionReadFailure = true;
  else if (state === 'deleted') mockDocuments.delete(PERMISSIONS_PATH);
  else mockDocuments.set(PERMISSIONS_PATH, {
    borrowBook: true, renewBook: true, returnBook: true,
    [toolName]: state === 'malformed' ? 'true' : false,
  });
}

beforeEach(() => {
  mockDocuments.clear();
  mockWrites.length = 0;
  mockPermissionReads.length = 0;
  mockAfterClaim = undefined;
  mockBeforeServiceCommit = undefined;
  mockPermissionReadFailure = false;
  mockNextId = 0;
  const loan = {
    userId: 'alice', schoolId: 'pu', bookId: 'book-a', bookTitle: '資料結構',
    status: 'borrowed', renewCount: 0,
    borrowedAt: Timestamp.fromDate(new Date('2026-11-17T00:00:00Z')),
    dueAt: Timestamp.fromDate(new Date('2026-12-01T00:00:00Z')),
  };
  for (const [path, data] of [
    ['users/alice', { schoolId: 'pu', role: 'student' }],
    ['schools/pu/members/alice', { status: 'active', role: 'student' }],
    [PERMISSIONS_PATH, { borrowBook: true, renewBook: true, returnBook: true }],
    [LOAN_PATH, loan], [MIRROR_PATH, mockClone(loan)],
    [BOOK_PATH, { title: '資料結構', availableCopies: 0, available: 0 }],
    [BORROW_BOOK_PATH, { title: '演算法', availableCopies: 1, available: 1 }],
  ]) mockDocuments.set(path, data);
});

describe.each(Object.keys(libraryTools))('%s Agent transaction permission', (toolName) => {
  test.each(['revoked', 'deleted', 'unreadable', 'malformed'])(
    'rejects permission %s after the claim without service writes', async (state) => {
      const request = proposal(toolName);
      const before = serviceSnapshot();
      let changedAfterClaim = false;
      mockAfterClaim = () => {
        expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('started');
        expect(mockPermissionReads).toEqual(['admission']);
        changedAfterClaim = true;
        changePermission(state, toolName);
      };
      await expect(executeAgentWrite(request)).rejects.toMatchObject({
        code: state === 'unreadable' ? 'invalid-argument' : 'permission-denied',
      });
      expect(changedAfterClaim).toBe(true);
      expect(mockPermissionReads).toEqual(['admission', 'transaction']);
      expectNoServiceWrite(before);
      expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('unverified');
      expect(mockDocuments.get(RUN_PATH).steps[0].output.success).toBe(false);
      mockPermissionReadFailure = false;
      mockDocuments.set(PERMISSIONS_PATH, { [toolName]: true });
      await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'already-exists' });
      expectNoServiceWrite(before);
    },
  );

  test.each(['revoked', 'deleted', 'unreadable'])(
    'still rejects permission %s before creating a claim', async (state) => {
      const request = proposal(toolName);
      const before = serviceSnapshot();
      changePermission(state, toolName);
      await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(mockDocuments.get(RUN_PATH).actionClaims).toBeUndefined();
      expect(mockPermissionReads).toEqual(['admission']);
      expectNoServiceWrite(before);
    },
  );

  test.each(['all-granted', 'only-requested-tool'])(
    'commits the correct operation with %s permission', async (state) => {
      const request = proposal(toolName);
      mockAfterClaim = () => {
        if (state === 'only-requested-tool') mockDocuments.set(PERMISSIONS_PATH, { [toolName]: true });
      };
      await expect(executeAgentWrite(request)).resolves.toMatchObject({ success: true, toolName });
      expect(mockPermissionReads).toEqual(['admission', 'transaction']);
      expect(mockDocuments.get(RUN_PATH).actionClaims['0'].status).toBe('completed');
      if (toolName === 'borrowBook') {
        const loan = mockDocuments.get('schools/pu/libraryLoans/new-loan-1');
        expect(loan).toMatchObject({ bookId: 'book-b', userId: 'alice', status: 'borrowed' });
        expect(mockDocuments.get('users/alice/schools/pu/libraryLoans/new-loan-1')).toEqual(loan);
        expect(mockDocuments.get(BORROW_BOOK_PATH)).toMatchObject({ availableCopies: 0, available: 0 });
      } else {
        expect(mockDocuments.get(MIRROR_PATH)).toEqual(mockDocuments.get(LOAN_PATH));
        if (toolName === 'renewBook') expect(mockDocuments.get(LOAN_PATH).renewCount).toBe(1);
        else {
          expect(mockDocuments.get(LOAN_PATH).status).toBe('returned');
          expect(mockDocuments.get(BOOK_PATH)).toMatchObject({ availableCopies: 1, available: 1 });
        }
      }
    },
  );

  test('rechecks on a transaction retry and discards the first attempt', async () => {
    const request = proposal(toolName);
    const before = serviceSnapshot();
    let retried = false;
    mockBeforeServiceCommit = () => {
      expect(mockWrites.filter(isServicePath)).toEqual([]);
      changePermission('revoked', toolName);
      retried = true;
    };
    await expect(executeAgentWrite(request)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(retried).toBe(true);
    expect(mockPermissionReads).toEqual(['admission', 'transaction', 'transaction']);
    expectNoServiceWrite(before);
  });

  test.each(['active', 'missing-profile'])(
    'preserves the existing %s account policy with a current tool grant', async (state) => {
      const request = proposal(toolName);
      if (state === 'missing-profile') mockDocuments.delete('users/alice');
      else mockDocuments.set('users/alice', { schoolId: 'pu', status: 'active' });
      await expect(executeAgentWrite(request)).resolves.toMatchObject({ success: true, toolName });
      expect(mockPermissionReads).toEqual(['admission', 'transaction']);
      expect(mockWrites.some(isServicePath)).toBe(true);
    },
  );

  test.each(['revoked', 'deleted', 'unreadable'])(
    'keeps ordinary direct service authorization when Agent permission is %s', async (state) => {
      const request = proposal(toolName);
      changePermission(state, toolName);
      const input = { ...request.data.input };
      delete input.expectedLoanVersion;
      await libraryTools[toolName].execute({ uid: 'alice', schoolId: 'pu' }, input);
      expect(mockPermissionReads).toEqual([]);
      expect(mockWrites.some(isServicePath)).toBe(true);
      expect(mockDocuments.get(RUN_PATH).actionClaims).toBeUndefined();
    },
  );
});
