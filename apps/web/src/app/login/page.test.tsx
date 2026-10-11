import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import LoginPage from './page';
const { replace, signIn, state } = vi.hoisted(() => ({
  replace: vi.fn(),
  signIn: vi.fn(),
  state: {
    params: new URLSearchParams('returnUrl=%2Fgrades'),
    user: { uid: 'one' } as { uid: string } | null,
    schoolAvailable: true,
    loading: false,
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
  isFirebaseConfigured: () => state.schoolAvailable,
  signInWithPuStudentId: signIn,
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.params = new URLSearchParams('returnUrl=%2Fgrades');
  state.user = { uid: 'one' };
  state.schoolAvailable = true;
  state.loading = false;
  signIn.mockResolvedValue({ uid: 'one' });
});
it('returns an already signed-in user to the requested page for a normal login', async () => {
  render(<LoginPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/grades'));
});
it('allows a signed-in user to reconnect to school before returning', async () => {
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
it('retains the reconnection form after a rejected school login', async () => {
  state.params.set('reconnect', 'school');
  signIn.mockRejectedValue(new Error('school unavailable'));
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: '1234567' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
  fireEvent.click(screen.getByRole('button', { name: '連線學校帳號' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});

it('offers school verification for an academic task without a misleading Google alternative', () => {
  state.user = null;
  render(<LoginPage />);
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('連線學校帳號');
  expect(screen.getByRole('button', { name: '連線學校帳號' })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});
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
  state.params = new URLSearchParams({ returnUrl: '/timetable?school=pu&schoolId=tw-pu#today' });
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: ' a1234567 ' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
  fireEvent.click(screen.getByRole('button', { name: '連線學校帳號' }));
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith('/timetable?school=pu&schoolId=tw-pu#today'),
  );
});
it('does not accept school credentials while school login is unavailable', () => {
  state.user = null;
  state.schoolAvailable = false;
  render(<LoginPage />);
  expect(screen.getByRole('status').textContent).toContain('學校登入服務尚未開通');
  expect(screen.queryByLabelText('密碼')).toBeNull();
  expect(screen.queryByTestId('platform-sign-in')).toBeNull();
  expect(signIn).not.toHaveBeenCalled();
});

function fillSchoolLogin() {
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: 'a1234567' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
}
it('waits for restored school identity before redirecting or accepting credentials', () => {
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
