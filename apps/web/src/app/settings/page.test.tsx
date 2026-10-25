import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettingsPage from './page';
import {
  AGENT_DELETE_MODEL_ACTION,
  AGENT_MODEL_DELETED_TEXT,
  agentConsentStorageKey,
  parseAgentConsent,
  serializeAgentConsent,
} from '@campus/shared/src/todaySenseAgent';
const agentRuntime = vi.hoisted(() => ({
  deleteTodaySenseModelCache: vi.fn(async () => ({
    released: true,
    message: '模型已刪除，已改回規則版。',
  })),
}));
vi.mock('@/lib/todaySenseAgentRuntime', () => agentRuntime);
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
  browserRequest: vi.fn(async (path: string) => {
    if (path === 'memberships') return { memberships: [] };
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    throw new Error(path);
  }),
}));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => ({ google: true, studentId: false, loading: false, retry: vi.fn() }),
  STUDENT_ID_PREPARING_COPY: '學號登入還在準備，目前請用 Google 帳號登入',
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.user, loading: false, signOutUser: state.signOut }),
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
  window.history.replaceState({}, '', '/settings');
  localStorage.clear();
  agentRuntime.deleteTodaySenseModelCache.mockResolvedValue({
    released: true,
    message: '模型已刪除，已改回規則版。',
  });
  state.user = { uid: 'a', displayName: 'Account A', email: 'a@example.test' };
  state.nuni.session = null;
  state.nuni.loading = false;
  state.nuni.pendingLogout = false;
  state.nuni.error = '';
  state.nuni.logout.mockResolvedValue(undefined);
  state.signOut.mockResolvedValue(undefined);
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
it('opens an addressable settings section and preserves its campus and hash while switching', async () => {
  window.history.replaceState(
    {},
    '',
    '/settings?schoolId=nthu&campus=nthu&section=appearance#reading',
  );
  render(<SettingsPage />);
  expect(screen.getByRole('heading', { name: '外觀設定' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '外觀' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: '通知' }));
  const location = new URL(window.location.href);
  expect(location.searchParams.get('section')).toBe('notifications');
  expect(location.searchParams.get('schoolId')).toBe('nthu');
  expect(location.searchParams.get('campus')).toBe('nthu');
  expect(location.hash).toBe('#reading');
  const entries = window.history.length;
  fireEvent.click(screen.getByRole('button', { name: '通知' }));
  expect(window.history.length).toBe(entries);
  await waitFor(() => expect(state.read).toHaveBeenCalled());
});

it('restores the previous category on browser history without losing an unsaved profile draft', async () => {
  render(<SettingsPage />);
  await openProfile();
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '還在編輯的姓名' } });
  fireEvent.click(screen.getByRole('button', { name: '外觀' }));
  expect(screen.queryByLabelText('姓名')).toBeNull();
  act(() => window.history.back());
  await waitFor(() => expect(screen.getByLabelText('姓名')).toBeTruthy());
  expect((screen.getByLabelText('姓名') as HTMLInputElement).value).toBe('還在編輯的姓名');
  act(() => window.history.forward());
  await waitFor(() => expect(screen.getByRole('heading', { name: '外觀設定' })).toBeTruthy());
  expect(state.saveProfile).not.toHaveBeenCalled();
});

it('moves through settings categories by keyboard and focuses content reached from an inline action', async () => {
  render(<SettingsPage />);
  const general = screen.getByRole('button', { name: '一般' });
  general.focus();
  fireEvent.keyDown(general, { key: 'ArrowRight' });
  const account = screen.getByRole('button', { name: '帳號' });
  expect(document.activeElement).toBe(account);
  expect(account.getAttribute('aria-current')).toBe('page');
  fireEvent.keyDown(account, { key: 'Home' });
  expect(document.activeElement).toBe(general);
  fireEvent.click(screen.getByRole('button', { name: '調整外觀' }));
  expect(document.activeElement).toBe(screen.getByRole('region', { name: '外觀' }));
  expect(new URLSearchParams(window.location.search).get('section')).toBe('appearance');
  await waitFor(() => expect(state.read).toHaveBeenCalled());
});

it('uses the general category for an unknown section without interpreting arbitrary identifiers', async () => {
  window.history.replaceState({}, '', '/settings?section=__proto__&schoolId=nthu');
  render(<SettingsPage />);
  expect(screen.getByRole('heading', { name: '一般設定' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '一般' }));
  expect(window.location.search).toBe('?schoolId=nthu');
  await waitFor(() => expect(state.read).toHaveBeenCalled());
});

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
  expect(screen.queryByRole('button', { name: AGENT_DELETE_MODEL_ACTION })).toBeNull();
  expect(screen.getByRole('link', { name: '查看隱私政策' })).toBeTruthy();
});
it('shows delete-model in privacy after download and returns to the rule list', async () => {
  localStorage.setItem(agentConsentStorageKey('school:a'), serializeAgentConsent('accepted'));
  render(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '隱私' }));
  expect(await screen.findByRole('button', { name: AGENT_DELETE_MODEL_ACTION })).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: AGENT_DELETE_MODEL_ACTION }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: AGENT_DELETE_MODEL_ACTION })).toBeNull(),
  );
  expect(agentRuntime.deleteTodaySenseModelCache).toHaveBeenCalled();
  expect(parseAgentConsent(localStorage.getItem(agentConsentStorageKey('school:a')))).toBe('unset');
  expect(screen.getByText(AGENT_MODEL_DELETED_TEXT)).toBeTruthy();
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
  expect(screen.getByRole('status').textContent).toContain('正在登出帳號');
  expect(screen.queryByRole('button', { name: '儲存資料' })).toBeNull();
  expect(screen.queryByDisplayValue('A private name')).toBeNull();
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
  expect(screen.queryByRole('button', { name: '儲存資料' })).toBeNull();
  expect(screen.queryByRole('button', { name: '登出帳號' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '通知' }));
  expect(screen.queryByRole('switch', { name: '推播通知' })).toBeNull();
  expect(screen.queryByRole('button', { name: '儲存通知設定' })).toBeNull();
  expect(state.saveProfile).not.toHaveBeenCalled();
  expect(state.saveNotifications).not.toHaveBeenCalled();
});

