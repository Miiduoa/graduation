'use strict';

const { transactionStore } = require('../testSupport/transactionStore');
let mockStore;
let mockWrites;

jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockStore.db,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}));

const { Timestamp } = require('firebase-admin/firestore');
const { projectLibraryLoan, libraryLoanVersion, assertLibraryLoanVersion } = require('./libraryLoanSource');
const renewBook = require('./tools/renewBook');
const returnBook = require('./tools/returnBook');

const canonicalPath = 'schools/pu/libraryLoans/loan-1';
const mirrorPath = 'users/alice/schools/pu/libraryLoans/loan-1';
const bookPath = 'schools/pu/libraryBooks/book-1';
const scope = { uid: 'alice', schoolId: 'pu' };
const agentScope = { ...scope, agentActionKey: 'saved-server-run:0' };
const staleMessage = '借閱資料已變更，請重新查詢並確認。';

function initialLoan() {
  return {
    userId: 'alice', schoolId: 'pu', bookId: 'book-1', bookTitle: '資料結構',
    borrowedAt: Timestamp.fromDate(new Date('2026-11-01T00:00:00.000Z')),
    dueAt: Timestamp.fromDate(new Date('2026-11-15T00:00:00.000Z')),
    status: 'borrowed', renewCount: 0,
  };
}

function reviewedInput() {
  return { loanId: 'loan-1', expectedLoanVersion: libraryLoanVersion(mockStore.docs.get(canonicalPath)) };
}

function expectNoWrites(before) {
  expect(mockWrites.set).not.toHaveBeenCalled();
  expect(mockWrites.update).not.toHaveBeenCalled();
  expect(mockStore.docs).toEqual(before);
}

beforeEach(() => {
  const row = initialLoan();
  mockStore = transactionStore([
    ['users/alice', { schoolId: 'pu' }],
    ['schools/pu/members/alice', { status: 'active' }],
    [canonicalPath, row], [mirrorPath, { ...row }],
    [bookPath, { title: '資料結構', availableCopies: 0, available: 0 }],
    ['schools/pu/libraryBooks/book-2', { title: '演算法', availableCopies: 0, available: 0 }],
  ]);
  mockStore.db.doc = (path) => path.split('/').reduce((ref, key, index) =>
    index % 2 === 0 ? ref.collection(key) : ref.doc(key), mockStore.db);
  mockWrites = { set: jest.fn(), update: jest.fn() };
  const transact = mockStore.db.runTransaction.bind(mockStore.db);
  mockStore.db.runTransaction = (callback) => transact((tx) => callback({
    ...tx,
    set: (...args) => { mockWrites.set(...args); return tx.set(...args); },
    update: (...args) => { mockWrites.update(...args); return tx.update(...args); },
  }));
});

describe('library loan projection and version', () => {
  test('uses the reader projection for canonical timestamps and legacy ISO values', () => {
    const row = initialLoan();
    const projected = projectLibraryLoan('loan-1', row);
    expect(projected).toEqual({
      id: 'loan-1', bookId: 'book-1', bookTitle: '資料結構',
      borrowedAt: '2026-11-01T00:00:00.000Z', dueAt: '2026-11-15T00:00:00.000Z',
      status: 'borrowed', renewCount: 0,
    });
    expect(libraryLoanVersion(row)).toMatch(/^[a-f0-9]{64}$/);
    expect(libraryLoanVersion(projected)).toBe(libraryLoanVersion(row));
    expect(libraryLoanVersion({ ...projected, id: 'different-id', privateNote: 'not reviewed' }))
      .toBe(libraryLoanVersion(row));
    expect(row.borrowedAt).toBeInstanceOf(Timestamp);
  });

  test('preserves legacy title, dueDate, status/count defaults and the Unix epoch', () => {
    const row = { bookId: 123, title: '舊版書名', borrowedAt: { toMillis: () => 0 }, dueDate: '2026-11-15T08:00:00+08:00' };
    expect(projectLibraryLoan('legacy', row)).toEqual({
      id: 'legacy', bookId: '123', bookTitle: '舊版書名', borrowedAt: '1970-01-01T00:00:00.000Z',
      dueAt: '2026-11-15T00:00:00.000Z', status: 'borrowed', renewCount: 0,
    });
    expect(projectLibraryLoan('legacy', { ...row, bookTitle: '目前書名', dueAt: '2026-11-22' }))
      .toMatchObject({ bookTitle: '目前書名', dueAt: '2026-11-22T00:00:00.000Z' });
  });

  test.each([
    undefined, null, 'not-a-date', {}, new Date(NaN),
    { toMillis: () => NaN }, { toMillis: () => Infinity },
    { toMillis: () => 8_640_000_000_000_001 },
    { toMillis: () => { throw new Error('broken timestamp'); } },
  ])('omits invalid dates without inventing a reviewed deadline: %p', (invalid) => {
    expect(projectLibraryLoan('loan-1', { borrowedAt: invalid, dueAt: invalid }))
      .toMatchObject({ borrowedAt: undefined, dueAt: undefined });
  });

  test('does not let a digest substitute for caller authorization', () => {
    const row = initialLoan();
    const input = { expectedLoanVersion: libraryLoanVersion(row) };
    expect(() => assertLibraryLoanVersion(agentScope, input, row)).not.toThrow();
    expect(() => assertLibraryLoanVersion(scope, {}, row)).not.toThrow();
    expect(() => assertLibraryLoanVersion(agentScope, {}, row)).toThrow(staleMessage);
    expect(() => assertLibraryLoanVersion(scope, { expectedLoanVersion: '0'.repeat(64) }, row)).toThrow(staleMessage);
  });
});

