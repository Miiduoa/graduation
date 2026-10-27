import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LoginPage from './page';
import {
  SCHOOL_LOGIN_GENERIC_ERROR,
  SchoolLoginHttpError,
  TEACHER_LMS_UNAVAILABLE_CODE,
  TEACHER_LMS_UNAVAILABLE_COPY,
} from '@/lib/schoolLoginErrorCopy';
import { STUDENT_ID_PREPARING_COPY } from '@/lib/signInOptions';
const { replace, signIn, state } = vi.hoisted(() => ({
  replace: vi.fn(),
  signIn: vi.fn(),
  state: {
    params: new URLSearchParams('returnUrl=%2Fgrades'),
    user: { uid: 'one' } as { uid: string } | null,
    studentId: false,
    loading: false,
    optionsLoading: false,
    optionsError: false,
    retryOptions: vi.fn(),
    selectedSchoolId: null as string | null,
    schoolDirectoryLoading: false,
    selectSchool: vi.fn(),
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => state.params,
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/NuniSignIn', () => ({
  NuniSignIn: ({
    returnUrl,
    disabled,
    onStart,
  }: {
    returnUrl: string;
    disabled: boolean;
    onStart: () => boolean;
  }) => (
    <section data-testid="platform-sign-in" data-return-url={returnUrl}>
      課程與跨校交流
      <button disabled={disabled} onClick={onStart}>
        使用 Google 帳號繼續
      </button>
    </section>
  ),
}));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.user, loading: state.loading }),
}));
vi.mock('@/features/auth/client', () => ({
  isFirebaseConfigured: () => true,
  signInWithPuStudentId: signIn,
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchoolId: state.selectedSchoolId,
    selectedSchool: state.selectedSchoolId ? { id: state.selectedSchoolId, name: '校園' } : null,
    loading: state.schoolDirectoryLoading,
    selectSchool: state.selectSchool,
    schools: [{ id: 'pu', name: '靜宜大學' }, { id: 'ntu', name: '國立臺灣大學' }],
  }),
}));
vi.mock('@/lib/signInOptions', async (original) => ({
  ...(await original<typeof import('@/lib/signInOptions')>()),
  useSignInOptions: (schoolId?: string | null, ready = true) => ({
    google: true,
    studentId: ready && state.studentId && schoolId !== 'ntu',
    loading: state.optionsLoading || !ready,
    error: state.optionsError,
    retry: state.retryOptions,
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.params = new URLSearchParams('returnUrl=%2Fgrades');
  state.user = { uid: 'one' };
  state.studentId = false;
  state.loading = false;
  state.optionsLoading = false;
  state.optionsError = false;
  state.selectedSchoolId = null;
  state.schoolDirectoryLoading = false;
  signIn.mockResolvedValue({ uid: 'one' });
  vi.stubGlobal('location', { ...window.location, replace });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it('keeps a school return destination during an availability failure instead of offering the wrong account', () => {
  state.user = null;
  state.optionsError = true;
  render(<LoginPage />);
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.queryByText(STUDENT_ID_PREPARING_COPY)).toBeNull();
  expect(screen.queryByLabelText('學號')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新確認登入方式' }));
  expect(state.retryOptions).toHaveBeenCalledOnce();
});
it('returns an already signed-in school user to the requested page only when student ID is available', async () => {
  state.user = { uid: 'pu-one' };
  state.studentId = true;
  render(<LoginPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/grades'));
});
it.each(['', 'schoolId=pu'])(
  'returns home after school sign-in when the login URL has no returnUrl (%s)',
  async (search) => {
    state.user = null;
    state.studentId = true;
    state.params = new URLSearchParams(search);
    state.selectedSchoolId = search.includes('pu') ? 'pu' : null;
    render(<LoginPage />);
    fillSchoolLogin();
    fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(replace).toHaveBeenCalledOnce();
  },
);
it('still returns home if campus selection rehydrates while school sign-in is finishing', async () => {
  state.user = null;
  state.studentId = true;
  state.params = new URLSearchParams();
  state.selectedSchoolId = 'pu';
  let finish!: (value: unknown) => void;
  signIn.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<LoginPage />);
  fillSchoolLogin();
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  expect(signIn).toHaveBeenCalledOnce();
  state.schoolDirectoryLoading = true;
  state.selectedSchoolId = null;
  view.rerender(<LoginPage />);
  state.schoolDirectoryLoading = false;
  state.selectedSchoolId = 'pu';
  view.rerender(<LoginPage />);
  await act(async () => finish({ uid: 'pu-one' }));
  expect(replace).toHaveBeenCalledOnce();
  expect(replace).toHaveBeenCalledWith('/');
});
it('returns home instead of honoring an off-site returnUrl after school sign-in', async () => {
  state.user = null;
  state.studentId = true;
  state.params = new URLSearchParams({ returnUrl: 'https://evil.test' });
  render(<LoginPage />);
  fillSchoolLogin();
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  expect(replace.mock.calls.some((call) => String(call[0]).includes('evil.test'))).toBe(false);
});
it('does not show the student-id form when the selected school is ntu', () => {
  state.user = null;
  state.studentId = true;
  state.selectedSchoolId = 'ntu';
  render(<LoginPage />);
  expect(screen.queryByLabelText('學號')).toBeNull();
  expect(screen.queryByRole('button', { name: '連線學校帳號' })).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});
it('does not send a Google-only session into a school form that cannot sign in', () => {
  render(<LoginPage />);
  expect(replace).not.toHaveBeenCalled();
  expect(
    screen.getByText('學校帳號登入目前未開放，暫時無法連線這項服務。你原本要開啟的頁面已保留。'),
  ).toBeTruthy();
  expect(screen.queryByText(STUDENT_ID_PREPARING_COPY)).toBeNull();
  expect(screen.queryByLabelText('學號')).toBeNull();
  expect(screen.queryByRole('button', { name: '連線學校帳號' })).toBeNull();
  expect(screen.queryByText('使用靜宜大學學號登入')).toBeNull();
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.getByRole('link', { name: '改用一般登入' }).getAttribute('href')).toBe('/login');
  expect(screen.getByRole('link', { name: '不登入，繼續瀏覽' })).toBeTruthy();
});
it('allows a signed-in user to reconnect to school before returning', async () => {
  state.studentId = true;
  state.params.set('reconnect', 'school');
  render(<LoginPage />);
  expect(replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: 'a1234567' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
  fireEvent.click(screen.getByRole('button', { name: '連線學校帳號' }));
  await waitFor(() =>
    expect(signIn).toHaveBeenCalledWith('A1234567', 'test-only-password', expect.any(AbortSignal)),
  );
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/grades'));
  expect((screen.getByLabelText('密碼') as HTMLInputElement).value).toBe('');
});
it('lets a school-only user choose the platform account for a social or classroom task', () => {
  state.params = new URLSearchParams('returnUrl=%2Fsocial');
  render(<LoginPage />);
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByText('課程與跨校交流')).toBeTruthy();
});
it('offers Google for course feedback while retaining the requested campus and tab', () => {
  state.user = null;
  const destination = '/grades?schoolId=tw-pu&tab=feedback';
  state.params = new URLSearchParams({ returnUrl: destination });
  render(<LoginPage />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('登入');
  expect(screen.getByTestId('platform-sign-in').getAttribute('data-return-url')).toBe(destination);
  expect(screen.queryByText('這個頁面要用學校帳號，Google 帳號無法代替。')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});

it.each([
  '/admin/ops',
  '/admin/ops?tab=people&campus=pu#people',
  '/admin/school-review',
  '/admin/school-review?campus=pu#pending',
])('offers platform sign-in for the administrator return destination %s', (destination) => {
  state.user = null;
  state.params = new URLSearchParams({ returnUrl: destination });
  render(<LoginPage />);
  expect(screen.getByTestId('platform-sign-in').getAttribute('data-return-url')).toBe(destination);
  expect(screen.getByRole('button', { name: '使用 Google 帳號繼續' })).toBeTruthy();
  expect(screen.queryByText('這個頁面要用學校帳號，Google 帳號無法代替。')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});

it.each([
  '/admin/ops/private',
  '/admin/school-review/private',
  '/admin/ops-extra',
  '/admin/school-review-extra',
])('does not expand platform login eligibility to the unlisted administrator path %s', (destination) => {
  state.user = null;
  state.params = new URLSearchParams({ returnUrl: destination });
  render(<LoginPage />);
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});
it('honors an explicit school sign-in for course feedback without offering Google instead', async () => {
  state.user = null;
  state.studentId = true;
  const destination = '/grades?tab=feedback';
  state.params = new URLSearchParams({ returnUrl: destination, reconnect: 'school' });
  render(<LoginPage />);
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('連線學校帳號');
  fillSchoolLogin();
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(destination));
});
it('retains the reconnection form after a rejected school login', async () => {
  state.studentId = true;
  state.params.set('reconnect', 'school');
  signIn.mockRejectedValue(new Error('school unavailable'));
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: '1234567' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
  fireEvent.click(screen.getByRole('button', { name: '連線學校帳號' }));
  expect((await screen.findByRole('alert')).textContent).toBe(SCHOOL_LOGIN_GENERIC_ERROR);
  expect(replace).not.toHaveBeenCalled();
});

it.each([
  [401, '學號或密碼錯誤', '學號或密碼錯誤'],
  [401, '<img src=x onerror=alert(1)>', '學號或密碼錯誤'],
  [503, '尚未開放', '這間學校尚未開放學號登入'],
  [503, '學校系統暫時無法連線', '學校系統暫時連不上，請稍後再試'],
  [503, TEACHER_LMS_UNAVAILABLE_COPY, TEACHER_LMS_UNAVAILABLE_COPY],
  [429, 'Too many requests', '嘗試太多次，請稍後再試'],
  [503, '暫時無法驗證老師身分', SCHOOL_LOGIN_GENERIC_ERROR],
  [500, 'PU student login failed', SCHOOL_LOGIN_GENERIC_ERROR],
] as const)(
  'shows a fixed school login notice for HTTP %s',
  async (status, serverError, copy) => {
    state.user = null;
    state.studentId = true;
    signIn.mockRejectedValue(new SchoolLoginHttpError(status, serverError));
    render(<LoginPage />);
    fillSchoolLogin();
    fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
    const notice = (await screen.findByRole('alert')).textContent;
    expect(notice).toBe(copy);
    expect(notice).not.toContain('<');
    expect(notice).not.toContain('onerror');
    expect(replace).not.toHaveBeenCalled();
  },
);

it('shows the teacher LMS notice from the error code even if the server body is unknown', async () => {
  state.user = null;
  state.studentId = true;
  signIn.mockRejectedValue(
    new SchoolLoginHttpError(503, '<script>evil</script>', TEACHER_LMS_UNAVAILABLE_CODE),
  );
  render(<LoginPage />);
  fillSchoolLogin();
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toBe(TEACHER_LMS_UNAVAILABLE_COPY);
});

it('offers school verification for an academic task without a misleading Google alternative', () => {
  state.user = null;
  state.studentId = true;
  render(<LoginPage />);
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('連線學校帳號');
  expect(screen.getByRole('button', { name: '連線學校帳號' })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '不登入，繼續瀏覽' }).getAttribute('href')).toBe(
    '/#public-services',
  );
});

it('keeps a school task school-only when student ID is not available', () => {
  state.user = null;
  render(<LoginPage />);
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('連線學校帳號');
  expect(
    screen.getByText('學校帳號登入目前未開放，暫時無法連線這項服務。你原本要開啟的頁面已保留。'),
  ).toBeTruthy();
  expect(screen.queryByText(STUDENT_ID_PREPARING_COPY)).toBeNull();
  expect(screen.queryByLabelText('學號')).toBeNull();
  expect(screen.getByRole('link', { name: '改用一般登入' }).getAttribute('href')).toBe('/login');
  expect(screen.getByRole('link', { name: '不登入，繼續瀏覽' })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});

it('treats lost-found as a school destination under Google-only sign-in options', () => {
  state.user = null;
  state.params = new URLSearchParams('returnUrl=%2Flost-found%3FschoolId%3Dpu');
  render(<LoginPage />);
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('連線學校帳號');
  expect(
    screen.getByText('這個頁面要用學校帳號，Google 帳號無法代替。'),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: '不登入，繼續瀏覽' }).getAttribute('href')).toBe(
    '/#public-services',
  );
  expect(replace).not.toHaveBeenCalled();
});

it('keeps an explicit school reconnect channel without auto-return', () => {
  state.user = { uid: 'one' };
  state.studentId = true;
  state.params = new URLSearchParams({
    returnUrl: '/lost-found?schoolId=pu',
    reconnect: 'school',
  });
  render(<LoginPage />);
  expect(replace).not.toHaveBeenCalled();
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('重新連線學校帳號');
  expect(screen.getByRole('button', { name: '連線學校帳號' })).toBeTruthy();
});

it('does not repeatedly redirect while school options are still loading', () => {
  state.user = { uid: 'one' };
  state.studentId = false;
  state.optionsLoading = true;
  render(<LoginPage />);
  expect(replace).not.toHaveBeenCalled();
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.getByText('正在確認登入方式…')).toBeTruthy();
  expect(screen.queryByLabelText('學號')).toBeNull();
});

it.each([
  '/map?school=pu&focus=library#route',
  '/bus?schoolId=tw-pu',
  '/announcements/news-123?schoolId=tw-pu',
  '/cafeteria',
  '/cafeteria/stall?schoolId=pu',
  '/library',
  '/school-info',
])(
  'keeps public destination %s optional and preserves the task with either account or guest browsing',
  (destination) => {
    state.user = null;
    state.params = new URLSearchParams({ returnUrl: destination });
    render(<LoginPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('登入');
    expect(screen.getByTestId('platform-sign-in').getAttribute('data-return-url')).toBe(
      destination,
    );
    expect(screen.getByRole('link', { name: '不登入，繼續瀏覽' }).getAttribute('href')).toBe(
      destination,
    );
    expect(replace).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  },
);

it('keeps guest services accessible while school identity is loading or unavailable', () => {
  state.user = null;
  state.loading = true;
  render(<LoginPage />);
  expect(screen.getByRole('link', { name: '校園地圖' }).getAttribute('href')).toBe('/map');
  expect(screen.getByRole('link', { name: '公車資訊' }).getAttribute('href')).toBe('/bus');
  expect(screen.getByRole('link', { name: '公開公告' }).getAttribute('href')).toBe(
    '/announcements',
  );
  expect(screen.getByRole('link', { name: '不登入，繼續瀏覽' })).toBeTruthy();
  expect(screen.queryByLabelText('密碼')).toBeNull();
  expect(signIn).not.toHaveBeenCalled();
});

it('uses school identity only for the explicit legacy map favorite action and returns to that place', async () => {
  state.user = null;
  state.studentId = true;
  const destination = '/map?schoolId=pu&route=gate%2Clibrary&focus=library#directions';
  state.params = new URLSearchParams({ returnUrl: destination, reconnect: 'school' });
  render(<LoginPage />);
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('連線學校帳號');
  expect(screen.getByText('你選擇的個人功能仍使用學校帳號；瀏覽校園資訊不需登入。')).toBeTruthy();
  expect(screen.getByRole('link', { name: '不登入，繼續瀏覽' }).getAttribute('href')).toBe(
    destination,
  );
  fillSchoolLogin();
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(destination));
  expect(signIn).toHaveBeenCalledOnce();
});
it('returns to the original assignment after school sign-in', async () => {
  state.user = null;
  state.studentId = true;
  const destination = '/course/cs101#assignment-hw-1';
  state.params = new URLSearchParams({ returnUrl: destination });
  render(<LoginPage />);
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  fillSchoolLogin();
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(destination));
  expect(signIn).toHaveBeenCalledOnce();
});

it('returns to the assignment once when the course page stacked the hash onto login', async () => {
  state.user = null;
  state.studentId = true;
  window.history.replaceState(
    null,
    '',
    '/login?returnUrl=%2Fcourse%2Fcs101%23assignment-hw-3#assignment-hw-3',
  );
  state.params = new URLSearchParams({
    returnUrl: '/course/cs101#assignment-hw-3#assignment-hw-3',
  });
  try {
    render(<LoginPage />);
    fillSchoolLogin();
    fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/course/cs101#assignment-hw-3'));
    expect(replace.mock.calls[0][0]).not.toContain('#assignment-hw-3#assignment-hw-3');
    expect(window.location.hash).toBe('');
  } finally {
    window.history.replaceState(null, '', '/');
  }
});

it('returns to the same storefront after a platform login', () => {
  state.user = null;
  const destination = '/cafeteria/stall?schoolId=pu';
  state.params = new URLSearchParams({ returnUrl: destination });
  render(<LoginPage />);
  expect(screen.getByTestId('platform-sign-in').getAttribute('data-return-url')).toBe(destination);
  expect(screen.getByRole('link', { name: '不登入，繼續瀏覽' }).getAttribute('href')).toBe(
    destination,
  );
});

it.each([
  'https://evil.test',
  '//evil.test',
  '/\\evil.test',
  'https://evil.test/admin/ops',
  '//evil.test/admin/school-review',
])(
  'does not honor an off-site returnUrl %s',
  (target) => {
    state.user = null;
    state.params = new URLSearchParams({ returnUrl: target });
    render(<LoginPage />);
    expect(screen.getByTestId('platform-sign-in').getAttribute('data-return-url')).toBe('/');
    expect(replace).not.toHaveBeenCalled();
  },
);

it.each([
  '/login',
  '/login/',
  '/log%69n?returnUrl=%2Flogin',
  '/classroom/login',
  '/admin/login',
  '/auth/platform/start',
  '/api/nuni/logout',
  '/sso-callback',
])('does not return a school user into an authentication loop: %s', (target) => {
  state.params = new URLSearchParams({ returnUrl: target });
  render(<LoginPage />);
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByTestId('platform-sign-in').getAttribute('data-return-url')).toBe('/');
});
it('retains the full original academic task after school verification', async () => {
  state.user = null;
  state.studentId = true;
  state.params = new URLSearchParams({ returnUrl: '/timetable?school=pu&schoolId=tw-pu#today' });
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: ' a1234567 ' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
  fireEvent.click(screen.getByRole('button', { name: '連線學校帳號' }));
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith('/timetable?school=pu&schoolId=tw-pu#today'),
  );
});
it('does not accept school credentials while student ID is unavailable', () => {
  state.user = null;
  render(<LoginPage />);
  expect(
    screen.getByText('學校帳號登入目前未開放，暫時無法連線這項服務。你原本要開啟的頁面已保留。'),
  ).toBeTruthy();
  expect(screen.queryByLabelText('密碼')).toBeNull();
  expect(screen.queryByText('使用靜宜大學學號登入')).toBeNull();
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(signIn).not.toHaveBeenCalled();
});

