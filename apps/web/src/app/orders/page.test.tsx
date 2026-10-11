import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  rows: [] as Array<{ id: string; data: Record<string, unknown> }>,
  emitters: [] as Array<() => void>,
  paths: [] as string[],
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: state.uid ? { uid: state.uid } : null, loading: false, error: null }) }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/lib/pageContext', () => ({ resolveSchoolPageContext: () => ({ schoolId: 'pu', schoolName: '靜宜大學', schoolCode: 'PU' }) }));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}), isFirebaseConfigured: () => true }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (ref: { path: string }) => ref,
  orderBy: () => null,
  limit: () => null,
  onSnapshot: (ref: { path: string }, next: (snapshot: unknown) => void) => {
    state.paths.push(ref.path);
    const emit = () => next({ docs: state.rows.map(row => ({ id: row.id, data: () => row.data })) });
    state.emitters.push(emit);
    emit();
    return () => undefined;
  },
}));

import OrdersPage from './page';

const placed = { toDate: () => new Date('2026-10-13T04:05:00.000Z') };
beforeEach(() => {
  state.uid = 'alice';
  state.paths = [];
  state.emitters = [];
  state.rows = [
    { id: 'co_numbered_aaa111', data: { status: 'ready', queueNumber: 7, cafeteria: '校園餐廳', total: 100, createdAt: placed, items: [{ name: '雞腿飯', quantity: 1 }] } },
    { id: 'co_waiting_bbb222', data: { status: 'pending', queueNumber: null, cafeteria: '校園餐廳', total: 60, createdAt: placed, items: [{ name: '紅茶', quantity: 2 }] } },
    { id: 'co_cancel_ccc333', data: { status: 'cancelled', queueNumber: null, cancelledQueueNumber: 5, cancelledBy: 'merchant', cafeteria: '校園餐廳', createdAt: placed, items: [] } },
  ];
});

it('我的訂單（網頁）：讀伺服器上學生自己的訂單，號碼、待給號碼兩行、店家取消都照實顯示', () => {
  render(<OrdersPage />);
  expect(state.paths).toEqual(['users/alice/schools/pu/orders']);
  expect(screen.getByText('取餐號碼 7')).toBeTruthy();
  expect(screen.getByText('號碼還沒拿到，請到櫃台確認。')).toBeTruthy();
  expect(screen.getByText('10 月 13 日（二）12:05・紅茶 ×2')).toBeTruthy();
  expect(screen.getByText('狀態：待給號碼')).toBeTruthy();
  expect(screen.getByText('這張單店家取消了')).toBeTruthy();
  expect(screen.queryByText('取餐號碼 5')).toBeNull();
  expect(screen.getAllByText('訂單末 6 碼 AAA111').length).toBeGreaterThan(0);
  expect(screen.queryByText(/待確認/)).toBeNull();
});

it('店家給號碼或取消後即時更新', async () => {
  render(<OrdersPage />);
  state.rows = state.rows.map(row => row.id === 'co_waiting_bbb222' ? { ...row, data: { ...row.data, status: 'confirmed', queueNumber: 9 } } : row);
  await act(async () => state.emitters.forEach(emit => emit()));
  expect(screen.getByText('取餐號碼 9')).toBeTruthy();
  expect(screen.queryByText('號碼還沒拿到，請到櫃台確認。')).toBeNull();
});

it('沒登入：請先登入，不讀訂單', () => {
  state.uid = null;
  render(<OrdersPage />);
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe('/login?returnUrl=%2Forders');
  expect(state.paths).toEqual([]);
});
