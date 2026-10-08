import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HomePage from './page';
import { loadHomeData, type HomeData } from '@/lib/homeOverview';
const state = vi.hoisted(() => ({ uid: 'alice' as string | null }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({
    user: state.uid ? { uid: state.uid } : null,
    loading: false,
    signOutUser: vi.fn(),
  }),
}));
vi.mock('@/lib/homeOverview', () => ({ loadHomeData: vi.fn() }));
const data = (name: string): HomeData => ({
  courses: [{ id: name, name, role: 'member', unreadCount: 0 }],
  tasks: [],
  unreadCount: 0,
});
beforeEach(() => {
  vi.clearAllMocks();
  state.uid = 'alice';
});
it('clears visible account data and ignores an old response after account switching', async () => {
  let finishAlice!: (value: HomeData) => void;
  let finishBob!: (value: HomeData) => void;
  vi.mocked(loadHomeData).mockImplementation(
    (uid) =>
      new Promise((resolve) => {
        if (uid === 'alice') finishAlice = resolve;
        else finishBob = resolve;
      }),
  );
  const view = render(<HomePage />);
  await waitFor(() => expect(loadHomeData).toHaveBeenCalledWith('alice'));
  state.uid = 'bob';
  view.rerender(<HomePage />);
  await waitFor(() => expect(loadHomeData).toHaveBeenCalledWith('bob'));
  await act(async () => finishAlice(data('Alice private course')));
  expect(screen.queryByText('Alice private course')).toBeNull();
  await act(async () => finishBob(data('Bob course')));
  expect(screen.getByText('Bob course')).toBeTruthy();
  state.uid = null;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Bob course')).toBeNull();
  expect(screen.getByRole('link', { name: /登入帳號/ })).toBeTruthy();
});
it('does not report an empty course list as success after a failed load', async () => {
  vi.mocked(loadHomeData).mockRejectedValue(new Error('permission-denied'));
  render(<HomePage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('目前沒有待繳作業。')).toBeNull();
});
