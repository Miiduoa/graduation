import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import LoginPage from './page';
const { replace, signIn, state } = vi.hoisted(() => ({
  replace: vi.fn(),
  signIn: vi.fn(),
  state: { params: new URLSearchParams('returnUrl=%2Fgrades') },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => state.params,
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'one' } }) }));
vi.mock('@/features/auth/client', () => ({
  isFirebaseConfigured: () => true,
  signInWithPuStudentId: signIn,
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.params = new URLSearchParams('returnUrl=%2Fgrades');
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
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
  await waitFor(() => expect(signIn).toHaveBeenCalledWith('A1234567', 'test-only-password'));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/grades'));
  expect((screen.getByLabelText('密碼') as HTMLInputElement).value).toBe('');
});
it('retains the reconnection form after a rejected school login', async () => {
  state.params.set('reconnect', 'school');
  signIn.mockRejectedValue(new Error('school unavailable'));
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: '1234567' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'test-only-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登入' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});
