import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CafeteriaPage from './page';
const state = vi.hoisted(() => ({
  configured: true,
  school: 'pu',
  uid: 'a',
  cafeterias: [] as Array<{ next: (rows: unknown[]) => void; fail: (error: unknown) => void }>,
  menus: [] as Array<{ next: (rows: unknown[]) => void; fail: (error: unknown) => void }>,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: { uid: state.uid }, loading: false }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/lib/pageContext', () => ({
  resolveSchoolPageContext: () => ({
    schoolId: state.school,
    schoolName: state.school,
    schoolSearch: '',
  }),
}));
vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => state.configured,
  fetchCafeterias: vi.fn(),
  fetchMenus: vi.fn(),
  subscribeCafeterias: (
    _: string,
    next: (rows: unknown[]) => void,
    fail: (error: unknown) => void,
  ) => {
    state.cafeterias.push({ next, fail });
    return () => {};
  },
  subscribeMenus: (_: string, next: (rows: unknown[]) => void, fail: (error: unknown) => void) => {
    state.menus.push({ next, fail });
    return () => {};
  },
}));
beforeEach(() => {
  state.configured = true;
  state.school = 'pu';
  state.uid = 'a';
  state.cafeterias = [];
  state.menus = [];
});
afterEach(cleanup);
function receive(index = 0) {
  act(() => {
    state.cafeterias[index].next([{ id: 'stall', name: '校內咖啡店' }]);
    state.menus[index].next([
      {
        id: 'meal',
        cafeteriaId: 'stall',
        cafeteria: '校內咖啡店',
        name: '蔬菜吐司',
        price: 60,
        availableOn: '2026-10-08',
        available: true,
      },
    ]);
  });
}
it('does not display sample menus without a configured service', () => {
  state.configured = false;
  render(<CafeteriaPage />);
  expect(screen.getByRole('alert').textContent).toContain('暫時無法讀取餐廳資料');
  expect(screen.queryByText(/示範資料/)).toBeNull();
  expect(state.menus).toHaveLength(0);
});
it('shows actual source rows and hides them after a source failure', () => {
  render(<CafeteriaPage />);
  receive();
  expect(screen.getByText('蔬菜吐司')).toBeTruthy();
  expect(screen.getByText('NT$60')).toBeTruthy();
  act(() => state.menus[0].fail(new Error('offline')));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText('蔬菜吐司')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  expect(state.menus).toHaveLength(2);
  receive(1);
  expect(screen.getByText('蔬菜吐司')).toBeTruthy();
});
it('does not interpret an empty source as an unavailable service', () => {
  render(<CafeteriaPage />);
  act(() => {
    state.cafeterias[0].next([]);
    state.menus[0].next([]);
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('餐廳資料')).toBeTruthy();
  expect(screen.queryByText(/示範資料/)).toBeNull();
});
it('distinguishes unknown availability, paused supply and sold-out meals without claiming ordering is available', () => {
  render(<CafeteriaPage />);
  act(() => {
    state.cafeterias[0].next([
      { id: 'stall', name: '校內咖啡店', orderingEnabled: true, pilotStatus: 'live' },
    ]);
    state.menus[0].next([
      { id: 'unknown', cafeteriaId: 'stall', name: '未知供應餐點' },
      { id: 'paused', cafeteriaId: 'stall', name: '暫停餐點', available: false },
      { id: 'sold-out', cafeteriaId: 'stall', name: '售完餐點', available: true, soldOut: true },
      { id: 'available', cafeteriaId: 'stall', name: '現有餐點', available: true },
    ]);
  });
  const restaurant = within(screen.getByRole('region', { name: '校內咖啡店' }));
  expect(restaurant.getByText('4 道餐點 · 1 道標記供應中')).toBeTruthy();
  expect(restaurant.getByText('供應狀態未確認')).toBeTruthy();
  expect(restaurant.getByText('暫停供應')).toBeTruthy();
  expect(restaurant.getByText('已售完')).toBeTruthy();
  expect(restaurant.getAllByText('供應中')).toHaveLength(1);
  expect(screen.getByText(/尚未開放線上點餐/)).toBeTruthy();
  expect(screen.queryByText('可點餐餐廳')).toBeNull();
});
it('exposes the selected restaurant and restores menus when clearing an empty search', () => {
  render(<CafeteriaPage />);
  receive();
  fireEvent.click(screen.getByRole('button', { name: '校內咖啡店' }));
  expect(screen.getByRole('button', { name: '校內咖啡店' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋餐點或餐廳' }), {
    target: { value: '不存在的餐點' },
  });
  expect(screen.queryByText('蔬菜吐司')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(screen.getByText('蔬菜吐司')).toBeTruthy();
  expect(screen.getByRole('button', { name: '全部餐廳' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});
it.each(['school', 'uid'] as const)(
  'clears loaded menus and rejects old listeners after changing %s',
  (key) => {
    const { rerender } = render(<CafeteriaPage />);
    receive();
    state[key] = 'different';
    rerender(<CafeteriaPage />);
    expect(screen.queryByText('蔬菜吐司')).toBeNull();
    receive(0);
    expect(screen.queryByText('蔬菜吐司')).toBeNull();
    receive(1);
    expect(screen.getByText('蔬菜吐司')).toBeTruthy();
  },
);
