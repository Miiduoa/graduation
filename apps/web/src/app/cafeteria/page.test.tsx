import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