it('offers useful account and notification next steps for a course-only account', () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
  render(<SettingsPage />);
  expect(screen.getByRole('heading', { name: '校園服務資料來源' })).toBeTruthy();
  expect(screen.getByText(/目前提供的是校園服務資料，不代表你的帳號學籍或所屬學校/)).toBeTruthy();
  expect(screen.queryByText(/靜宜/)).toBeNull();
  expect(screen.queryByText('目前校園')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '帳號' }));
  expect(screen.getByText('Google 帳號已登入')).toBeTruthy();
  expect(screen.getByRole('link', { name: '學校資格' }).getAttribute('href')).toBe(
    '/classroom/account',
  );
  expect(screen.queryByRole('link', { name: '連線學校帳號' })).toBeNull();
  expect(screen.queryByText('訪客')).toBeNull();
  expect(screen.queryByLabelText('姓名')).toBeNull();
  expect(screen.queryByRole('button', { name: '儲存資料' })).toBeNull();
  expect(screen.getByRole('button', { name: '登出帳號' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '通知' }));
  expect(screen.getByText('課程通知尚未提供偏好設定')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往課程查看更新' }).getAttribute('href')).toBe(
    '/classroom',
  );
  expect(screen.queryByRole('switch', { name: '推播通知' })).toBeNull();
  expect(screen.queryByText('登入後查看通知')).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
});

it('preserves browser appearance controls for guests and course-only accounts', () => {
  state.user = null;
  const { rerender } = render(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '外觀' }));
  const picker = screen.getByLabelText('自訂色彩');
  fireEvent.change(picker, { target: { value: '#41646a' } });
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
  rerender(<SettingsPage />);
  expect((screen.getByLabelText('自訂色彩') as HTMLInputElement).value).toBe('#41646a');
  expect(state.saveProfile).not.toHaveBeenCalled();
});

it('ends both mixed-account sessions and hides data before either logout finishes', async () => {
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: true };
  let finishSchool!: () => void;
  let finishCourse!: () => void;
  state.signOut.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishSchool = resolve;
      }),
  );
  state.nuni.logout.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishCourse = resolve;
      }),
  );
  const { rerender } = render(<SettingsPage />);
  await openProfile();
  expect(screen.getByRole('link', { name: /平台管理/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '登出帳號' }));
  expect(state.signOut).toHaveBeenCalledTimes(1);
  expect(state.nuni.logout).toHaveBeenCalledTimes(1);
  expect(screen.queryByDisplayValue('A private name')).toBeNull();
  expect(screen.queryByRole('link', { name: /平台管理/ })).toBeNull();
  await act(async () => finishSchool());
  expect(screen.getByRole('status').textContent).toContain('正在登出帳號');
  await act(async () => {
    state.user = null;
    state.nuni.session = null;
    finishCourse();
  });
  rerender(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '帳號' }));
  expect(screen.queryByText('Google 帳號已登入')).toBeNull();
  expect(screen.queryByDisplayValue('A private name')).toBeNull();
  expect(state.success).not.toHaveBeenCalled();
});

it('does not claim course logout succeeded when the session reports an unconfirmed result', async () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: true };
  state.nuni.logout.mockImplementation(async () => {
    state.nuni.session = null;
    state.nuni.pendingLogout = true;
    state.nuni.error = '登出尚未完成，請重試以結束這次登入。';
  });
  render(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '帳號' }));
  fireEvent.click(screen.getByRole('button', { name: '登出帳號' }));
  await screen.findByText('Google 帳號正在登出');
  expect(screen.queryByRole('link', { name: /平台管理/ })).toBeNull();
  expect(screen.queryByText('Google 帳號已登入')).toBeNull();
  expect(state.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重試登出 Google 帳號' }));
  expect(state.nuni.logout).toHaveBeenCalledTimes(2);
  expect(state.signOut).not.toHaveBeenCalled();
});

it('hides course permissions on refresh and supplies recovery without account-edit placeholders', () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: true };
  const { rerender } = render(<SettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: '帳號' }));
  expect(screen.getByRole('link', { name: /平台管理/ })).toBeTruthy();
  state.nuni.loading = true;
  rerender(<SettingsPage />);
  expect(screen.queryByRole('link', { name: /平台管理/ })).toBeNull();
  expect(screen.queryByText('Google 帳號已登入')).toBeNull();
  state.nuni.loading = false;
  state.nuni.session = null;
  state.nuni.error = '無法確認登入狀態';
  rerender(<SettingsPage />);
  expect(screen.queryByLabelText('姓名')).toBeNull();
  expect(screen.queryByRole('link', { name: '登入課程空間' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認 Google 帳號' }));
  expect(state.nuni.refresh).toHaveBeenCalledTimes(1);
});