describe.each([['renewBook', renewBook], ['returnBook', returnBook]])('%s reviewed source guard', (_name, tool) => {
  test('permits an unchanged Agent loan and updates both canonical and mirror atomically', async () => {
    const result = await tool.execute(agentScope, reviewedInput());
    expect(result.success).toBe(true);
    expect(mockWrites.update).toHaveBeenCalled();
    expect(mockStore.docs.get(mirrorPath)).toEqual(mockStore.docs.get(canonicalPath));
  });

  test.each([
    ['book identity', { bookId: 'book-2' }],
    ['displayed title', { bookTitle: '演算法' }],
    ['borrowed date', { borrowedAt: Timestamp.fromDate(new Date('2026-11-02T00:00:00.000Z')) }],
    ['deadline', { dueAt: Timestamp.fromDate(new Date('2026-11-22T00:00:00.000Z')) }],
    ['renewal count', { renewCount: 1 }],
    ['active status', { status: 'active' }],
  ])('rejects a changed %s before touching loan, mirror or stock', async (_label, patch) => {
    const input = reviewedInput();
    mockStore.docs.set(canonicalPath, { ...mockStore.docs.get(canonicalPath), ...patch });
    const before = new Map(mockStore.docs);
    await expect(tool.execute(agentScope, input)).rejects.toMatchObject({ code: 'failed-precondition', message: staleMessage });
    expectNoWrites(before);
  });

  test('rejects an old Agent draft without source evidence but preserves ordinary direct calls', async () => {
    const before = new Map(mockStore.docs);
    await expect(tool.execute(agentScope, { loanId: 'loan-1' })).rejects.toMatchObject({ code: 'failed-precondition', message: staleMessage });
    expectNoWrites(before);
    expect((await tool.execute(scope, { loanId: 'loan-1' })).success).toBe(true);
  });

  test('rejects an explicitly stale version even for an ordinary direct call', async () => {
    const before = new Map(mockStore.docs);
    await expect(tool.execute(scope, { loanId: 'loan-1', expectedLoanVersion: '0'.repeat(64) }))
      .rejects.toMatchObject({ code: 'failed-precondition', message: staleMessage });
    expectNoWrites(before);
  });

  test('still checks borrower ownership before comparing the source digest', async () => {
    const input = reviewedInput();
    mockStore.docs.set(canonicalPath, { ...mockStore.docs.get(canonicalPath), userId: 'bob' });
    const before = new Map(mockStore.docs);
    await expect(tool.execute(agentScope, input)).rejects.toMatchObject({ code: 'permission-denied' });
    expectNoWrites(before);
  });

  test.each(['A'.repeat(64), '0'.repeat(63), 'not-a-hash'])('rejects malformed source version %s', async (expectedLoanVersion) => {
    const before = new Map(mockStore.docs);
    await expect(tool.execute(agentScope, { loanId: 'loan-1', expectedLoanVersion })).rejects.toThrow();
    expectNoWrites(before);
  });
});

test('an intervening normal renewal makes the pending Agent confirmation stale without spending another renewal', async () => {
  const input = reviewedInput();
  const normal = await renewBook.execute(scope, { loanId: 'loan-1' });
  expect(normal).toMatchObject({ success: true, renewCount: 1, newDueAt: '2026-11-22T00:00:00.000Z' });
  mockWrites.set.mockClear();
  mockWrites.update.mockClear();
  const before = new Map(mockStore.docs);

  await expect(renewBook.execute(agentScope, input)).rejects.toMatchObject({ code: 'failed-precondition', message: staleMessage });

  expectNoWrites(before);
  expect(mockStore.docs.get(canonicalPath).renewCount).toBe(1);
});
