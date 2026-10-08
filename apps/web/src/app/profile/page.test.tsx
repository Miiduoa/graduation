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
