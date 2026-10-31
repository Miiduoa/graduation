vi.mock('@/components/SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { NuniApp } from './NuniApp';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  platformFetch: vi.fn(),
  refresh: vi.fn(),
  signedIn: true,
  loading: false,
  pathname: '/classroom/course/cw_11111111-1111-4111-8111-111111111111',
  search: '',
  context: 'a'.repeat(43),
}));
const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const principalId = 'pa_11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: null, loading: false, signOutUser: vi.fn() }),
  GuestAuthProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('./Session', () => ({
  NuniSessionProvider: ({ children }: { children: unknown }) => children,
  useNuniSession: () => ({
    session: mocks.signedIn
      ? { platformAccountId: principalId, context: mocks.context, isPlatformOperator: false }
      : null,
    loading: mocks.loading,
    error: '',
    pendingLogout: false,
    refresh: mocks.refresh,
    logout: vi.fn(),
  }),
  browserRequest: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock('@/features/platform/platformFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/platform/platformFetch')>()),
  platformFetch: (...args: unknown[]) => mocks.platformFetch(...args),
}));
let failure: NuniError | null;
let memberRole = 'owner-teacher';
beforeEach(() => {
  failure = null;
  memberRole = 'owner-teacher';
  mocks.signedIn = true;
  mocks.loading = false;
  mocks.pathname = `/classroom/course/${workspaceId}`;
  mocks.search = '';
  mocks.context = 'a'.repeat(43);
  window.history.replaceState({}, '', mocks.pathname);
  mocks.refresh.mockReset();
  mocks.platformFetch.mockReset().mockImplementation(async (path: string) => ({
    ok: true,
    status: 200,
    body: path.endsWith('/members')
      ? {
          members: [
            { platformAccountId: 'student-1', displayName: '陳同學', memberRole: 'student' },
          ],
        }
      : path.endsWith('/classroom-sessions')
        ? {
            sessions: [{ id: 'session-1', title: '設計討論', state: 'open', checkedInByMe: false }],
          }
        : { affiliation: null, applications: [], present: [], absent: [], late: [] },
  }));
  mocks.request.mockReset().mockImplementation(async (path: string) => {
    if (failure) throw failure;
    if (path === 'sign-in-options') return { google: true };
    if (path === `class-workspaces/${workspaceId}`)
      return { id: workspaceId, title: '設計專題', state: 'active', memberRole };
    if (path.endsWith('/assignments')) return { assignments: [] };
    if (path.endsWith('/units')) return { units: [] };
    if (path.endsWith('/materials/page')) return { materials: [], nextCursor: null };
    if (path.endsWith('/materials')) return { materials: [] };
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
});

it.each([
  [403, false],
  [404, false],
  [403, true],
  [404, true],
] as const)(
  'clears a linked material at the page boundary after %s (older page: %s)',
  async (status, olderPage) => {
    const destination = `${mocks.pathname}?campus=synthetic&view=materials`;
    window.history.replaceState(
      { preserved: true },
      '',
      `${destination}#material-cwm_33333333-3333-4333-8333-333333333333`,
    );
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path.endsWith('/materials/page')) {
        if (olderPage && !args[3])
          return {
            materials: [
              {
                id: 'cwm_22222222-2222-4222-8222-222222222222',
                workspaceId,
                title: '合成教材',
                body: '合成教材正文',
                unitId: null,
                unitTitle: null,
                createdAt: '2026-10-08T08:00:00Z',
                createdByPlatformAccountId: principalId,
              },
            ],
            nextCursor: 'synthetic_older',
          };
        throw new NuniError(status, 'ACCESS_DENIED');
      }
      return original(path, ...args);
    });
    render(<NuniApp />);
    await screen.findByText('目前無法存取這門課程，請重新確認課程權限。');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe(destination);
    expect(window.history.state).toEqual({ preserved: true });
    expect(screen.queryByRole('heading', { name: '設計專題' })).toBeNull();
    expect(screen.queryByText('合成教材正文')).toBeNull();
    expect(screen.queryByRole('tabpanel', { name: '教材' })).toBeNull();
    const requests = mocks.request.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.request.mock.calls.length).toBe(requests);
    expect(
      mocks.request.mock.calls.filter(([path]) => path.endsWith('/materials/page')).length,
    ).toBeLessThanOrEqual(olderPage ? 4 : 2);
  },
);