it('still offers Google for ordinary platform tasks when student ID is unavailable', () => {
  state.user = null;
  state.params = new URLSearchParams('returnUrl=%2Fsocial');
  render(<LoginPage />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('登入');
  expect(screen.getByTestId('platform-sign-in').getAttribute('data-return-url')).toBe('/social');
  expect(screen.getByText(STUDENT_ID_PREPARING_COPY)).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});

function fillSchoolLogin() {
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: 'a1234567' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
}
it('waits for restored school identity before redirecting or accepting credentials', () => {
  state.user = { uid: 'pu-one' };
  state.studentId = true;
  state.loading = true;
  const view = render(<LoginPage />);
  expect(replace).not.toHaveBeenCalled();
  expect(
    (screen.getByRole('button', { name: '正在確認學校帳號…' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  expect(signIn).not.toHaveBeenCalled();
  state.loading = false;
  view.rerender(<LoginPage />);
  expect(replace).toHaveBeenCalledOnce();
  expect(replace).toHaveBeenCalledWith('/grades');
});
it.each(['unmount', 'change task'])(
  'does not navigate from a late school response after %s',
  async (action) => {
    state.user = null;
    state.studentId = true;
    let finish!: (value: unknown) => void;
    signIn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<LoginPage />);
    fillSchoolLogin();
    fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
    const signal = signIn.mock.calls[0][2] as AbortSignal;
    if (action === 'unmount') view.unmount();
    else {
      state.params = new URLSearchParams('returnUrl=%2Fmerchant');
      view.rerender(<LoginPage />);
      expect((screen.getByLabelText('密碼') as HTMLInputElement).value).toBe('');
    }
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ uid: 'one' }));
    expect(replace).not.toHaveBeenCalled();
  },
);
it('admits one school request and waits for its completion before redirecting', async () => {
  state.user = null;
  state.studentId = true;
  let finish!: (value: unknown) => void;
  signIn.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<LoginPage />);
  fillSchoolLogin();
  const form = screen.getByLabelText('學號').closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(signIn).toHaveBeenCalledOnce();
  state.user = { uid: 'one' };
  view.rerender(<LoginPage />);
  expect(replace).not.toHaveBeenCalled();
  await act(async () => finish({ uid: 'one' }));
  expect(replace).toHaveBeenCalledOnce();
});
it('blocks Google while school credentials are being checked and permits retry on failure', async () => {
  state.user = null;
  state.studentId = true;
  state.params = new URLSearchParams('returnUrl=%2Fsocial');
  let fail!: (reason: unknown) => void;
  signIn.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  render(<LoginPage />);
  fillSchoolLogin();
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  expect(
    (screen.getByRole('button', { name: '使用 Google 帳號繼續' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () => fail(new Error('offline')));
  expect(
    (screen.getByRole('button', { name: '使用 Google 帳號繼續' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it('blocks school submission during Google navigation and unlocks on browser return', () => {
  state.user = null;
  state.studentId = true;
  state.params = new URLSearchParams('returnUrl=%2Fsocial');
  render(<LoginPage />);
  fillSchoolLogin();
  fireEvent.click(screen.getByRole('button', { name: '使用 Google 帳號繼續' }));
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  expect(signIn).not.toHaveBeenCalled();
  fireEvent(window, new Event('pageshow'));
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  expect(signIn).toHaveBeenCalledOnce();
});

it('can change the campus from the school sign-in form', () => {
  state.studentId = true;
  state.user = null;
  state.selectedSchoolId = 'pu';
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'ntu' } });
  expect(state.selectSchool).toHaveBeenCalledWith('ntu');
});

it('offers an import path for a campus without student ID sign-in', () => {
  state.studentId = true;
  state.user = null;
  state.selectedSchoolId = 'ntu';
  render(<LoginPage />);
  expect(screen.queryByLabelText('學號')).toBeNull();
  expect(screen.getByRole('link', { name: /前往資料匯入/ }).getAttribute('href')).toBe('/import?schoolId=ntu');
  expect(screen.getByText(/直接複製網頁表格貼上，或匯入從學校下載的 HTML、PDF、CSV 與截圖/)).toBeTruthy();
});

it('clears the rejected school password while preserving the student ID', async () => {
  state.user = null;
  state.studentId = true;
  signIn.mockRejectedValueOnce(new SchoolLoginHttpError(401, '學號或密碼錯誤'));
  render(<LoginPage />);
  fillSchoolLogin();
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  await screen.findByText('學號或密碼錯誤');
  expect((screen.getByLabelText('密碼') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('學號') as HTMLInputElement).value).toBe('a1234567');
});

it('does not treat another Firebase user as a verified school session', () => {
  state.user = { uid: 'external-google-account' };
  state.studentId = true;
  render(<LoginPage />);
  expect(screen.getByLabelText('學號')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});
