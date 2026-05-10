'use strict';

const mockGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockGet }));
const mockCollectionLoans = jest.fn(() => ({ limit: mockLimit }));
const mockDocSchool = jest.fn(() => ({ collection: mockCollectionLoans }));
const mockCollectionSchools = jest.fn(() => ({ doc: mockDocSchool }));
const mockDocUser = jest.fn(() => ({ collection: mockCollectionSchools }));

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name) => {
      expect(name).toBe('users');
      return { doc: mockDocUser };
    }),
  })),
  Timestamp: class {
    constructor(seconds, nanoseconds) {
      this._seconds = seconds;
      this._nanoseconds = nanoseconds;
    }
    toMillis() {
      return this._seconds * 1000;
    }
  },
}));

const getLibraryLoans = require('./getLibraryLoans');

describe('getLibraryLoans tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns empty when uid or schoolId missing', async () => {
    const a = await getLibraryLoans.execute({ uid: '', schoolId: 's1' }, {});
    expect(a.ok).toBe(false);
    const b = await getLibraryLoans.execute({ uid: 'u1', schoolId: '' }, {});
    expect(b.ok).toBe(false);
  });

  test('filters returned loans and onlyOverdue', async () => {
    const past = Date.now() - 86400000;
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'l1',
          data: () => ({
            bookId: 'b1',
            bookTitle: 'A',
            status: 'borrowed',
            dueAt: new Date(past).toISOString(),
            borrowedAt: '2025-01-01',
            renewCount: 0,
          }),
        },
        {
          id: 'l2',
          data: () => ({
            bookId: 'b2',
            bookTitle: 'B',
            status: 'returned',
            dueAt: new Date(Date.now() + 86400000).toISOString(),
          }),
        },
        {
          id: 'l3',
          data: () => ({
            bookId: 'b3',
            bookTitle: 'C',
            status: 'borrowed',
            dueAt: new Date(Date.now() + 86400000).toISOString(),
          }),
        },
      ],
    });

    const all = await getLibraryLoans.execute({ uid: 'u1', schoolId: 'sch' }, {});
    expect(mockDocUser).toHaveBeenCalledWith('u1');
    expect(mockDocSchool).toHaveBeenCalledWith('sch');
    expect(all.ok).toBe(true);
    expect(all.count).toBe(2);
    expect(all.loans.map((x) => x.id).sort()).toEqual(['l1', 'l3']);

    const overdueOnly = await getLibraryLoans.execute({ uid: 'u1', schoolId: 'sch' }, { onlyOverdue: true });
    expect(overdueOnly.count).toBe(1);
    expect(overdueOnly.loans[0].id).toBe('l1');
  });
});
