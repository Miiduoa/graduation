import { render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthGuard';
import { getAuth } from '@/features/auth/client';
import { onAuthStateChanged } from 'firebase/auth';
vi.mock('@/features/auth/client', () => ({ getAuth: vi.fn() }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn(), signOut: vi.fn() }));
function Status() {
  const { user, loading } = useAuth();
  return <div>{loading ? 'Checking account' : user ? `Account ${user.uid}` : 'Signed out'}</div>;
}
beforeEach(() => vi.clearAllMocks());
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
