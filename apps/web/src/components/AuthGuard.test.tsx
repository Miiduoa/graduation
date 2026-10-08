import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthGuard';
import { getAuth } from '@/features/auth/client';
import { onAuthStateChanged, signOut } from 'firebase/auth';
const teachingSignOut = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({ auth: { signOut: teachingSignOut } }),
}));
vi.mock('@/features/auth/client', () => ({ getAuth: vi.fn() }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn(), signOut: vi.fn() }));
function Status() {
  const { user, loading } = useAuth();
  return <div>{loading ? 'Checking account' : user ? `Account ${user.uid}` : 'Signed out'}</div>;
}
beforeEach(() => {
  vi.clearAllMocks();
  teachingSignOut.mockResolvedValue({ error: null });
  vi.mocked(signOut).mockResolvedValue();
});
it('keeps server and initial client markup stable even with a restored browser account', () => {
  vi.mocked(getAuth).mockReturnValue({ currentUser: { uid: 'alice' } } as never);
  expect(
    renderToString(
      <AuthProvider>
        <Status />
      </AuthProvider>,
    ),
  ).toContain('Checking account');
  expect(getAuth).not.toHaveBeenCalled();
});
it('leaves loading when the service is unavailable without inventing an account', async () => {
  vi.mocked(getAuth).mockReturnValue(null);
  render(
    <AuthProvider>
      <Status />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByText('Signed out')).toBeTruthy());
  expect(onAuthStateChanged).not.toHaveBeenCalled();
});

it('invalidates the separate teaching session on initial identity, account switch, and cross-tab logout', async () => {
  let changed!: (user: unknown) => void;
  vi.mocked(getAuth).mockReturnValue({} as never);
  vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
    changed = callback as (user: unknown) => void;
    return () => {};
  });
  render(
    <AuthProvider>
      <Status />
    </AuthProvider>,
  );
  await act(async () => changed({ uid: 'alice' }));
  expect(teachingSignOut).toHaveBeenCalledWith({ scope: 'local' });
  await act(async () => changed({ uid: 'bob' }));
  expect(screen.getByText('Account bob')).toBeTruthy();
  expect(teachingSignOut).toHaveBeenCalledTimes(2);
  await act(async () => changed(null));
  expect(screen.getByText('Signed out')).toBeTruthy();
  expect(teachingSignOut).toHaveBeenCalledTimes(3);
});

it('shared logout closes both sessions and hides readers before either network request settles', async () => {
  let changed!: (user: unknown) => void;
  let finish!: () => void;
  vi.mocked(getAuth).mockReturnValue({} as never);
  vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
    changed = callback as (user: unknown) => void;
    return () => {};
  });
  function Logout() {
    const { signOutUser } = useAuth();
    return (
      <>
        <Status />
        <button onClick={() => void signOutUser()}>Log out</button>
      </>
    );
  }
  render(
    <AuthProvider>
      <Logout />
    </AuthProvider>,
  );
  await act(async () => changed({ uid: 'alice' }));
  vi.mocked(signOut).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
  expect(screen.getByText('Signed out')).toBeTruthy();
  expect(teachingSignOut).toHaveBeenCalledTimes(2);
  await act(async () => finish());
});
