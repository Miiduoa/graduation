const calls: { where: unknown[][]; limit: number[]; path: string[] } = { where: [], limit: [], path: [] };
const mockUnsub = jest.fn();
let mockEmit: ((snap: unknown) => void) | null = null;
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => {
    calls.path = path;
    return { path };
  },
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  limit: (n: number) => {
    calls.limit.push(n);
    return { limit: n };
  },
  where: (...args: unknown[]) => {
    calls.where.push(args);
    return { where: args };
  },
  query: (...parts: unknown[]) => parts,
  onSnapshot: (_q: unknown, next: (snap: unknown) => void) => {
    mockEmit = next;
    return mockUnsub;
  },
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../firebase', () => ({ getDb: () => ({}), getFunctionsInstance: () => ({}) }));

import { watchMerchantOrders } from '../services/merchant';

beforeEach(() => {
  calls.where = [];
  calls.limit = [];
  calls.path = [];
  mockEmit = null;
});

test('監聽一定限定這家店，只看還沒結束的單，新的排前面，回傳的函式會關掉監聽', () => {
  const seen: string[][] = [];
  const unsubscribe = watchMerchantOrders({ schoolId: 'pu', cafeteriaId: 'cafe' }, (orders) =>
    seen.push(orders.map((o) => o.id)),
  );
  expect(calls.path).toEqual(['schools', 'pu', 'orders']);
  expect(calls.where).toEqual([
    ['cafeteriaId', '==', 'cafe'],
    ['status', 'in', ['pending', 'confirmed', 'preparing', 'ready']],
  ]);
  expect(calls.limit).toEqual([100]);

  mockEmit!({
    docs: [
      { id: 'old', data: () => ({ cafeteriaId: 'cafe', status: 'pending', createdAt: '2026-10-13T04:00:00.000Z' }) },
      { id: 'new', data: () => ({ cafeteriaId: 'cafe', status: 'pending', createdAt: '2026-10-13T04:09:00.000Z' }) },
    ],
  });
  expect(seen).toEqual([['new', 'old']]);

  unsubscribe();
  expect(mockUnsub).toHaveBeenCalledTimes(1);
});

test('顯示全部時才連已完成／已取消一起看，但還是只看這家店', () => {
  watchMerchantOrders({ schoolId: 'pu', cafeteriaId: 'cafe', includeClosed: true }, () => undefined);
  expect(calls.where).toEqual([['cafeteriaId', '==', 'cafe']]);
});
