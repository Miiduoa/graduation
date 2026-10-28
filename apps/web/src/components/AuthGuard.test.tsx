import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { Suspense } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthGuard, AuthProvider, GuestAuthProvider, useAuth } from './AuthGuard';
import { getAuth } from '@/features/auth/client';
import { onAuthStateChanged, signOut } from 'firebase/auth';
const teachingSignOut = vi.hoisted(() => vi.fn());
const clearOwnedPuCampusSessions = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({ auth: { signOut: teachingSignOut } }),
}));
vi.mock('@/features/auth/client', () => ({ getAuth: vi.fn() }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/clearOwnedPuCampusSessions', () => ({
  clearOwnedPuCampusSessions,
}));
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
it.each([
  { name: 'an unavailable auth service', restoredUser: undefined },
  { name: 'a signed-out account', restoredUser: null },
  { name: 'a restored account', restoredUser: { uid: 'alice' } },
])('hydrates a deferred account branch after resolving $name', async ({ restoredUser }) => {
  vi.mocked(getAuth).mockReturnValue(restoredUser === undefined ? null : ({} as never));
  vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
    (callback as (user: unknown) => void)(restoredUser);
    return () => {};
  });
  function AccountPage() {
    const { user, loading } = useAuth();
    return loading ? (
      <div role="status">Checking account</div>
    ) : (
      <section aria-label="Account">{user ? `Account ${user.uid}` : 'Signed out'}</section>
    );
  }
  const app = (
    <AuthProvider>
      <Suspense fallback={<p role="status">Loading page</p>}>
        <AccountPage />
      </Suspense>
    </AuthProvider>
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Checking account');
  expect(getAuth).not.toHaveBeenCalled();
  const onRecoverableError = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, app, { onRecoverableError });
    });
    expect(container.querySelector('section[aria-label="Account"]')?.textContent).toBe(
      restoredUser ? `Account ${restoredUser.uid}` : 'Signed out',
    );
    expect(onRecoverableError).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
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

it('preserves the school timetable query and section when redirecting a guest to login', () => {
  const location = {
    pathname: '/timetable',
    search: '?week=2026-10-05',
    hash: '#today',
    href: '',
  };
  vi.stubGlobal(
    'window',
    new Proxy(window, {
      get(target, property) {
        return property === 'location' ? location : Reflect.get(target, property);
      },
    }),
  );
  try {
    const view = render(
      <GuestAuthProvider>
        <AuthGuard>
          <p>私人課表</p>
        </AuthGuard>
      </GuestAuthProvider>,
    );
    const destination = new URL(location.href, 'https://campus.test');
    expect(destination.pathname).toBe('/login');
    expect(destination.searchParams.get('returnUrl')).toBe('/timetable?week=2026-10-05#today');
    expect(screen.queryByText('私人課表')).toBeNull();
    view.unmount();
  } finally {
    vi.unstubAllGlobals();
  }
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
  await waitFor(() => expect(typeof finish).toBe('function'));
  await act(async () => finish());
});

it('deletes campus sessions on the server before Firebase sign-out', async () => {
  let changed!: (user: unknown) => void;
  const user = { uid: 'alice', getIdToken: vi.fn().mockResolvedValue('id-token') };
  vi.mocked(getAuth).mockReturnValue({ currentUser: user } as never);
  vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
    changed = callback as (user: unknown) => void;
    return () => {};
  });
  function Logout() {
    const { signOutUser } = useAuth();
    return <button onClick={() => void signOutUser()}>Log out</button>;
  }
  render(
    <AuthProvider>
      <Logout />
    </AuthProvider>,
  );
  await act(async () => changed(user));
  const order: string[] = [];
  clearOwnedPuCampusSessions.mockImplementation(async () => {
    order.push('clear');
  });
  vi.mocked(signOut).mockImplementation(async () => {
    order.push('signOut');
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
  });
  expect(clearOwnedPuCampusSessions).toHaveBeenCalledWith(user);
  expect(order).toEqual(['clear', 'signOut']);
});
