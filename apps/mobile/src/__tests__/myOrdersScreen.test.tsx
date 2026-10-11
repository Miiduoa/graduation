import React from 'react';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockUser: { uid: string } | null = { uid: 'alice' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// 伺服器上的學生訂單副本（模擬 Firestore）；App 重開後重新訂閱，一樣從這裡讀
let mockServerRows: Array<{ id: string; data: Record<string, unknown> }> = [];
const mockListeners: Array<() => void> = [];
const mockQueryPaths: string[] = [];
jest.mock('../firebase', () => ({
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  getAuthInstance: () => ({ currentUser: { uid: 'alice' } }),
  isFirebaseMockMode: () => false,
}));
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: jest.fn(),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
  query: (ref: { path: string }) => ref,
  orderBy: jest.fn(),
  limit: jest.fn(),
  onSnapshot: (ref: { path: string }, next: (snapshot: unknown) => void) => {
    mockQueryPaths.push(ref.path);
    const emit = () =>
      next({ docs: mockServerRows.map((row) => ({ id: row.id, data: () => row.data })) });
    mockListeners.push(emit);
    emit();
    return () => undefined;
  },
}));

import MyOrdersScreen from '../screens/MyOrdersScreen';

const placed = { toDate: () => new Date('2026-10-13T04:05:00.000Z') };
beforeEach(async () => {
  mockUser = { uid: 'alice' };
  mockListeners.length = 0;
  mockQueryPaths.length = 0;
  await AsyncStorage.clear();
  mockServerRows = [
    {
      id: 'co_numbered_aaa111',
      data: { status: 'confirmed', queueNumber: 7, cafeteria: '校園餐廳', total: 100, createdAt: placed, items: [{ name: '雞腿飯', quantity: 1 }] },
    },
    {
      id: 'co_waiting_bbb222',
      data: { status: 'pending', queueNumber: null, cafeteria: '校園餐廳', total: 60, createdAt: placed, items: [{ name: '紅茶', quantity: 2 }] },
    },
    {
      id: 'co_cancel_ccc333',
      data: { status: 'cancelled', queueNumber: null, cancelledQueueNumber: 5, cancelledBy: 'merchant', cafeteria: '校園餐廳', total: 80, createdAt: placed, items: [] },
    },
  ];
});

test('我的訂單：讀伺服器上學生自己的訂單，有號碼寫號碼，沒號碼寫待給號碼兩行，店家取消寫「這張單店家取消了」', async () => {
  const view = render(<MyOrdersScreen />);
  await act(async () => {});
  expect(mockQueryPaths).toEqual(['users/alice/schools/pu/orders']);
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
  expect(view.getByText('號碼還沒拿到，請到櫃台確認。')).toBeTruthy();
  expect(view.getByText('10 月 13 日（二）12:05・紅茶 ×2')).toBeTruthy();
  expect(view.getByText('狀態：待給號碼')).toBeTruthy();
  expect(view.getByText('這張單店家取消了')).toBeTruthy();
  expect(view.queryByText('取餐號碼 5')).toBeNull();
  expect(view.getByText('訂單末 6 碼 AAA111')).toBeTruthy();
  expect(view.queryByText(/待確認/)).toBeNull();
});

test('App 關掉重開：號碼一樣從伺服器讀回來，不靠手機本機存的訂單', async () => {
  const first = render(<MyOrdersScreen />);
  await act(async () => {});
  expect(first.getByText('取餐號碼 7')).toBeTruthy();
  first.unmount();
  await AsyncStorage.clear(); // 本機什麼都沒有
  const reopened = render(<MyOrdersScreen />);
  await act(async () => {});
  expect(reopened.getByText('取餐號碼 7')).toBeTruthy();
  expect(mockQueryPaths).toEqual(['users/alice/schools/pu/orders', 'users/alice/schools/pu/orders']);
});

test('店家之後給號碼或取消，畫面跟著更新', async () => {
  const view = render(<MyOrdersScreen />);
  await act(async () => {});
  mockServerRows = mockServerRows.map((row) =>
    row.id === 'co_waiting_bbb222'
      ? { ...row, data: { ...row.data, status: 'confirmed', queueNumber: 8 } }
      : row.id === 'co_numbered_aaa111'
        ? { ...row, data: { ...row.data, status: 'cancelled', queueNumber: null, cancelledBy: 'merchant' } }
        : row,
  );
  await act(async () => mockListeners.forEach((emit) => emit()));
  expect(view.getByText('取餐號碼 8')).toBeTruthy();
  expect(view.queryByText('取餐號碼 7')).toBeNull();
  expect(view.getAllByText('這張單店家取消了')).toHaveLength(2);
});

test('沒有訂單：寫還沒有訂單', async () => {
  mockServerRows = [];
  const view = render(<MyOrdersScreen />);
  await act(async () => {});
  expect(view.getByText('還沒有訂單')).toBeTruthy();
});
