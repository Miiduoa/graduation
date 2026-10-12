import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ProfilePage from './page';

const state = vi.hoisted(() => ({
  user: { uid: 'a', displayName: 'Account A', email: 'a@example.test' } as {
    uid: string;
    displayName: string;
    email: string;
  } | null,
  loading: false,
  read: vi.fn(),
  nuni: {
    session: null as {
      platformAccountId: string;
      context: string;
      isPlatformOperator: boolean;
    } | null,
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: vi.fn(),
    logout: vi.fn(),
  },
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => state.nuni,
  browserRequest: vi.fn(async () => ({ memberships: [] })),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.user, loading: state.loading, error: null }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => ({ currentUser: state.user }),
  getDb: () => ({}),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_: unknown, ...path: string[]) => path.join('/'),
  getDocFromServer: state.read,
}));
const snapshot = (displayName: string) => ({
  exists: () => true,
  data: () => ({ displayName, department: '資訊管理', grade: '四年級' }),
});
beforeEach(() => {
  vi.clearAllMocks();
  state.user = { uid: 'a', displayName: 'Account A', email: 'a@example.test' };
  state.loading = false;
  state.nuni.session = null;
  state.nuni.loading = false;
  state.nuni.pendingLogout = false;
  state.nuni.error = '';
  state.read.mockResolvedValue(snapshot('私人資料 A'));
});
it('reads only the current profile from the server and links to authoritative records', async () => {
  render(<ProfilePage />);
  await screen.findByText('私人資料 A');
  expect(state.read).toHaveBeenCalledWith('users/a');
  expect(screen.getByRole('link', { name: /成績紀錄/ }).getAttribute('href')).toBe('/grades');
  expect(screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')).toBe('/library');
  expect(screen.queryByText(/GPA|已同步課程|借閱中/)).toBeNull();
});
it('shows a retryable failure without presenting empty records as success', async () => {
  state.read.mockRejectedValueOnce(new Error('offline'));
  render(<ProfilePage />);
  await screen.findByRole('alert');
  expect(screen.queryByText('尚未填寫個人資料，可以到帳號設定補上。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('私人資料 A');
});
it('distinguishes a missing profile from a failed read', async () => {
  state.read.mockResolvedValue({ exists: () => false });
  render(<ProfilePage />);
  await screen.findByText('尚未填寫個人資料，可以到帳號設定補上。');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('clears the prior account immediately and ignores a response after logout', async () => {
  const { rerender } = render(<ProfilePage />);
  await screen.findByText('私人資料 A');
  let finish!: (value: unknown) => void;
  state.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  state.user = { uid: 'b', displayName: 'Account B', email: 'b@example.test' };
  rerender(<ProfilePage />);
  expect(screen.queryByText('私人資料 A')).toBeNull();
  await waitFor(() => expect(state.read).toHaveBeenCalledWith('users/b'));
  state.user = null;
  rerender(<ProfilePage />);
  await act(async () => finish(snapshot('私人資料 B')));
  expect(screen.queryByText('私人資料 B')).toBeNull();
  expect(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')).toContain(
    'returnUrl=%2Fprofile',
  );
});
it('does not read personal data before authentication resolves', () => {
  state.loading = true;
  render(<ProfilePage />);
  expect(state.read).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toBe('正在確認帳號…');
});

it('recognizes a course-only account without inventing school records or a global teaching role', () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
  render(<ProfilePage />);
  expect(screen.getByText('Campus One 帳號已登入')).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看我的課程' }).getAttribute('href')).toBe(
    '/classroom',
  );
  expect(screen.getByRole('link', { name: 'Campus One 帳號' }).getAttribute('href')).toBe(
    '/classroom/account',
  );
  expect(screen.getByRole('link', { name: '連線校園帳號' }).getAttribute('href')).toContain(
    'reconnect=school',
  );
  expect(screen.queryByText('登入後，查看你的資料')).toBeNull();
  expect(screen.queryByRole('link', { name: /平台管理/ })).toBeNull();
  expect(screen.queryByText('學號')).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
});

it('keeps mixed account records separate from course membership', async () => {
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
  render(<ProfilePage />);
  await screen.findByText('私人資料 A');
  expect(screen.getByText('Campus One 帳號已登入')).toBeTruthy();
  expect(screen.getByText('校園帳號個人資料')).toBeTruthy();
  expect(screen.getByText(/老師、協同教師或學生身分依各課程的成員資格決定/)).toBeTruthy();
  expect(state.read).toHaveBeenCalledWith('users/a');
});

it('hides course permissions synchronously during refresh, logout, and account switching', () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: true };
  const { rerender } = render(<ProfilePage />);
  expect(screen.getByRole('link', { name: /前往平台管理/ })).toBeTruthy();
  state.nuni.loading = true;
  rerender(<ProfilePage />);
  expect(screen.queryByRole('link', { name: /前往平台管理/ })).toBeNull();
  expect(screen.queryByText('Campus One 帳號已登入')).toBeNull();
  state.nuni.loading = false;
  state.nuni.session = { platformAccountId: 'pa_b', context: 'b', isPlatformOperator: false };
  rerender(<ProfilePage />);
  expect(screen.queryByRole('link', { name: /前往平台管理/ })).toBeNull();
  state.nuni.pendingLogout = true;
  state.nuni.error = '登出尚未完成';
  rerender(<ProfilePage />);
  expect(screen.queryByText('Campus One 帳號已登入')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重試登出 Campus One 帳號' }));
  expect(state.nuni.logout).toHaveBeenCalledTimes(1);
});

it('offers recovery when course authentication cannot be confirmed', () => {
  state.user = null;
  state.nuni.error = '無法確認登入狀態';
  render(<ProfilePage />);
  expect(screen.getByRole('alert').textContent).toContain('無法確認登入狀態');
  expect(screen.queryByText('Campus One 帳號已登入')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認 Campus One 帳號' }));
  expect(state.nuni.refresh).toHaveBeenCalledTimes(1);
});
