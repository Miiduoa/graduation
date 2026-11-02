'use strict';

const { transactionStore } = require('../../testSupport/transactionStore');
let mockStore;
let mockWrites;
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockStore.db,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}));

// Keep both the service guards and receipt validation real. Only the database
// transport is synthetic; no Firebase app or external service is initialized.
const returnBook = require('./returnBook');
const { confirmedAgentWrite } = require('../actionReceipt');

const ctx = { uid: 'alice', schoolId: 'pu' };
const input = { loanId: 'loan-1' };
const loanPath = 'schools/pu/libraryLoans/loan-1';
const bookPath = 'schools/pu/libraryBooks/book-1';
const mirrorPath = 'users/alice/schools/pu/libraryLoans/loan-1';
const guardPath = 'users/alice/schools/pu/serviceWriteGuards/library';

beforeEach(() => {
  mockStore = transactionStore([
    ['users/alice', { schoolId: 'pu' }],
    ['schools/pu/members/alice', { status: 'active' }],
    [loanPath, {
      userId: 'alice', schoolId: 'pu', bookId: 'book-1',
      bookTitle: '資料庫入門', status: 'borrowed',
    }],
    [bookPath, { title: '資料庫入門', availableCopies: 2, available: 2 }],
  ]);
  mockStore.db.doc = (path) => path.split('/').reduce((ref, key, index) =>
    index % 2 === 0 ? ref.collection(key) : ref.doc(key), mockStore.db);
  mockWrites = { set: jest.fn(), update: jest.fn() };
  const runTransaction = mockStore.db.runTransaction.bind(mockStore.db);
  mockStore.db.runTransaction = (callback) => runTransaction((tx) => callback({
    ...tx,
    set: (...args) => { mockWrites.set(...args); return tx.set(...args); },
    update: (...args) => { mockWrites.update(...args); return tx.update(...args); },
  }));
});

function expectReturned() {
  expect(mockStore.docs.get(loanPath)).toMatchObject({
    status: 'returned', returnedAt: 'server-timestamp',
  });
  expect(mockStore.docs.get(mirrorPath)).toMatchObject({
    userId: 'alice', schoolId: 'pu', bookId: 'book-1',
    status: 'returned', returnedAt: 'server-timestamp',
  });
  expect(mockStore.docs.get(bookPath)).toMatchObject({ availableCopies: 3, available: 3 });
  expect(mockStore.docs.get(guardPath)).toEqual({ updatedAt: 'server-timestamp' });
  expect(mockWrites.set).toHaveBeenCalledTimes(2);
  expect(mockWrites.update).toHaveBeenCalledTimes(2);
}

test.each(['資料庫入門', '  資料庫入門  '])('a completed return preserves title %j and passes the real receipt gate', async (bookTitle) => {
  mockStore.docs.set(loanPath, { ...mockStore.docs.get(loanPath), bookTitle });
  expect(returnBook.requiresConfirmation).toBe(true);
  const result = await returnBook.execute(ctx, input);
  expectReturned();
  expect(result).toEqual({ success: true, bookTitle });
  expect(confirmedAgentWrite('returnBook', result, input, ctx)).toBe(true);
});

test.each([
  ['spaces', '   '],
  ['Unicode whitespace', '\t\n\u3000'],
  ['number', 123],
  ['boolean', true],
  ['object', { title: 'display data' }],
  ['array', ['display data']],
  ['empty string', ''],
  ['null', null],
  ['missing', undefined],
])('a completed return with %s title has a confirmable book ID fallback', async (_label, title) => {
  mockStore.docs.set(loanPath, { ...mockStore.docs.get(loanPath), bookTitle: title });
  const result = await returnBook.execute(ctx, input);
  // The regression is an already-committed return misreported as unverified.
  // Verify the writes before asserting the real consumer's success decision.
  expectReturned();
  expect(confirmedAgentWrite('returnBook', result, input, ctx)).toBe(true);
  expect(result).toEqual({ success: true, bookTitle: 'book-1' });
});

test.each([
  ['missing loan', loanPath, undefined, 'not-found'],
  ['missing book', bookPath, undefined, 'failed-precondition'],
  ['another borrower', loanPath, { userId: 'bob' }, 'permission-denied'],
  ['already returned', loanPath, { status: 'returned' }, 'failed-precondition'],
  ['invalid book ID', loanPath, { bookId: 'other/book' }, 'failed-precondition'],
  ['missing membership', 'schools/pu/members/alice', undefined, 'permission-denied'],
  ['inactive membership', 'schools/pu/members/alice', { status: 'inactive' }, 'permission-denied'],
  ['account deletion', 'users/alice', { accountDeletionInProgress: true }, 'failed-precondition'],
  ['deleted account', 'users/alice', { status: 'deleted' }, 'failed-precondition'],
  ['invalid stock', bookPath, { availableCopies: -1 }, 'failed-precondition'],
])('%s still fails before any write', async (_label, path, patch, code) => {
  if (patch === undefined) mockStore.docs.delete(path);
  else mockStore.docs.set(path, { ...mockStore.docs.get(path), ...patch });
  const before = new Map(mockStore.docs);
  await expect(returnBook.execute(ctx, input)).rejects.toMatchObject({ code });
  expect(mockWrites.set).not.toHaveBeenCalled();
  expect(mockWrites.update).not.toHaveBeenCalled();
  expect(mockStore.docs).toEqual(before);
});

test('a failed transaction commit never produces a successful receipt', async () => {
  const before = new Map(mockStore.docs);
  mockStore.failNextCommit();
  await expect(returnBook.execute(ctx, input)).rejects.toThrow('commit unavailable');
  expect(mockStore.docs).toEqual(before);
});
