import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettingsPage from './page';
const state = vi.hoisted(() => ({
  user: { uid: 'a', displayName: 'Account A', email: 'a@example.test' } as {
    uid: string;
    displayName: string;
    email: string;
    providerData?: { providerId: string }[];
  } | null,
  profiles: {} as Record<string, Record<string, string>>,
  read: vi.fn(),
  saveProfile: vi.fn(),
  saveNotifications: vi.fn(),
  signOut: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.user, loading: false }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/ui', () => ({
  useToast: () => ({ success: state.success, error: state.error, info: state.info }),
}));
vi.mock('@/lib/pageContext', () => ({
  resolveSchoolPageContext: () => ({ schoolName: '靜宜大學', schoolSearch: '' }),
}));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => ({ currentUser: state.user }),
  getDb: () => ({}),
  isFirebaseConfigured: () => true,
  saveNotificationPreferences: state.saveNotifications,
  updateUserProfile: state.saveProfile,
  signOut: state.signOut,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_: unknown, ...path: string[]) => path.join('/'),
  getDocFromServer: state.read,
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.user = { uid: 'a', displayName: 'Account A', email: 'a@example.test' };
  state.profiles = {
    a: {
      displayName: 'A private name',
      studentId: 'A001',
      department: 'Dept A',
      grade: '3',
      phone: '111',
      bio: 'A private bio',
    },
    b: {
      displayName: 'B private name',
      studentId: 'B001',
      department: 'Dept B',
      grade: '2',
      phone: '222',
      bio: 'B private bio',
    },
  };
  state.read.mockImplementation(async (path: string) => ({
    exists: () => !path.endsWith('/notifications'),
    data: () => state.profiles[path.split('/')[1]],
  }));
  state.saveProfile.mockResolvedValue({ success: true });
});
afterEach(cleanup);
async function openProfile() {
  fireEvent.click(screen.getByRole('button', { name: '帳號' }));
  await waitFor(() =>
    expect((screen.getByLabelText('姓名') as HTMLInputElement).disabled).toBe(false),
  );
}
it('removes demo seeding and broad storage deletion from the user settings', async () => {
  render(<SettingsPage />);
  await waitFor(() => expect(state.read).toHaveBeenCalled());
  expect(screen.queryByText('示範工具')).toBeNull();
  expect(screen.queryByText(/一鍵 seed|重置 demo|清空全部本機資料/)).toBeNull();
});
it('clears old profile fields immediately on account switch and waits for the new read', async () => {
  const { rerender } = render(<SettingsPage />);
  await openProfile();
  expect((screen.getByLabelText('姓名') as HTMLInputElement).value).toBe('A private name');
  let finish!: (value: unknown) => void;
  state.read.mockImplementation((path: string) =>
    path.endsWith('/notifications')
      ? Promise.resolve({ exists: () => false })
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  state.user = { uid: 'b', displayName: 'Account B', email: 'b@example.test' };
  rerender(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '帳號' }));
  expect(screen.queryByDisplayValue('A private name')).toBeNull();
  expect((screen.getByLabelText('姓名') as HTMLInputElement).disabled).toBe(true);
  await act(async () => finish({ exists: () => true, data: () => state.profiles.b }));
  expect((screen.getByLabelText('姓名') as HTMLInputElement).value).toBe('B private name');
});
it('does not report saved when the server readback differs from the draft', async () => {
  render(<SettingsPage />);
  await openProfile();
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'Changed name' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存資料' }));
  await waitFor(() =>
    expect(state.error).toHaveBeenCalledWith('個人資料尚未確認', expect.any(String)),
  );
  expect(state.success).not.toHaveBeenCalled();
});
it('reports a profile update only after matching server readback', async () => {
  state.saveProfile.mockImplementation(async (uid: string, values: Record<string, string>) => {
    state.profiles[uid] = values;
    return { success: true };
  });
  render(<SettingsPage />);
  await openProfile();
  fireEvent.change(screen.getByLabelText('自我介紹'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存資料' }));
  await waitFor(() => expect(state.success).toHaveBeenCalledWith('個人資料已更新'));
  expect(state.profiles.a.bio).toBe('');
});
it('disables account writes when the initial server read fails', async () => {
  state.read.mockRejectedValue(new Error('offline'));
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '帳號' }));
  expect((screen.getByRole('button', { name: '儲存資料' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(state.saveProfile).not.toHaveBeenCalled();
});
it('does not show an old save result after switching accounts', async () => {
  let finish!: (value: unknown) => void;
  state.saveProfile.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(<SettingsPage />);
  await openProfile();
  fireEvent.click(screen.getByRole('button', { name: '儲存資料' }));
  state.user = { uid: 'b', displayName: 'Account B', email: 'b@example.test' };
  rerender(<SettingsPage />);
  await act(async () => finish({ success: true }));
  expect(state.success).not.toHaveBeenCalled();
  expect(state.error).not.toHaveBeenCalled();
});
it('requires reloading after an unconfirmed notification save and then verifies the saved values', async () => {
  render(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '通知' }));
  const save = screen.getByRole('button', { name: '儲存通知設定' }) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  fireEvent.click(save);
  await waitFor(() =>
    expect(state.error).toHaveBeenCalledWith('通知設定尚未確認', expect.any(String)),
  );
  expect(save.disabled).toBe(true);
  expect(state.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取帳號設定' }));
  await waitFor(() => expect(save.disabled).toBe(false));
  let preferences: unknown;
  state.saveNotifications.mockImplementation(async (_uid: string, value: unknown) => {
    preferences = value;
  });
  state.read.mockImplementation(async (path: string) => ({
    exists: () => true,
    data: () => (path.endsWith('/notifications') ? preferences : state.profiles.a),
  }));
  fireEvent.click(save);
  await waitFor(() => expect(state.success).toHaveBeenCalledWith('通知設定已同步'));
});
it('does not offer ineffective privacy or background-sync switches', async () => {
  render(<SettingsPage />);
  expect(screen.queryByText('自動同步')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '隱私' }));
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.getByRole('link', { name: '查看隱私政策' })).toBeTruthy();
});
it('locks profile fields while a save is pending so readback cannot erase a newer draft', async () => {
  state.saveProfile.mockImplementation(() => new Promise(() => {}));
  render(<SettingsPage />);
  await openProfile();
  fireEvent.click(screen.getByRole('button', { name: '儲存資料' }));
  for (const label of ['姓名', '學號', '系所', '年級', '電話', '自我介紹']) {
    expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
  }
});

