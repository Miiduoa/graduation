vi.mock('@/components/SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
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
    if (path.endsWith('/materials')) return { materials: [] };
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
});

it('offers the all-course gradebook from the classroom list', async () => {
  mocks.pathname = '/classroom';
  window.history.replaceState({}, '', '/classroom');
  mocks.request.mockImplementation(async (path: string) => {
    if (path === 'sign-in-options') return { google: true };
    if (path === 'class-workspaces') return { workspaces: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
  render(<NuniApp />);
  expect((await screen.findByRole('link', { name: '課業成績與回饋' })).getAttribute('href')).toBe(
    '/grades?tab=feedback',
  );
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
    expect(new URL(button.closest('form')!.action).searchParams.get('returnUrl')).toBe(destination);
  },
);

it('keeps a draft while moving between course panels with mouse and keyboard', async () => {
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  fireEvent.change(screen.getByLabelText('教材草稿'), { target: { value: '尚未發布的內容' } });
  fireEvent.keyDown(screen.getByRole('tab', { name: '教材' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: '名冊' }).getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '名冊' }));
  fireEvent.keyDown(screen.getByRole('tab', { name: '名冊' }), { key: 'Home' });
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
  fireEvent.click(screen.getByRole('tab', { name: '作業' }));
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

it('opens linked quizzes on initial load and follows same-course task history without losing drafts', async () => {
  window.history.replaceState(
    {},
    '',
    `${mocks.pathname}#quiz-cwq_11111111-1111-4111-8111-111111111111`,
  );
  render(<NuniApp />);
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: '測驗' }).getAttribute('aria-selected')).toBe('true'),
  );
  fireEvent.change(screen.getByLabelText('測驗草稿'), { target: { value: '我的作答' } });
  act(() => {
    window.location.hash = '#assignment-cwa_11111111-1111-4111-8111-111111111111';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: '作業' }).getAttribute('aria-selected')).toBe('true'),
  );
  fireEvent.click(screen.getByRole('tab', { name: '測驗' }));
  expect((screen.getByLabelText('測驗草稿') as HTMLInputElement).value).toBe('我的作答');
});

it('hydrates a logged-in course hash against the server loading markup', async () => {
  mocks.signedIn = false;
  mocks.loading = true;
  window.history.replaceState(
    {},
    '',
    `${mocks.pathname}#material-cwm_11111111-1111-4111-8111-111111111111`,
  );
  const app = <NuniApp />;
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container.textContent).toContain('正在確認登入狀態…');
  mocks.signedIn = true;
  mocks.loading = false;
  const onRecoverableError = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, app, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    await screen.findByRole('heading', { name: '設計專題' });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '教材' }).getAttribute('aria-selected')).toBe('true'),
    );
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});

it('restores a named panel from the address and retains the course-list search when returning', async () => {
  window.history.replaceState(
    {},
    '',
    `${mocks.pathname}?campus=tw-pu&q=design&courses=studying&task=pending&view=materials`,
  );
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  expect(screen.getByRole('tab', { name: '教材' }).getAttribute('aria-selected')).toBe('true');
  const returnUrl = new URL(
    screen.getByRole('link', { name: '我的課程' }).getAttribute('href')!,
    'https://campus.local',
  );
  expect(returnUrl.pathname).toBe('/classroom');
  expect(Object.fromEntries(returnUrl.searchParams)).toEqual({
    q: 'design',
    courses: 'studying',
    task: 'pending',
    campus: 'tw-pu',
  });
  fireEvent.click(screen.getByRole('tab', { name: '作業' }));
  expect(new URLSearchParams(window.location.search).get('view')).toBe('assignments');
  expect(new URLSearchParams(window.location.search).get('q')).toBe('design');
  expect(new URLSearchParams(window.location.search).get('campus')).toBe('tw-pu');
});

