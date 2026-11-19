import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { browserRequest } from '@/features/nuni/Session';
import { SelectedSchoolProvider, schoolPreferenceKey } from '@/components/SelectedSchoolProvider';
import ProfilePage from './page';

const state = vi.hoisted(() => ({
  user: { uid: 'a', displayName: 'Account A', email: 'a@example.test' } as {
    uid: string;
    displayName: string;
    email: string;
  } | null,
  loading: false,
  read: vi.fn(),
  params: new URLSearchParams(),
  replace: vi.fn(),
  studentId: false,
  signInOptions: vi.fn(),
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
vi.mock('next/navigation', () => ({
  usePathname: () => '/profile',
  useSearchParams: () => state.params,
  useRouter: () => ({ replace: state.replace }),
}));
// The account screen owns auth/state; the social timeline has independent Firebase tests.
vi.mock('./MySocialProfile', () => ({
  MySocialProfile: ({ name }: { name: string }) => <section data-testid="my-social-profile">{name}</section>,
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
  useSignInOptions: (schoolId?: string | null, ready = true) => {
    state.signInOptions(schoolId, ready);
    return { google: true, studentId: ready && state.studentId && schoolId === 'pu', loading: !ready, retry: vi.fn() };
  },
  STUDENT_ID_PREPARING_COPY: '學號登入還在準備，目前請用 Google 帳號登入',
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
  state.params = new URLSearchParams();
  state.studentId = false;
  localStorage.clear();
  state.nuni.session = null;
  state.nuni.loading = false;
  state.nuni.pendingLogout = false;
  state.nuni.error = '';
  state.read.mockResolvedValue(snapshot('私人資料 A'));
});

function renderScopedProfile() {
  return render(
    <SelectedSchoolProvider
      ownerKey={null}
      loading={false}
      schools={[
        { id: 'pu', name: '靜宜大學', code: 'PU' },
        { id: 'ntu', name: '國立臺灣大學', code: 'NTU' },
      ]}
      catalogStatus="ready"
    >
      <ProfilePage />
    </SelectedSchoolProvider>,
  );
}

function linkUrl(name: string | RegExp) {
  return new URL(screen.getByRole('link', { name }).getAttribute('href')!, 'https://campus.local');
}

it('keeps the explicit URL school in school sign-in, Google sign-in, and the profile return instead of the saved campus', async () => {
  state.user = null;
  state.studentId = true;
  state.params = new URLSearchParams('schoolId=pu&campus=pu&school=STALE&token=secret&q=private');
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'ntu' }));
  renderScopedProfile();
  await screen.findByRole('link', { name: '連線學校帳號' });
  expect(state.signInOptions).toHaveBeenLastCalledWith('pu', true);
  const schoolLogin = linkUrl('連線學校帳號');
  const profileReturn = '/profile?schoolId=pu&campus=pu&school=PU';
  expect(schoolLogin.pathname).toBe('/login');
  expect(Object.fromEntries(schoolLogin.searchParams)).toEqual({
    reconnect: 'school',
    returnUrl: profileReturn,
    schoolId: 'pu',
    campus: 'pu',
    school: 'PU',
  });
  expect(Object.fromEntries(linkUrl('登入帳號').searchParams)).toEqual({
    returnUrl: profileReturn,
    schoolId: 'pu',
    campus: 'pu',
    school: 'PU',
  });
  expect(JSON.parse(localStorage.getItem(schoolPreferenceKey(null))!)).toEqual({ schoolId: 'ntu' });
});

it('preserves the browsing campus on school records, student card, library and settings without copying unrelated parameters', async () => {
  state.params = new URLSearchParams('schoolId=pu&campus=pu&token=secret&group=people');
  renderScopedProfile();
  await screen.findByText('私人資料 A');
  await waitFor(() => expect(state.signInOptions).toHaveBeenLastCalledWith('pu', true));
  const destinations: Array<[string | RegExp, string, Record<string, string>]> = [
    [/數位學生證/, '/student-card', {}],
    [/我的課表/, '/timetable', {}],
    [/我的社群頁/, '/community/me', {}],
    [/成績紀錄/, '/grades', { tab: 'semester' }],
    [/學分規劃/, '/credit-planner', {}],
    [/圖書館/, '/library', {}],
    ['編輯個人資料', '/settings', { section: 'account' }],
    ['管理學校帳號', '/settings', { section: 'account' }],
    [/通知偏好/, '/settings', { section: 'notifications' }],
    [/外觀與閱讀/, '/settings', { section: 'appearance' }],
    [/隱私與資料/, '/settings', { section: 'privacy' }],
    [/所有設定/, '/settings', {}],
  ];
  for (const [name, pathname, extra] of destinations) {
    const target = linkUrl(name);
    expect(target.pathname).toBe(pathname);
    expect(Object.fromEntries(target.searchParams)).toEqual({ ...extra, schoolId: 'pu', campus: 'pu', school: 'PU' });
  }
  const googleLogin = linkUrl('連線 Google 帳號');
  expect(googleLogin.searchParams.get('schoolId')).toBe('pu');
  expect(googleLogin.searchParams.get('returnUrl')).toBe('/profile?schoolId=pu&campus=pu&school=PU');
});

it('preserves the selected campus for Google-only feedback, imports and public conversation', async () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
  state.params = new URLSearchParams('schoolId=pu&campus=pu&token=secret');
  renderScopedProfile();
  await waitFor(() => expect(state.signInOptions).toHaveBeenLastCalledWith('pu', true));
  for (const name of [/課堂成績與回饋/, /匯入成績/, '前往跨校交流', /平台服務權限/]) {
    const target = linkUrl(name);
    expect(target.searchParams.get('schoolId')).toBe('pu');
    expect(target.searchParams.get('campus')).toBe('pu');
    expect(target.searchParams.get('school')).toBe('PU');
    expect(target.searchParams.has('token')).toBe(false);
  }
  expect(linkUrl(/課堂成績與回饋/).searchParams.get('tab')).toBe('feedback');
  expect(linkUrl(/匯入成績/).searchParams.get('kind')).toBe('grades');
  await waitFor(() => expect(browserRequest).toHaveBeenCalledWith('memberships', 'a'));
});

