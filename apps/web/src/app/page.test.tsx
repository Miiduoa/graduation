import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HomePage from './page';
import { loadHomeData, type HomeData } from '@/lib/homeOverview';
import { loadNuniHomeData } from '@/lib/nuniHomeOverview';
import { NuniError } from '@campus/shared/src/nuni';
const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  session: null as null | { context: string; platformAccountId: string },
  sessionLoading: false,
  sessionError: '',
  pendingLogout: false,
  refresh: vi.fn(),
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: state.session,
    loading: state.sessionLoading,
    error: state.sessionError,
    pendingLogout: state.pendingLogout,
    logout: vi.fn(),
    refresh: state.refresh,
  }),
  browserRequest: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({
    user: state.uid ? { uid: state.uid } : null,
    loading: false,
    signOutUser: vi.fn(),
  }),
}));
vi.mock('@/lib/homeOverview', () => ({ loadHomeData: vi.fn() }));
vi.mock('@/lib/nuniHomeOverview', () => ({ loadNuniHomeData: vi.fn() }));
const data = (name: string): HomeData => ({
  courses: [{ id: name, name, role: 'member', unreadCount: 0 }],
  tasks: [],
  unreadCount: 0,
});
beforeEach(() => {
  vi.clearAllMocks();
  state.uid = 'alice';
  state.session = null;
  state.sessionLoading = false;
  state.sessionError = '';
  state.pendingLogout = false;
});
it('clears visible school account data and ignores an old response after account switching', async () => {
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
  expect(screen.getByRole('link', { name: /登入課程帳號/ })).toBeTruthy();
});
it('does not report an empty course list as success after a failed load', async () => {
  vi.mocked(loadHomeData).mockRejectedValue(new Error('permission-denied'));
  render(<HomePage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('目前沒有待繳作業。')).toBeNull();
});
it('uses the Nuni account for home and links directly to pending work with its actual deadline and submission state', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    ...data('視覺設計'),
    tasks: [
      {
        id: 'draft',
        courseId: 'design',
        courseName: '視覺設計',
        title: '週五提案',
        dueAt: '2020-01-02T12:30:00Z',
        acceptsLate: true,
        href: '/classroom/course/design#assignment-draft',
      },
    ],
  });
  render(<HomePage />);
  const taskLink = await screen.findByRole('link', { name: /查看並繳交作業/ });
  expect(taskLink.getAttribute('href')).toBe('/classroom/course/design#assignment-draft');
  expect(loadHomeData).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: /登入課程帳號/ })).toBeNull();
  expect(screen.getAllByText('已過參考期限・仍可繳交')).toHaveLength(2);
  expect(screen.getAllByText(/1\/2 20:30/)).toHaveLength(2);
});
it('keeps teaching and studying roles separate for the same account', async () => {
  state.session = { context: 'session-a', platformAccountId: 'teacher-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    courses: [
      { id: 'teach', name: '教學實習', role: 'co-teacher', unreadCount: 0 },
      { id: 'learn', name: '教育心理學', role: 'student', unreadCount: 0 },
    ],
    tasks: [],
    unreadCount: 0,
  });
  render(<HomePage />);
  expect(await screen.findByRole('heading', { name: /授課與協作/ })).toBeTruthy();
  expect(screen.getByRole('heading', { name: /修習課程/ })).toBeTruthy();
  expect(screen.getByText('協同教師')).toBeTruthy();
});
it('does not tell a teacher they have no homework and opens the teaching course list', async () => {
  state.session = { context: 'session-a', platformAccountId: 'teacher-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    courses: [{ id: 'teach', name: '教學實習', role: 'owner-teacher', unreadCount: 0 }],
    tasks: [],
    unreadCount: 0,
  });
  render(<HomePage />);
  expect(await screen.findByRole('heading', { name: '今天的教學' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /查看授課課程/ }).getAttribute('href')).toBe(
    '#teaching-courses',
  );
  expect(screen.queryByRole('heading', { name: /待繳作業/ })).toBeNull();
});
it('hides all previous Nuni data immediately during session revalidation and ignores a previous context response', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  let finishOld!: (value: HomeData) => void;
  let finishNew!: (value: HomeData) => void;
  vi.mocked(loadNuniHomeData)
    .mockResolvedValueOnce(data('Alice private course'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
  const view = render(<HomePage />);
  expect(await screen.findByText('Alice private course')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更新課程' }));
  state.sessionLoading = true;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Alice private course')).toBeNull();
  state.session = { context: 'session-b', platformAccountId: 'student-b' };
  state.sessionLoading = false;
  view.rerender(<HomePage />);
  await waitFor(() => expect(loadNuniHomeData).toHaveBeenCalledTimes(3));
  await act(async () => finishOld(data('Old response')));
  expect(screen.queryByText('Old response')).toBeNull();
  await act(async () => finishNew(data('Bob course')));
  expect(screen.getByText('Bob course')).toBeTruthy();
  state.pendingLogout = true;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Bob course')).toBeNull();
});
it('removes a loaded overview when refreshing discovers revoked access', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData)
    .mockResolvedValueOnce(data('Private course'))
    .mockRejectedValueOnce(new NuniError(403, 'ACCESS_DENIED'));
  render(<HomePage />);
  expect(await screen.findByText('Private course')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更新課程' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Private course')).toBeNull();
  expect(screen.queryByText('目前沒有待繳作業。')).toBeNull();
});
it('keeps public campus entries usable when the course session is unavailable', () => {
  state.uid = null;
  state.sessionError = '無法確認登入狀態';
  render(<HomePage />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('link', { name: /校園地圖/ }).getAttribute('href')).toBe('/map');
  expect(screen.queryByRole('link', { name: /登入課程帳號/ })).toBeNull();
});

it('revalidates an expired course session before retrying with the new account context', async () => {
  state.uid = null;
  state.session = { context: 'expired', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData).mockRejectedValueOnce(new NuniError(409, 'SESSION_CHANGED'));
  const view = render(<HomePage />);
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  vi.mocked(loadNuniHomeData).mockResolvedValueOnce(data('New account course'));
  state.session = { context: 'renewed', platformAccountId: 'student-b' };
  view.rerender(<HomePage />);
  await screen.findByText('New account course');
  expect(loadNuniHomeData).toHaveBeenLastCalledWith(expect.any(Function), 'student-b');
  expect(screen.queryByRole('alert')).toBeNull();
});
