'use strict';

const mockGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockGet }));
const mockCollectionLoans = jest.fn(() => ({ limit: mockLimit }));
const mockDocSchool = jest.fn(() => ({ collection: mockCollectionLoans }));
const mockCollectionSchools = jest.fn(() => ({ doc: mockDocSchool }));
const mockDocUser = jest.fn(() => ({ collection: mockCollectionSchools }));

jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name) => {
      expect(name).toBe('users');
      return { doc: mockDocUser };
    }),
  })),
}));

const { Timestamp } = require('firebase-admin/firestore');
const getLibraryLoans = require('./getLibraryLoans');
const now = Date.parse('2026-11-02T00:00:00.000Z');

function mockLoans(rows) {
  mockGet.mockResolvedValue({
    docs: rows.map((row, index) => ({
      id: row.id || `loan-${index + 1}`,
      data: () => ({ bookId: 'book-1', bookTitle: 'Library book', status: 'borrowed', ...row }),
    })),
  });
}

describe('getLibraryLoans tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockReset();
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => jest.restoreAllMocks());

  test('returns empty when uid or schoolId missing', async () => {
    const a = await getLibraryLoans.execute({ uid: '', schoolId: 's1' }, {});
    expect(a.ok).toBe(false);
    const b = await getLibraryLoans.execute({ uid: 'u1', schoolId: '' }, {});
    expect(b.ok).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
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

  test('projects real producer Timestamp fields as ISO strings without mutating source data', async () => {
    const borrowedAt = Timestamp.fromDate(new Date('2026-11-01T01:02:03.456Z'));
    const dueAt = Timestamp.fromDate(new Date('2026-11-15T01:02:03.456Z'));
    mockLoans([{ borrowedAt, dueAt, renewCount: 0 }]);

    const result = await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, {});

    expect(result.loans[0]).toMatchObject({
      borrowedAt: '2026-11-01T01:02:03.456Z', dueAt: '2026-11-15T01:02:03.456Z', renewCount: 0,
    });
    expect(borrowedAt).toBeInstanceOf(Timestamp);
    expect(dueAt.toDate().toISOString()).toBe('2026-11-15T01:02:03.456Z');
    expect(JSON.stringify(result)).not.toContain('[object Object]');
  });

  test('keeps timestamps at the Unix epoch rather than treating zero as a missing date', async () => {
    mockLoans([{ borrowedAt: Timestamp.fromMillis(0), dueAt: Timestamp.fromMillis(0) }]);
    const result = await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, { onlyOverdue: true });
    expect(result.count).toBe(1);
    expect(result.loans[0]).toMatchObject({
      borrowedAt: '1970-01-01T00:00:00.000Z', dueAt: '1970-01-01T00:00:00.000Z',
    });
  });

  test('normalizes valid legacy date strings and dueDate fallback to ISO', async () => {
    mockLoans([{ borrowedAt: '2026-11-01', dueAt: null, dueDate: '2026-11-04T09:00:00+08:00' }]);
    const result = await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, {});
    expect(result.loans[0]).toMatchObject({
      borrowedAt: '2026-11-01T00:00:00.000Z', dueAt: '2026-11-04T01:00:00.000Z',
    });
  });

  test('prefers a current dueAt over the older legacy dueDate after renewal', async () => {
    mockLoans([{
      dueAt: Timestamp.fromDate(new Date('2026-11-09T00:00:00Z')),
      dueDate: '2026-11-01T00:00:00Z', renewCount: 1,
    }]);
    const all = await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, {});
    expect(all.loans[0]).toMatchObject({ dueAt: '2026-11-09T00:00:00.000Z', renewCount: 1 });
    expect((await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, { onlyOverdue: true })).loans).toEqual([]);
  });

  test('continues to support valid toMillis-only timestamps', async () => {
    mockLoans([{
      borrowedAt: { toMillis: () => now - 86_400_000 },
      dueAt: { toMillis: () => now + 86_400_000 },
    }]);
    const result = await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, {});
    expect(result.loans[0]).toMatchObject({
      borrowedAt: '2026-11-01T00:00:00.000Z', dueAt: '2026-11-03T00:00:00.000Z',
    });
  });

  test.each([
    ['missing', undefined],
    ['null', null],
    ['invalid string', 'not-a-date'],
    ['plain object', {}],
    ['throwing toMillis', { toMillis: () => { throw new Error('broken timestamp'); } }],
    ['NaN milliseconds', { toMillis: () => NaN }],
    ['infinite milliseconds', { toMillis: () => Infinity }],
    ['out-of-range milliseconds', { toMillis: () => 8_640_000_000_000_001 }],
    ['invalid Date', new Date(NaN)],
  ])('omits %s date values without failing the whole loan list', async (_label, value) => {
    mockLoans([{ borrowedAt: value, dueAt: value }]);
    const result = await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, {});
    expect(result).toMatchObject({ ok: true, count: 1 });
    expect(result.loans[0].borrowedAt).toBeUndefined();
    expect(result.loans[0].dueAt).toBeUndefined();
    expect((await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, { onlyOverdue: true })).loans).toEqual([]);
  });

  test('uses the same valid date for overdue filtering and excludes returned loans', async () => {
    mockLoans([
      { id: 'late', dueAt: Timestamp.fromMillis(now - 1) },
      { id: 'exactly-now', dueAt: Timestamp.fromMillis(now) },
      { id: 'future', dueAt: Timestamp.fromMillis(now + 1) },
      { id: 'returned', status: 'returned', dueAt: Timestamp.fromMillis(now - 1) },
      { id: 'status-only', status: 'overdue', dueAt: 'bad-date' },
      { id: 'invalid', dueAt: { toMillis: () => -Infinity } },
    ]);
    const result = await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, { onlyOverdue: true });
    expect(result.loans.map((loan) => loan.id)).toEqual(['late', 'status-only']);
    expect(result.loans[0].dueAt).toBe('2026-11-01T23:59:59.999Z');
    expect(result.loans[1].dueAt).toBeUndefined();
  });

  test('always queries the current account and school, not caller-supplied input scope', async () => {
    mockGet
      .mockResolvedValueOnce({ docs: [{ id: 'alice-pu', data: () => ({ dueAt: Timestamp.fromMillis(now) }) }] })
      .mockResolvedValueOnce({ docs: [{ id: 'alice-ntu', data: () => ({ dueAt: Timestamp.fromMillis(now) }) }] })
      .mockResolvedValueOnce({ docs: [{ id: 'bob-pu', data: () => ({ dueAt: Timestamp.fromMillis(now) }) }] });
    const first = await getLibraryLoans.execute({ uid: 'alice', schoolId: 'pu' }, { uid: 'bob', schoolId: 'ntu' });
    const second = await getLibraryLoans.execute({ uid: 'alice', schoolId: 'ntu' }, {});
    const third = await getLibraryLoans.execute({ uid: 'bob', schoolId: 'pu' }, {});
    expect(mockDocUser.mock.calls).toEqual([['alice'], ['alice'], ['bob']]);
    expect(mockCollectionSchools.mock.calls).toEqual([['schools'], ['schools'], ['schools']]);
    expect(mockDocSchool.mock.calls).toEqual([['pu'], ['ntu'], ['pu']]);
    expect(mockCollectionLoans.mock.calls).toEqual([['libraryLoans'], ['libraryLoans'], ['libraryLoans']]);
    expect(mockLimit.mock.calls).toEqual([[50], [50], [50]]);
    expect([first, second, third].map((result) => result.loans[0].id)).toEqual(['alice-pu', 'alice-ntu', 'bob-pu']);
  });
});