it.each(['all', 'personal'])('cleans the %s campus scope before service navigation and sign-in returns', async (campus) => {
  state.user = null;
  state.studentId = true;
  state.params = new URLSearchParams(`campus=${campus}&schoolId=pu&school=PU&token=secret`);
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'ntu' }));
  renderScopedProfile();
  await waitFor(() => expect(state.signInOptions).toHaveBeenLastCalledWith(null, true));
  expect(screen.queryByRole('link', { name: '連線學校帳號' })).toBeNull();
  expect(Object.fromEntries(linkUrl('登入帳號').searchParams)).toEqual({
    returnUrl: '/profile?campus=all',
    campus: 'all',
  });
  for (const name of [/數位學生證/, /我的課表/, /圖書館/, /所有設定/]) {
    expect(Object.fromEntries(linkUrl(name).searchParams)).toEqual({ campus: 'all' });
  }
  expect(Object.fromEntries(linkUrl(/匯入成績/).searchParams)).toEqual({ kind: 'grades', campus: 'all' });
});
it('reads only the current profile from the server and links to authoritative records', async () => {
  render(<ProfilePage />);
  await screen.findByText('私人資料 A');
  expect(state.read).toHaveBeenCalledWith('users/a');
  expect(screen.getByRole('link', { name: /成績紀錄/ }).getAttribute('href')).toBe('/grades?tab=semester');
  expect(screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')).toBe('/library');
  expect(screen.queryByText(/GPA|已同步課程|借閱中/)).toBeNull();
});
it('shows a retryable failure without presenting empty records as success', async () => {
  state.read.mockRejectedValueOnce(new Error('offline'));
  render(<ProfilePage />);
  await screen.findByRole('alert');
  expect(screen.getByText(/暫時讀不到資料，請稍後再試/)).toBeTruthy();
  expect(screen.queryByText(/請確認網路後再試/)).toBeNull();
  expect(screen.queryByText('尚未填寫個人資料，可以到帳號設定補上。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('私人資料 A');
});

it('asks to check the network only when a profile read fails at the network layer', async () => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  state.read.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  render(<ProfilePage />);
  await screen.findByRole('alert');
  expect(screen.getByText(/請確認網路後再試/)).toBeTruthy();
  expect(screen.queryByText(/暫時讀不到資料，請稍後再試/)).toBeNull();
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
  expect(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fprofile',
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
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('region', { name: 'Google 帳號' })).toBeTruthy();
  expect(screen.getByText('Google 帳號已登入')).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看我的課程' }).getAttribute('href')).toBe(
    '/classroom',
  );
  expect(screen.getByRole('link', { name: '學校資格' }).getAttribute('href')).toBe(
    '/classroom/account',
  );
  expect(screen.queryByRole('link', { name: '連線學校帳號' })).toBeNull();
  expect(screen.queryByText('連線學校帳號，查看學校資料')).toBeNull();
  expect(screen.queryByText('登入後，查看你的資料')).toBeNull();
  expect(screen.queryByRole('link', { name: /平台管理/ })).toBeNull();
  expect(screen.queryByText('學號')).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
});

it('keeps mixed account records separate from course membership', async () => {
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
  render(<ProfilePage />);
  await screen.findByText('私人資料 A');
  expect(screen.getByText('Google 帳號已登入')).toBeTruthy();
  expect(screen.getByText('學校帳號個人資料')).toBeTruthy();
  expect(screen.getByText(/老師、協同教師或學生身分依各課程的成員資格決定/)).toBeTruthy();
  expect(state.read).toHaveBeenCalledWith('users/a');
});

it.each(['Google-only', 'Google+Firebase'])(
  'preserves the embedded qualification draft during same-scope refresh for %s',
  async (accountMode) => {
    if (accountMode === 'Google-only') state.user = null;
    state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
    const { rerender } = render(<ProfilePage />);
    const email = await screen.findByRole('textbox', { name: '學校配發的電子郵件' });
    fireEvent.change(email, { target: { value: 'draft-a@example.test' } });
    expect((email as HTMLInputElement).value).toBe('draft-a@example.test');

    state.nuni.loading = true;
    rerender(<ProfilePage />);
    expect(screen.queryByRole('form', { name: '申請學校資格' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '學校配發的電子郵件' })).toBeNull();
    expect(screen.queryByRole('button', { name: '送出資格申請' })).toBeNull();

    state.nuni.loading = false;
    rerender(<ProfilePage />);
    const restored = await screen.findByRole('textbox', { name: '學校配發的電子郵件' });
    expect((restored as HTMLInputElement).value).toBe('draft-a@example.test');
    expect((restored as HTMLInputElement).disabled).toBe(false);
    expect(vi.mocked(browserRequest).mock.calls.filter((call) => call[2] !== undefined)).toEqual(
      [],
    );
    if (accountMode === 'Google-only') expect(state.read).not.toHaveBeenCalled();
    else expect(state.read).toHaveBeenCalledWith('users/a');
  },
);

it('hides course permissions synchronously during refresh, logout, and account switching', () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: true };
  const { rerender } = render(<ProfilePage />);
  expect(screen.getByRole('link', { name: /前往平台管理/ })).toBeTruthy();
  state.nuni.loading = true;
  rerender(<ProfilePage />);
  expect(screen.queryByRole('link', { name: /前往平台管理/ })).toBeNull();
  expect(screen.queryByText('Google 帳號已登入')).toBeNull();
  state.nuni.loading = false;
  state.nuni.session = { platformAccountId: 'pa_b', context: 'b', isPlatformOperator: false };
  rerender(<ProfilePage />);
  expect(screen.queryByRole('link', { name: /前往平台管理/ })).toBeNull();
  state.nuni.pendingLogout = true;
  state.nuni.error = '登出尚未完成';
  rerender(<ProfilePage />);
  expect(screen.queryByText('Google 帳號已登入')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重試登出 Google 帳號' }));
  expect(state.nuni.logout).toHaveBeenCalledTimes(1);
});

