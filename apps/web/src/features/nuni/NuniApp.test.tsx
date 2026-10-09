vi.mock('@/components/SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { NuniApp } from './NuniApp';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(),
  signedIn: true,
  pathname: '/classroom/course/cw_11111111-1111-4111-8111-111111111111',
  search: '',
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
      ? { platformAccountId: principalId, context: 'a'.repeat(43), isPlatformOperator: false }
      : null,
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: mocks.refresh,
    logout: vi.fn(),
  }),
  browserRequest: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock('./CourseMaterials', async () => {
  const { useClasses } = await import('./CourseUI');
  const { useRef } = await import('react');
  return {
    CourseMaterials: () => {
      const currentClasses = useClasses();
      const classes = useRef(currentClasses).current;
      return (
        <>
          <input aria-label="教材草稿" />
          <button onClick={() => void classes.materials(workspaceId).catch(() => {})}>
            重新讀取教材
          </button>
        </>
      );
    },
  };
});
vi.mock('./CourseQuizzes', () => ({ CourseQuizzes: () => <input aria-label="測驗草稿" /> }));
vi.mock('./AssignmentCard', () => ({ AssignmentCard: () => <p>已保存作業</p> }));

let failure: NuniError | null;
let memberRole = 'owner-teacher';
beforeEach(() => {
  failure = null;
  memberRole = 'owner-teacher';
  mocks.signedIn = true;
  mocks.pathname = `/classroom/course/${workspaceId}`;
  mocks.search = '';
  window.history.replaceState({}, '', mocks.pathname);
  mocks.refresh.mockReset();
  mocks.request.mockReset().mockImplementation(async (path: string) => {
    if (failure) throw failure;
    if (path === 'sign-in-options') return { google: true };
    if (path === `class-workspaces/${workspaceId}`)
      return { id: workspaceId, title: '設計專題', state: 'active', memberRole };
    if (path.endsWith('/assignments')) return { assignments: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
});

it('keeps the guest course query and linked assignment through Google sign-in', async () => {
  mocks.signedIn = false;
  mocks.search = 'campus=tw-pu';
  const destination = `${mocks.pathname}?${mocks.search}#assignment-cwa_22222222-2222-4222-8222-222222222222`;
  window.history.replaceState({}, '', destination);
  render(<NuniApp />);
  const button = await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
  const form = button.closest('form')!;
  expect(form.method).toBe('post');
  const action = new URL(form.action);
  expect(action.pathname).toBe('/auth/platform/start');
  expect(action.searchParams.get('returnUrl')).toBe(destination);

  const nextDestination = `${mocks.pathname}?${mocks.search}#assignment-cwa_33333333-3333-4333-8333-333333333333`;
  act(() => {
    window.history.replaceState({}, '', nextDestination);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(new URL(form.action).searchParams.get('returnUrl')).toBe(nextDestination);
});

it.each(['/admin', '/merchant?application=current#status'])(
  'preserves the explicit task destination %s at the shared sign-in page',
  async (destination) => {
    mocks.signedIn = false;
    mocks.pathname = '/classroom/login';
    mocks.search = new URLSearchParams({ returnUrl: destination, issue: 'cancelled' }).toString();
    window.history.replaceState({}, '', `${mocks.pathname}?${mocks.search}`);
    render(<NuniApp />);
    const button = await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
    expect(screen.getByText('這次登入沒有完成，請重新登入。')).toBeTruthy();
    expect(new URL(button.closest('form')!.action).searchParams.get('returnUrl')).toBe(
      destination,
    );
  },
);

it('keeps a draft while moving between course panels with mouse and keyboard', async () => {
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  fireEvent.change(screen.getByLabelText('教材草稿'), { target: { value: '尚未發布的內容' } });
  fireEvent.keyDown(screen.getByRole('tab', { name: '教材' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: '測驗' }).getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '測驗' }));
  fireEvent.keyDown(screen.getByRole('tab', { name: '測驗' }), { key: 'Home' });
  expect((screen.getByLabelText('教材草稿') as HTMLInputElement).value).toBe('尚未發布的內容');
});

it('preserves an unsaved draft after a temporary refresh failure and recovers on retry', async () => {
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  fireEvent.change(screen.getByLabelText('教材草稿'), { target: { value: '保留草稿' } });
  failure = new NuniError(503, 'UPSTREAM_UNAVAILABLE');
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('教材草稿') as HTMLInputElement).value).toBe('保留草稿');
  failure = null;
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect((screen.getByLabelText('教材草稿') as HTMLInputElement).value).toBe('保留草稿');
});

it.each([401, 403, 404])(
  'removes course data and drafts when refresh denies access with %i',
  async (status) => {
    render(<NuniApp />);
    await screen.findByRole('heading', { name: '設計專題' });
    fireEvent.click(screen.getByRole('tab', { name: '教材' }));
    fireEvent.change(screen.getByLabelText('教材草稿'), { target: { value: '私人草稿' } });
    failure = new NuniError(status, 'ACCESS_DENIED');
    fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { name: '設計專題' })).toBeNull();
    expect(screen.queryByLabelText('教材草稿')).toBeNull();
    expect(within(screen.getByRole('alert')).getByRole('button', { name: '重試' })).toBeTruthy();
  },
);

it('does not restore course data from an earlier refresh after a nested read denies access', async () => {
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  let finish!: (value: unknown) => void;
  mocks.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/materials')) throw new NuniError(403, 'ACCESS_DENIED');
    if (path.endsWith('/assignments')) return { assignments: [] };
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  fireEvent.click(screen.getByRole('button', { name: '重新讀取教材' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: '設計專題' })).toBeNull();
  await act(async () =>
    finish({ id: workspaceId, title: '設計專題', state: 'active', memberRole: 'owner-teacher' }),
  );
  expect(screen.queryByRole('heading', { name: '設計專題' })).toBeNull();
  expect(screen.queryByLabelText('教材草稿')).toBeNull();
});

it('clears course data when a retained child client loses access after a completed parent refresh', async () => {
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '更新內容' })).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  failure = new NuniError(403, 'ACCESS_DENIED');
  fireEvent.click(screen.getByRole('button', { name: '重新讀取教材' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: '設計專題' })).toBeNull();
});

it('clears course data when the parent invite mutation loses access', async () => {
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  failure = new NuniError(403, 'ACCESS_DENIED');
  fireEvent.click(screen.getByRole('button', { name: '產生邀請碼' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: '設計專題' })).toBeNull();
  expect(screen.queryByRole('button', { name: '產生邀請碼' })).toBeNull();
});

it('allows a co-teacher to publish work without offering the owner-only invite action', async () => {
  memberRole = 'co-teacher';
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  expect(screen.getAllByText('發布作業').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: '產生邀請碼' })).toBeNull();
  expect(screen.queryByRole('heading', { name: '邀請學生' })).toBeNull();
});