it('allows an explicit panel change after a task link and restores panels through browser history', async () => {
  const linked = `${mocks.pathname}?campus=tw-pu&view=materials#assignment-cwa_11111111-1111-4111-8111-111111111111`;
  window.history.replaceState({}, '', linked);
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  expect(screen.getByRole('tab', { name: '作業' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  expect(screen.getByRole('tab', { name: '教材' }).getAttribute('aria-selected')).toBe('true');
  expect(window.location.hash).toBe('');
  fireEvent.change(screen.getByLabelText('教材草稿'), { target: { value: '還在閱讀與整理' } });
  act(() => {
    window.history.replaceState({}, '', linked);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByRole('tab', { name: '作業' }).getAttribute('aria-selected')).toBe('true');
  act(() => {
    window.history.replaceState({}, '', `${mocks.pathname}?campus=tw-pu&view=materials`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByRole('tab', { name: '教材' }).getAttribute('aria-selected')).toBe('true');
  expect((screen.getByLabelText('教材草稿') as HTMLInputElement).value).toBe('還在閱讀與整理');
});

it('preserves an unrelated fragment while changing a panel and ignores invalid panel values', async () => {
  window.history.replaceState({}, '', `${mocks.pathname}?campus=tw-pu&view=invalid#week`);
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  expect(screen.getByRole('tab', { name: '學習路徑' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  expect(window.location.hash).toBe('#week');
  expect(new URLSearchParams(window.location.search).get('view')).toBe('materials');
});

it('retains the selected agenda course when returning from an assignment link', async () => {
  window.history.replaceState(
    {},
    '',
    `${mocks.pathname}?campus=tw-pu&task=pending&taskCourse=${workspaceId}&view=assignments#assignment-cwa_11111111-1111-4111-8111-111111111111`,
  );
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  const href = screen.getByRole('link', { name: '我的課程' }).getAttribute('href')!;
  const back = new URL(href, 'https://campus.local');
  expect(back.pathname).toBe('/classroom');
  expect(back.searchParams.get('taskCourse')).toBe(workspaceId);
  expect(back.searchParams.get('task')).toBe('pending');
  expect(back.searchParams.get('campus')).toBe('tw-pu');
  expect(back.searchParams.has('view')).toBe(false);
  expect(back.hash).toBe('');
  fireEvent.click(screen.getByRole('tab', { name: '教材' }));
  expect(new URLSearchParams(window.location.search).get('taskCourse')).toBe(workspaceId);
});

it('opens the correct course panel when following an activity from the chapter outline', async () => {
  const taskId = 'cwa_55555555-5555-4555-8555-555555555555';
  mocks.request.mockImplementation(async (path: string) => {
    if (path === `class-workspaces/${workspaceId}`)
      return { id: workspaceId, title: '設計專題', state: 'active', memberRole: 'student' };
    if (path.endsWith('/assignments'))
      return {
        assignments: [
          {
            id: taskId,
            workspaceId,
            title: '介面設計練習',
            instructions: '完成畫面練習',
            state: 'open',
            createdAt: '2026-10-20T00:00:00Z',
            dueAt: '2026-10-30T12:00:00+08:00',
            closedAt: null,
            unitId: null,
            unitTitle: null,
            submissionCount: 0,
            mySubmission: null,
          },
        ],
      };
    if (path.endsWith('/units')) return { units: [] };
    if (path.endsWith('/materials/page')) return { materials: [], nextCursor: null };
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    if (path.endsWith('/materials')) return { materials: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
  render(<NuniApp />);
  const outlineLink = await within(
    await screen.findByRole('tabpanel', { name: '學習路徑' }),
  ).findByRole('link', { name: /介面設計練習/ });
  expect(screen.getByRole('tab', { name: '學習路徑' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(outlineLink);
  expect(screen.getByRole('tab', { name: '作業' }).getAttribute('aria-selected')).toBe('true');
});

it('never displays or reads a roster for a student, including a teacher-only panel URL', async () => {
  memberRole = 'student';
  window.history.replaceState({}, '', `${mocks.pathname}?view=members`);
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  expect(screen.queryByRole('tab', { name: '名冊' })).toBeNull();
  expect(screen.getByRole('tab', { name: '作業' }).getAttribute('aria-selected')).toBe('true');
  expect(mocks.platformFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: '點名' }));
  await screen.findByRole('button', { name: '簽到' });
  expect(mocks.platformFetch.mock.calls.some(([path]) => /\/(members|roster)$/.test(path))).toBe(
    false,
  );
});

it.each(['owner-teacher', 'co-teacher'])('shows the course roster for %s', async (role) => {
  memberRole = role;
  render(<NuniApp />);
  fireEvent.click(await screen.findByRole('tab', { name: '名冊' }));
  await screen.findByText('陳同學');
  expect(mocks.platformFetch).toHaveBeenCalledWith(
    `class-workspaces/${workspaceId}/members`,
    'GET',
    undefined,
    mocks.context,
  );
  fireEvent.click(screen.getByRole('tab', { name: '點名' }));
  await waitFor(() =>
    expect(mocks.platformFetch).toHaveBeenCalledWith(
      `class-workspaces/${workspaceId}/classroom-sessions/session-1/roster`,
      'GET',
      undefined,
      mocks.context,
    ),
  );
});

it('removes the roster when refreshed membership becomes student', async () => {
  render(<NuniApp />);
  fireEvent.click(await screen.findByRole('tab', { name: '名冊' }));
  await screen.findByText('陳同學');
  memberRole = 'student';
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  await waitFor(() => expect(screen.queryByRole('tab', { name: '名冊' })).toBeNull());
  expect(screen.queryByText('陳同學')).toBeNull();
  expect(screen.getByRole('tab', { name: '作業' }).getAttribute('aria-selected')).toBe('true');
});

it('clears the course immediately after the roster endpoint denies access', async () => {
  mocks.platformFetch.mockResolvedValue({
    ok: false,
    status: 403,
    body: { error: 'ACCESS_DENIED' },
  });
  render(<NuniApp />);
  fireEvent.click(await screen.findByRole('tab', { name: '名冊' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: '設計專題' })).toBeNull();
  expect(screen.queryByRole('tab', { name: '名冊' })).toBeNull();
});

it('ignores a previous account roster response after the account context changes', async () => {
  let finish!: (value: unknown) => void;
  mocks.platformFetch.mockImplementation((path: string) =>
    path.endsWith('/members')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ ok: true, status: 200, body: { affiliation: null, applications: [] } }),
  );
  const view = render(<NuniApp />);
  fireEvent.click(await screen.findByRole('tab', { name: '名冊' }));
  await screen.findByText('正在讀取課程名冊…');
  mocks.context = 'b'.repeat(43);
  memberRole = 'student';
  view.rerender(<NuniApp />);
  await waitFor(() => expect(screen.queryByRole('tab', { name: '名冊' })).toBeNull());
  await act(async () =>
    finish({
      ok: true,
      status: 200,
      body: {
        members: [{ platformAccountId: 'old-person', displayName: '上一個帳號的學生' }],
      },
    }),
  );
  expect(screen.queryByText('上一個帳號的學生')).toBeNull();
});

it('retains a newly-created course invite code in the unified course page', async () => {
  mocks.search = 'invite=JOIN123';
  window.history.replaceState({}, '', `${mocks.pathname}?${mocks.search}`);
  render(<NuniApp />);
  fireEvent.click(await screen.findByRole('tab', { name: '作業' }));
  expect(screen.getByText('JOIN123')).toBeTruthy();
});

it.each(['affiliation', 'affiliation-applications'])(
  'clears the course as soon as %s reports a changed session while other reads remain pending',
  async (resource) => {
    mocks.platformFetch.mockImplementation((path: string) =>
      path.endsWith(`/${resource}`)
        ? Promise.resolve({ ok: false, status: 409, body: { error: 'SESSION_CHANGED' } })
        : new Promise(() => {}),
    );
    render(<NuniApp />);
    fireEvent.click(await screen.findByRole('tab', { name: '名冊' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { name: '設計專題' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '名冊' })).toBeNull();
  },
);

it.each(['success', 'failure'] as const)(
  'ignores an old account invite %s after switching accounts',
  async (outcome) => {
    const original = mocks.request.getMockImplementation()!;
    let resolveInvite!: (value: unknown) => void;
    let rejectInvite!: (failure: unknown) => void;
    mocks.request.mockImplementation((path: string, ...args: unknown[]) =>
      path.endsWith('/invites')
        ? new Promise((resolve, reject) => {
            resolveInvite = resolve;
            rejectInvite = reject;
          })
        : original(path, ...args),
    );
    const view = render(<NuniApp />);
    fireEvent.click(await screen.findByRole('tab', { name: '作業' }));
    fireEvent.click(screen.getByRole('button', { name: '產生邀請碼' }));
    mocks.context = 'b'.repeat(43);
    view.rerender(<NuniApp />);
    await screen.findByRole('heading', { name: '設計專題' });
    await act(async () => {
      if (outcome === 'success') resolveInvite({ code: 'PRIVATE1' });
      else rejectInvite(new NuniError(503, 'UPSTREAM_UNAVAILABLE'));
    });
    expect(screen.queryByText('PRIVATE1')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('hides the previous invite code when the owner role is removed', async () => {
  mocks.search = 'invite=PRIVATE1';
  window.history.replaceState({}, '', `${mocks.pathname}?${mocks.search}&view=assignments`);
  render(<NuniApp />);
  await screen.findByText('PRIVATE1');
  memberRole = 'co-teacher';
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  await waitFor(() => expect(screen.queryByText('PRIVATE1')).toBeNull());
  expect(screen.queryByRole('button', { name: '產生邀請碼' })).toBeNull();
});

it('withholds learning metrics and receipt time when only the parent assignment refresh fails', async () => {
  memberRole = 'student';
  let assignmentsFailed = false;
  mocks.request.mockImplementation(async (path: string) => {
    if (path === `class-workspaces/${workspaceId}`) return { id: workspaceId, title: '設計專題', state: 'active', memberRole };
    if (path.endsWith('/assignments')) {
      if (assignmentsFailed) throw new NuniError(500, 'TEMPORARY');
      return { assignments: [] };
    }
    if (path.endsWith('/units')) return { units: [] };
    if (path.endsWith('/materials/page')) return { materials: [], nextCursor: null };
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    return {};
  });
  render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  fireEvent.click(screen.getByRole('tab', { name: '學習路徑' }));
  await screen.findByText('已繳交或作答');
  assignmentsFailed = true;
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  await screen.findByText(/已保留目前內容/);
  await screen.findByText(/進度未知：清單未齊/);
  expect(screen.queryByText('已繳交或作答')).toBeNull();
  expect(screen.getByText(/來源：nuni 課程 · 本次讀取：尚未確認/)).toBeTruthy();
  assignmentsFailed = false;
  fireEvent.click(screen.getByRole('button', { name: '更新內容' }));
  await screen.findByText('已繳交或作答');
});

it('離開作業分頁停止自動作業讀取，回作業才補讀', async () => {
  const view = render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  fireEvent.click(screen.getByRole('tab', { name: '作業' }));
  await act(async () => {});
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('tab', { name: '教材' }));
    await act(async () => {});
    const before = mocks.request.mock.calls.filter(([path]) => path.endsWith('/assignments')).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(mocks.request.mock.calls.filter(([path]) => path.endsWith('/assignments'))).toHaveLength(before);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '作業' })); });
    expect(mocks.request.mock.calls.filter(([path]) => path.endsWith('/assignments'))).toHaveLength(before + 1);
    view.unmount();
  } finally { vi.useRealTimers(); }
});

it('合成發布經共用寫入與輪詢後五秒內出現在學生畫面', async () => {
  memberRole = 'student';
  const original = mocks.request.getMockImplementation()!;
  let assignments: unknown[] = [];
  mocks.request.mockImplementation(async (path: string, context: string, input?: Record<string, unknown>) => {
    if (!path.endsWith('/assignments')) return original(path, context, input);
    await new Promise((resolve) => setTimeout(resolve, input ? 200 : 300));
    if (!input) return { assignments };
    const item = { ...input, id: 'cwa_22222222-2222-4222-8222-222222222222', workspaceId,
      state: 'open', createdAt: '2026-01-01T00:00:00.000Z', closedAt: null,
      unitId: null, unitTitle: null, submissionCount: 0, mySubmission: null };
    assignments = [item];
    return item;
  });
  const view = render(<NuniApp />);
  await screen.findByRole('heading', { name: '設計專題' });
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('tab', { name: '作業' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    const { createNuniClasses } = await import('@campus/shared/src/nuni');
    const teacher = createNuniClasses((path, input) => mocks.request(path, 'teacher', input), principalId);
    const started = Date.now();
    const write = teacher.createAssignment(workspaceId, { title: '跨端新發布作業', instructions: '合成內容',
      dueAt: null, idempotencyKey: 'synthetic-publication' });
    for (let elapsed = 0; elapsed < 5000 && screen.queryAllByRole('link', { name: /跨端新發布作業/ }).length === 0; elapsed += 50)
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await write;
    expect(within(screen.getByRole('navigation', { name: '跳到作業' })).getByRole('link', { name: /跨端新發布作業/ })).toBeTruthy();
    expect(Date.now() - started).toBeLessThanOrEqual(5000);
    expect(Date.now() - started).toBe(2800);
  } finally { view.unmount(); vi.useRealTimers(); }
});