it('uses a complete native color value and does not echo a synchronized selection', async () => {
  render(<SettingsPage />);
  await waitFor(() => expect(state.read).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '外觀' }));
  const picker = screen.getByLabelText('自訂色彩') as HTMLInputElement;
  expect(picker.type).toBe('color');
  fireEvent.change(picker, { target: { value: '#ff6b35' } });
  const raw = localStorage.getItem('campus-web-preferences')!;
  expect(JSON.parse(raw).appearance.themeColor).toBe('#FF6B35');
  await act(async () =>
    window.dispatchEvent(new StorageEvent('storage', { key: 'campus-web-preferences' })),
  );
  expect(picker.value).toBe('#ff6b35');
  expect(localStorage.getItem('campus-web-preferences')).toBe(raw);
});

it('shows the authenticated provider instead of implying a school login is connected', async () => {
  state.user = { ...state.user!, providerData: [{ providerId: 'google.com' }] };
  render(<SettingsPage />);
  await openProfile();
  expect(screen.getByText('Google 帳號')).toBeTruthy();
  expect(screen.queryByText('PU 學號登入')).toBeNull();
  expect(screen.queryByText('學校登入')).toBeNull();
});

it('provides an accessible sign-out button and prevents duplicate requests while pending', async () => {
  let finish!: () => void;
  state.signOut.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<SettingsPage />);
  await openProfile();
  const signOut = screen.getByRole('button', { name: '登出帳號' }) as HTMLButtonElement;
  expect(signOut.type).toBe('button');
  fireEvent.click(signOut);
  expect(signOut.disabled).toBe(true);
  expect((screen.getByRole('button', { name: '儲存資料' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(signOut);
  expect(state.signOut).toHaveBeenCalledTimes(1);
  await act(async () => {
    state.user = null;
    finish();
  });
  expect(state.success).toHaveBeenCalledWith('已登出帳號');
});

it('keeps the account available after a failed sign-out and allows retry', async () => {
  state.signOut.mockRejectedValue(new Error('offline'));
  render(<SettingsPage />);
  await openProfile();
  fireEvent.click(screen.getByRole('button', { name: '登出帳號' }));
  await waitFor(() => expect(state.error).toHaveBeenCalledWith('登出失敗', '請稍後再試一次'));
  expect((screen.getByRole('button', { name: '登出帳號' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  expect(state.success).not.toHaveBeenCalled();
});

it('keeps account writes and sign-out unavailable to guests', async () => {
  state.user = null;
  render(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '帳號' }));
  expect((screen.getByRole('button', { name: '儲存資料' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.queryByRole('button', { name: '登出帳號' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '通知' }));
  expect((screen.getByRole('switch', { name: '推播通知' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByRole('button', { name: '儲存通知設定' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(state.saveProfile).not.toHaveBeenCalled();
  expect(state.saveNotifications).not.toHaveBeenCalled();
});
