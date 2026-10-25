import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniWorkspace } from '@campus/shared/src/nuni';
import { ClassWorkspace } from './ClassWorkspace';

const mocks = vi.hoisted(() => ({
  session: null as null | {
    platformAccountId: string;
    context: string;
    isPlatformOperator: boolean;
  },
  loading: false,
  pendingLogout: false,
  get: vi.fn(),
  assignments: vi.fn(),
  units: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: mocks.session,
    loading: mocks.loading,
    error: '',
    pendingLogout: mocks.pendingLogout,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('@/features/nuni/CourseUI', () => ({
  useClasses: () => ({ get: mocks.get, assignments: mocks.assignments, units: mocks.units }),
  CourseAccessBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/features/nuni/CourseAssignments', () => ({ CourseAssignments: () => null }));
vi.mock('@/features/nuni/CourseLearningPath', () => ({ CourseLearningPath: () => null }));
vi.mock('@/features/nuni/CourseMaterials', () => ({ CourseMaterials: () => null }));
vi.mock('@/features/nuni/CourseQuizzes', () => ({ CourseQuizzes: () => null }));
vi.mock('./ClassroomSessions', () => ({
  ClassroomSessions: ({ isTeacher }: { isTeacher: boolean }) => (
    <section>{isTeacher ? <button>開始課堂</button> : <p>學生簽到</p>}</section>
  ),
}));

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const secondWorkspaceId = 'cw_22222222-2222-4222-8222-222222222222';
const principal = {
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  context: 'a'.repeat(43),
  isPlatformOperator: false,
};
const workspace = (extra: Partial<NuniWorkspace> = {}): NuniWorkspace => ({
  id: workspaceId,
  title: '原帳號的私有課班',
  state: 'active',
  memberRole: 'owner-teacher',
  ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const fetcher = vi.fn();
beforeEach(() => {
  mocks.session = { ...principal };
  mocks.loading = false;
  mocks.pendingLogout = false;
  mocks.get.mockReset().mockResolvedValue(workspace());
  mocks.assignments.mockReset().mockResolvedValue([]);
  mocks.units.mockReset().mockResolvedValue([]);
  fetcher.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/members'))
      return ok({
        members: [{ platformAccountId: 'pa_member', displayName: '原帳號的學生', role: 'student' }],
      });
    return ok({});
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

it('rejects an unknown workspace id without calling APIs', () => {
  render(<ClassWorkspace workspaceId="not-a-workspace" />);
  expect(screen.getByRole('heading', { name: '找不到課班' })).toBeTruthy();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it('asks guests to sign in before opening a workspace', () => {
  mocks.session = null;
  render(<ClassWorkspace workspaceId={workspaceId} />);
  expect(screen.getByRole('heading', { name: '請先登入' })).toBeTruthy();
  expect(mocks.get).not.toHaveBeenCalled();
});
it('hides the previous account workspace immediately while the new context is loading', async () => {
  const view = render(<ClassWorkspace workspaceId={workspaceId} />);
  await screen.findByRole('heading', { name: '原帳號的私有課班' });
  const next = deferred<NuniWorkspace>();
  mocks.get.mockReturnValueOnce(next.promise);
  mocks.session = { ...principal, context: 'b'.repeat(43) };
  view.rerender(<ClassWorkspace workspaceId={workspaceId} />);
  expect(screen.queryByRole('heading', { name: '原帳號的私有課班' })).toBeNull();
  expect(screen.queryByRole('button', { name: '開始課堂' })).toBeNull();
  await act(async () => next.resolve(workspace({ title: '新帳號的課班', memberRole: 'student' })));
  expect(await screen.findByRole('heading', { name: '新帳號的課班' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '開始課堂' })).toBeNull();
});
it.each(['loading', 'pendingLogout'] as const)(
  'unmounts private members and controls during %s',
  async (flag) => {
    const view = render(<ClassWorkspace workspaceId={workspaceId} />);
    await screen.findByRole('heading', { name: '原帳號的私有課班' });
    fireEvent.click(screen.getByRole('tab', { name: '成員' }));
    expect(screen.getByText('原帳號的學生')).toBeTruthy();
    mocks[flag] = true;
    view.rerender(<ClassWorkspace workspaceId={workspaceId} />);
    expect(screen.queryByText('原帳號的學生')).toBeNull();
    expect(screen.queryByRole('heading', { name: '原帳號的私有課班' })).toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  },
);
it('does not display the previous workspace while navigating to another workspace', async () => {
  const view = render(<ClassWorkspace workspaceId={workspaceId} />);
  await screen.findByRole('heading', { name: '原帳號的私有課班' });
  const next = deferred<NuniWorkspace>();
  mocks.get.mockReturnValueOnce(next.promise);
  view.rerender(<ClassWorkspace workspaceId={secondWorkspaceId} />);
  expect(screen.queryByRole('heading', { name: '原帳號的私有課班' })).toBeNull();
  await act(async () => next.resolve(workspace({ id: secondWorkspaceId, title: '另一門課班' })));
  expect(await screen.findByRole('heading', { name: '另一門課班' })).toBeTruthy();
});
it.each(['success', 'denied'] as const)(
  'ignores an old context late %s after a new account has loaded',
  async (outcome) => {
    const old = deferred<NuniWorkspace>();
    mocks.get.mockReturnValueOnce(old.promise);
    const view = render(<ClassWorkspace workspaceId={workspaceId} />);
    mocks.session = { ...principal, context: 'b'.repeat(43) };
    mocks.get.mockResolvedValueOnce(workspace({ title: '新帳號的課班', memberRole: 'student' }));
    view.rerender(<ClassWorkspace workspaceId={workspaceId} />);
    await screen.findByRole('heading', { name: '新帳號的課班' });
    await act(async () => {
      if (outcome === 'success') old.resolve(workspace());
      else old.reject(new NuniError(403, 'COURSE_ACCESS_DENIED'));
    });
    expect(screen.getByRole('heading', { name: '新帳號的課班' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '原帳號的私有課班' })).toBeNull();
  },
);

it('clears denied member data without waiting for another pending course read', async () => {
  render(<ClassWorkspace workspaceId={workspaceId} />);
  await screen.findByRole('heading', { name: '原帳號的私有課班' });
  fireEvent.click(screen.getByRole('tab', { name: '成員' }));
  expect(screen.getByText('原帳號的學生')).toBeTruthy();
  const pending = deferred<NuniWorkspace>();
  mocks.get.mockReturnValueOnce(pending.promise);
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/members') ? ok({}, 403) : ok({}),
  );
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  await waitFor(() => expect(screen.queryByText('原帳號的學生')).toBeNull());
  await act(async () => pending.resolve(workspace()));
  expect(screen.queryByText('原帳號的學生')).toBeNull();
});
it.each([
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [409, 'SESSION_CHANGED'],
] as const)('clears the loaded workspace when a refresh returns %s %s', async (status, code) => {
  render(<ClassWorkspace workspaceId={workspaceId} />);
  await screen.findByRole('heading', { name: '原帳號的私有課班' });
  mocks.get.mockRejectedValueOnce(new NuniError(status, code));
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: '原帳號的私有課班' })).toBeNull(),
  );
  expect(screen.queryByRole('button', { name: '開始課堂' })).toBeNull();
});