it('offers recovery when course authentication cannot be confirmed', () => {
  state.user = null;
  state.nuni.error = '無法確認登入狀態';
  render(<ProfilePage />);
  expect(screen.getByRole('alert').textContent).toContain('無法確認登入狀態');
  expect(screen.queryByText('Google 帳號已登入')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認 Google 帳號' }));
  expect(state.nuni.refresh).toHaveBeenCalledTimes(1);
});

it('integrates the creator area only for a verified Firebase account', async () => {
  render(<ProfilePage />);
  expect(await screen.findByTestId('my-social-profile')).toBeTruthy();
  expect(screen.getByText('Account A')).toBeTruthy();
});

it('does not expose a Firebase creator timeline for a Google-only platform account', () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
  render(<ProfilePage />);
  expect(screen.queryByTestId('my-social-profile')).toBeNull();
  expect(screen.getByRole('link', { name: '前往跨校交流' }).getAttribute('href')).toBe('/social');
});

it('groups the personal center into reachable sections and keeps the student card easy to find', async () => {
  render(<ProfilePage />);
  await screen.findByText('私人資料 A');
  const navigation = screen.getByRole('navigation', { name: '個人中心分區' });
  const sectionLinks = within(navigation).getAllByRole('link');
  expect(sectionLinks.map((link) => link.textContent)).toEqual(['個人資料', '帳號與連線', '偏好與權限']);
  for (const link of sectionLinks) {
    const target = document.querySelector(link.getAttribute('href')!);
    expect(target?.getAttribute('aria-labelledby')).toBeTruthy();
  }
  const card = screen.getByRole('link', { name: /數位學生證/ });
  expect(card.getAttribute('href')).toBe('/student-card');
  expect(card.compareDocumentPosition(screen.getByRole('region', { name: '帳號與連線' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('offers Google users their actual services without sending them to school-only records', async () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
  render(<ProfilePage />);
  const services = screen.getByRole('region', { name: '常用入口' });
  expect(within(services).getByRole('link', { name: /課堂成績與回饋/ }).getAttribute('href')).toBe('/grades?tab=feedback');
  expect(within(services).getByRole('link', { name: /匯入成績/ }).getAttribute('href')).toBe('/import?kind=grades');
  expect(screen.queryByRole('link', { name: /我的社群頁/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /學分規劃/ })).toBeNull();
  expect(within(services).getAllByRole('link').map((link) => link.getAttribute('href'))).not.toContain('/grades?tab=semester');
  const preferences = screen.getByRole('region', { name: '偏好與權限' });
  expect(within(preferences).getByRole('link', { name: /AI 助理權限/ }).getAttribute('href')).toBe('/settings?section=assistant');
  expect(within(preferences).getByRole('link', { name: /平台服務權限/ }).getAttribute('href')).toBe('/settings?section=platform');
  expect(screen.queryByRole('link', { name: /通知偏好/ })).toBeNull();
  await waitFor(() => expect(browserRequest).toHaveBeenCalledWith('memberships', 'a'));
  expect(state.read).not.toHaveBeenCalled();
});

it('lets visitors use personal tools and appearance before choosing the unified sign-in', () => {
  state.user = null;
  render(<ProfilePage />);
  expect(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')).toBe('/login?returnUrl=%2Fprofile');
  expect(screen.getByRole('link', { name: /我的課表/ }).getAttribute('href')).toBe('/timetable');
  expect(screen.getByRole('link', { name: /外觀與閱讀/ }).getAttribute('href')).toBe('/settings?section=appearance');
  expect(screen.queryByRole('link', { name: /AI 助理權限/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /平台服務權限/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /我的社群頁/ })).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
});

it('clears personalized shortcuts while the account is being checked or signed out', () => {
  state.user = null;
  state.nuni.session = { platformAccountId: 'pa_a', context: 'a', isPlatformOperator: false };
  const view = render(<ProfilePage />);
  expect(screen.getByRole('link', { name: /課堂成績與回饋/ })).toBeTruthy();
  state.nuni.loading = true;
  view.rerender(<ProfilePage />);
  expect(screen.queryByRole('link', { name: /課堂成績與回饋/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /平台服務權限/ })).toBeNull();
  state.nuni.loading = false;
  state.nuni.pendingLogout = true;
  view.rerender(<ProfilePage />);
  expect(screen.queryByRole('link', { name: /課堂成績與回饋/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /AI 助理權限/ })).toBeNull();
});
