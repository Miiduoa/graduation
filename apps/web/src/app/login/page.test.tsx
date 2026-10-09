import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import LoginPage from './page';
const { replace, signIn, state } = vi.hoisted(() => ({
  replace: vi.fn(),
  signIn: vi.fn(),
  state: {
    params: new URLSearchParams('returnUrl=%2Fgrades'),
    user: { uid: 'one' } as { uid: string } | null,
    schoolAvailable: true,
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => state.params,
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/NuniSignIn', () => ({
  NuniSignIn: ({ returnUrl }: { returnUrl: string }) => (
    <section data-testid="platform-sign-in" data-return-url={returnUrl}>
      課程與跨校交流
    </section>
  ),
}));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/features/auth/client', () => ({
  isFirebaseConfigured: () => state.schoolAvailable,
  signInWithPuStudentId: signIn,
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.params = new URLSearchParams('returnUrl=%2Fgrades');
  state.user = { uid: 'one' };
  state.schoolAvailable = true;
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
  await waitFor(() => expect(signIn).toHaveBeenCalledWith('A1234567', 'test-only-password'));
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
