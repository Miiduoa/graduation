import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockNavigate = jest.fn();
let mockEmit: (orders: unknown[]) => void = () => undefined;
const mockWatch = jest.fn((_scope: unknown, onChange: (orders: unknown[]) => void) => {
  mockEmit = onChange;
  return () => undefined;
});
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'alice' } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' } }) }));
jest.mock('../state/theme', () => ({
  useTheme: () => ({ colors: { border: '#ccc', surface: '#fff', text: '#000', muted: '#666' }, radius: { md: 12 } }),
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: (_nav: unknown, route: string) => mockNavigate(route) }));
jest.mock('../features/dining', () => ({ watchMyOrders: (...args: [unknown, (orders: unknown[]) => void]) => mockWatch(...args) }));

import { OpenOrderCard, latestOpenOrder } from '../components/OpenOrderCard';

const base = { shop: '校園餐廳', total: 100, createdAt: '2026-10-13T04:05:00.000Z', items: [{ name: '雞腿飯', quantity: 1 }], cancelledBy: null, cancelReason: null };

beforeEach(() => mockNavigate.mockReset());

test('有還沒取餐的單：首頁顯示取餐號碼，點了開我的訂單', () => {
  const view = render(<OpenOrderCard navigation={{}} />);
  expect(mockWatch.mock.calls.at(-1)?.[0]).toEqual({ userId: 'alice', schoolId: 'pu' });
  act(() => mockEmit([{ ...base, id: 'co_aaaaaa111111', status: 'confirmed', queueNumber: 7 }]));
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
  expect(view.getByText('訂單末 6 碼 111111 · 看我的訂單')).toBeTruthy();
  fireEvent.press(view.getByText('取餐號碼 7'));
  expect(mockNavigate).toHaveBeenCalledWith('StudentOrders');
});

test('還沒號碼：寫待給號碼兩行', () => {
  const view = render(<OpenOrderCard />);
  act(() => mockEmit([{ ...base, id: 'co_bbbbbb222222', status: 'pending', queueNumber: null }]));
  expect(view.getByText('號碼還沒拿到，請到櫃台確認。')).toBeTruthy();
  expect(view.getByText('狀態：待給號碼')).toBeTruthy();
});

test('沒有還沒取餐的單（已取餐、已取消）：整張不出現', () => {
  const view = render(<OpenOrderCard />);
  act(() => mockEmit([
    { ...base, id: 'co_c1', status: 'completed', queueNumber: 3 },
    { ...base, id: 'co_c2', status: 'cancelled', queueNumber: null },
  ]));
  expect(view.queryByText(/取餐號碼|號碼還沒拿到/)).toBeNull();
  expect(latestOpenOrder([])).toBeNull();
});
