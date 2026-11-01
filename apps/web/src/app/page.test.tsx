import { act, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import HomePage from './page';
import { loadHomeData, type HomeData } from '@/lib/homeOverview';
import { loadNuniHomeSections } from '@/lib/nuniHomeOverview';
import { FirebaseError } from 'firebase/app';
import { NuniError } from '@campus/shared/src/nuni';
import * as nuniMessages from '@campus/shared/src/nuni';
import { IDENTITY_LOOKUP_FAILED_COPY, IDENTITY_LOOKUP_FAILED_HINT } from '@/lib/accountIdentity';
import { TODAY_COPY } from '@campus/shared/src/pickNextAction';
import { SENSE_EMPTY_TEXT, SENSE_SECTION_TITLE } from '@campus/shared/src/todaySense';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  selectedSchoolId: 'pu' as string | null,
  schoolRole: null as string | null,
  schoolRoleCalls: [] as Array<[string | null | undefined, string]>,
  session: null as null | { context: string; platformAccountId: string },
  sessionLoading: false,
  sessionError: '',
  pendingLogout: false,
  refresh: vi.fn(),
  request: vi.fn(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    return {};
  }),
  timetable: {
    schoolId: 'pu',
    loaded: true,
    error: '',
    imported: { records: [] as unknown[] },
    manual: [] as unknown[],
    retry: vi.fn(),
  },
  importScope: {
    loading: false,
    scope: { owner: 'school:alice', schoolId: 'pu' },
    scopeKey: 'school:alice:pu',
  },
}));

vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/lib/usePersonalTodayRecords', () => ({
  usePersonalTodayRecords: () => state.timetable,
}));
vi.mock('@/lib/usePersonalImports', async (original) => {
  const actual = await original<typeof import('@/lib/usePersonalImports')>();
  return {
    ...actual,
    usePersonalImportScope: () => state.importScope,
  };
});
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: state.session,
    loading: state.sessionLoading,
    error: state.sessionError,
    pendingLogout: state.pendingLogout,
    logout: vi.fn(),
    refresh: state.refresh,
  }),
  browserRequest: (path: string) => state.request(path),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({
    user: state.uid ? { uid: state.uid } : null,
    loading: false,
    signOutUser: vi.fn(),
  }),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({ selectedSchoolId: state.selectedSchoolId, loading: false }),
}));
vi.mock('@/lib/useSchoolRole', async (original) => {
  const actual = await original<typeof import('@/lib/useSchoolRole')>();
  return {
    ...actual,
    useSchoolRole: (uid: string | null | undefined, schoolId: string) => {
      state.schoolRoleCalls.push([uid, schoolId]);
      return state.schoolRole;
    },
  };
});
vi.mock('@/lib/homeOverview', async (original) => {
  const actual = await original<typeof import('@/lib/homeOverview')>();
  return { ...actual, loadHomeData: vi.fn() };
});
vi.mock('@/lib/nuniHomeOverview', async (original) => {
  const actual = await original<typeof import('@/lib/nuniHomeOverview')>();
  return { ...actual, loadNuniHomeSections: vi.fn(), loadNuniHomeMaterials: vi.fn() };
});

const data = (name: string, extra: Partial<HomeData> = {}): HomeData => ({
  courses: [{ id: name, name, role: 'member', unreadCount: 0 }],
  tasks: extra.tasks ?? [
    {
      id: 'hw-1',
      courseId: name,
      courseName: name,
      title: `${name} 作業`,
      dueAt: '2099-01-02T12:30:00Z',
    },
  ],
  unreadCount: 0,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadHomeData).mockReset().mockResolvedValue({ courses: [], tasks: [], unreadCount: 0 });
  vi.mocked(loadNuniHomeSections).mockReset();
  window.scrollTo = vi.fn();
  state.uid = 'alice';
  state.selectedSchoolId = 'pu';
  state.schoolRole = null;
  state.schoolRoleCalls = [];
  state.session = null;
  state.sessionLoading = false;
  state.sessionError = '';
  state.pendingLogout = false;
  state.timetable = {
    schoolId: 'pu',
    loaded: true,
    error: '',
    imported: { records: [] },
    manual: [],
    retry: vi.fn(),
  };
  state.importScope = {
    loading: false,
    scope: { owner: 'school:alice', schoolId: 'pu' },
    scopeKey: 'school:alice:pu',
  };
  state.request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    return {};
  });
});

it('keeps Firebase tasks and published feedback available alongside the nuni entry', async () => {
  vi.mocked(loadHomeData).mockResolvedValue(
    data('Firebase 課程', {
      recentFeedback: [
        {
          kind: 'assignment',
          id: 'reviewed',
          courseId: 'firebase',
          courseName: 'Firebase 課程',
          title: '已批改作業',
          feedback: '分析完整',
          score: 92,
          reviewedAt: '2026-10-01T00:00:00Z',
          href: '/course/firebase#assignment-reviewed',
        },
      ],
    }),
  );
  render(<HomePage />);
  expect((await screen.findAllByText('Firebase 課程 作業')).length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: /分析完整/ }).getAttribute('href')).toBe(
    '/course/firebase#assignment-reviewed',
  );
  expect(await screen.findByText(/E 校園與 TronClass 的學校來源已停用/)).toBeTruthy();
  expect(loadHomeData).toHaveBeenCalledWith('alice');
  expect(screen.getByRole('link', { name: '前往 nuni 課程' }).getAttribute('href')).toBe(
    '/classroom',
  );
});

it('does not report an empty course list as success after a failed load', async () => {
  state.session = { context: 'test', platformAccountId: 'student' };
  vi.mocked(loadNuniHomeSections).mockRejectedValue(new Error('permission-denied'));
  render(<HomePage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(screen.queryByRole('heading', { name: SENSE_SECTION_TITLE })).toBeNull();
});

it('uses the Nuni account for home and links directly to pending work', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeSections).mockResolvedValue({
    ...data('視覺設計'),
    tasks: [
      {
        id: 'draft',
        courseId: 'design',
        courseName: '視覺設計',
        title: '週五提案',
        dueAt: '2020-01-02T12:30:00Z',
        acceptsLate: true,
        href: '/classroom/course/design#assignment-draft',
      },
    ],
  });
  render(<HomePage />);
  expect(await screen.findByRole('heading', { name: '我的身分' })).toBeTruthy();
  const taskLinks = await screen.findAllByRole('link', { name: /週五提案/ });
  expect(
    taskLinks.some(
      (link) => link.getAttribute('href') === '/classroom/course/design#assignment-draft',
    ),
  ).toBe(true);
  expect(loadHomeData).not.toHaveBeenCalled();
  expect(screen.getAllByText(/已逾期 \d+ 天/).length).toBeGreaterThan(0);
});

it('uses the same identity lookup copy as the account page when the lookup fails', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeSections).mockResolvedValue({
    courses: [],
    tasks: [],
    unreadCount: 0,
  });
  state.request.mockImplementation(async () => {
    throw new Error('offline');
  });
  render(<HomePage />);
  expect(await screen.findByText(IDENTITY_LOOKUP_FAILED_COPY)).toBeTruthy();
  expect(screen.getByText(IDENTITY_LOOKUP_FAILED_HINT)).toBeTruthy();
  expect(screen.getByRole('button', { name: '再試一次' })).toBeTruthy();
});

it('keeps teaching courses on today and no longer lists studying courses as a grid', async () => {
  state.session = { context: 'session-a', platformAccountId: 'teacher-a' };
  vi.mocked(loadNuniHomeSections).mockResolvedValue({
    courses: [
      { id: 'teach', name: '教學實習', role: 'co-teacher', unreadCount: 0 },
      { id: 'learn', name: '教育心理學', role: 'student', unreadCount: 0 },
    ],
    tasks: [],
    unreadCount: 0,
  });
  render(<HomePage />);
  expect(await screen.findByRole('heading', { name: /授課與協作/ })).toBeTruthy();
  expect(screen.getByText('協同教師')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /修習課程/ })).toBeNull();
});

it('does not tell a teacher they have no homework and opens the teaching course list', async () => {
  state.session = { context: 'session-a', platformAccountId: 'teacher-a' };
  vi.mocked(loadNuniHomeSections).mockResolvedValue({
    courses: [{ id: 'teach', name: '教學實習', role: 'owner-teacher', unreadCount: 0 }],
    tasks: [],
    unreadCount: 0,
  });
  render(<HomePage />);
  expect(await screen.findByRole('link', { name: /查看授課課程/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /查看授課課程/ }).getAttribute('href')).toBe(
    '#teaching-courses',
  );
  expect(screen.queryByRole('heading', { name: /待繳作業/ })).toBeNull();
});

it('hides all previous Nuni data immediately during session revalidation and ignores a previous context response', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  let finishNew!: (value: HomeData) => void;
  vi.mocked(loadNuniHomeSections)
    .mockResolvedValueOnce(data('Alice private course'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
  const view = render(<HomePage />);
  expect((await screen.findAllByText('Alice private course 作業')).length).toBeGreaterThan(0);
  state.sessionLoading = true;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Alice private course 作業')).toBeNull();
  state.session = { context: 'session-b', platformAccountId: 'student-b' };
  state.sessionLoading = false;
  view.rerender(<HomePage />);
  await waitFor(() => expect(loadNuniHomeSections).toHaveBeenCalledTimes(2));
  await act(async () => finishNew(data('Bob course')));
  expect(screen.getAllByText('Bob course 作業').length).toBeGreaterThan(0);
  state.pendingLogout = true;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Bob course 作業')).toBeNull();
});

it('removes a loaded overview when refreshing discovers revoked access', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeSections)
    .mockResolvedValueOnce(data('Private course'))
    .mockRejectedValueOnce(new NuniError(403, 'ACCESS_DENIED'));
  render(<HomePage />);
  expect((await screen.findAllByText('Private course 作業')).length).toBeGreaterThan(0);
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Private course 作業')).toBeNull();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
});

it('keeps confirmed work visible while the same account refreshes in the background', async () => {
  let finishRefresh!: (value: HomeData) => void;
  state.session = { context: 'test', platformAccountId: 'student' };
  vi.mocked(loadNuniHomeSections)
    .mockResolvedValueOnce(data('資料結構'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
  render(<HomePage />);
  expect((await screen.findAllByText('資料結構 作業')).length).toBeGreaterThan(0);
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(loadNuniHomeSections).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('資料結構 作業').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('today-skeleton')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('正在更新課程待辦…');
  await act(async () => finishRefresh(data('新作業')));
  expect(screen.getAllByText('新作業 作業').length).toBeGreaterThan(0);
  await waitFor(() => expect(screen.queryByText('資料結構 作業')).toBeNull());
  expect(screen.queryByText('正在更新課程待辦…')).toBeNull();
});

it('keeps the session error visible when the course session is unavailable', () => {
  state.uid = null;
  state.sessionError = '無法確認登入狀態';
  render(<HomePage />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText('無法確認登入狀態')).toBeTruthy();
});

it('lets a guest browse before signing in and never loads personal courses', () => {
  state.uid = null;
  render(<HomePage />);
  expect(screen.getAllByText(TODAY_COPY.unsigned).length).toBeGreaterThan(0);
  expect(loadHomeData).not.toHaveBeenCalled();
  expect(loadNuniHomeSections).not.toHaveBeenCalled();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(screen.queryByRole('heading', { name: SENSE_SECTION_TITLE })).toBeNull();
});

it('keeps all-campuses navigation out of the private personal-storage namespace', () => {
  state.uid = null;
  state.selectedSchoolId = null;
  state.timetable.schoolId = 'personal';
  state.importScope = {
    loading: false,
    scope: { owner: 'guest', schoolId: 'personal' },
    scopeKey: 'guest:personal',
  };
  render(<HomePage />);
  const destinations = screen
    .getAllByRole('link')
    .map((link) => new URL(link.getAttribute('href')!, 'https://campus.example'));
  for (const destination of destinations) {
    expect(destination.searchParams.get('campus')).not.toBe('personal');
  }
  const map = destinations.find((destination) => destination.pathname === '/map');
  expect(map?.searchParams.get('campus')).toBe('all');
  const timetable = destinations.find((destination) => destination.pathname === '/timetable');
  expect(timetable?.searchParams.get('campus')).toBe('all');
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
});

it.each([
  ['grades', 'pu'],
  ['events', 'pu'],
  ['timetable', 'nthu'],
])(
  'does not treat imported %s records from %s as the current campus timetable',
  (kind, schoolId) => {
    state.uid = null;
    state.timetable.imported.records = [
      {
        id: 'record-1',
        kind,
        schoolId,
        title: '另一份資料',
        academicYear: '115',
        semester: '1',
      },
    ];
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: '先把課表放進來。' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '課表準備好了。' })).toBeNull();
    expect(screen.getByText(TODAY_COPY.noTimetable)).toBeTruthy();
  },
);

it('revalidates an expired course session before retrying with the new account context', async () => {
  state.uid = null;
  state.session = { context: 'expired', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeSections).mockRejectedValueOnce(new NuniError(409, 'SESSION_CHANGED'));
  const view = render(<HomePage />);
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  vi.mocked(loadNuniHomeSections).mockResolvedValueOnce(data('New account course'));
  state.session = { context: 'renewed', platformAccountId: 'student-b' };
  view.rerender(<HomePage />);
  await screen.findAllByText('New account course 作業');
  expect(loadNuniHomeSections).toHaveBeenLastCalledWith(
    expect.any(Function),
    'student-b',
    expect.any(Function),
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('looks up the school role from the selected school instead of always using pu', async () => {
  state.selectedSchoolId = 'nthu';
  state.schoolRole = 'teacher';
  vi.mocked(loadHomeData).mockResolvedValue(data('資料結構', { tasks: [] }));
  const view = render(<HomePage />);
  expect(state.schoolRoleCalls.some((call) => call[0] === 'alice' && call[1] === 'nthu')).toBe(
    true,
  );
  expect(await screen.findByRole('link', { name: /老師工作台/ })).toBeTruthy();
  state.selectedSchoolId = 'ncku';
  state.schoolRole = null;
  view.rerender(<HomePage />);
  expect(state.schoolRoleCalls.some((call) => call[0] === 'alice' && call[1] === 'ncku')).toBe(
    true,
  );
  expect(screen.queryByRole('link', { name: /老師工作台/ })).toBeNull();
  state.selectedSchoolId = null;
  view.rerender(<HomePage />);
  expect(state.schoolRoleCalls.some((call) => call[0] === 'alice' && call[1] === 'pu')).toBe(true);
});

it('shows the LMS-unconnected sentence instead of pretending there is no homework', async () => {
  vi.mocked(loadHomeData).mockResolvedValue({
    courses: [],
    tasks: [],
    unreadCount: 0,
  });
  render(<HomePage />);
  expect(await screen.findByText(/還沒有 nuni 課程資料/)).toBeTruthy();
  expect(screen.queryByText('目前沒有待繳作業。')).toBeNull();
});

it('does not keep weather, grade summary, recommendation or shortcut grids on today', async () => {
  vi.mocked(loadHomeData).mockResolvedValue(data('資料結構', { tasks: [] }));
  render(<HomePage />);
  expect(await screen.findByTestId('student-today')).toBeTruthy();
  expect(screen.queryByText(/為你推薦|智慧|AI 幫你/)).toBeNull();
  expect(screen.queryByRole('heading', { name: /課業成績/ })).toBeNull();
  expect(screen.queryByTestId('home-bus-entry')).toBeNull();
  expect(screen.queryByRole('heading', { name: SENSE_SECTION_TITLE })).toBeNull();
});

it('hydrates the signed-in home page against the server loading markup', async () => {
  state.uid = null;
  state.session = null;
  state.sessionLoading = true;
  const courseId = 'cw_11111111-1111-4111-8111-111111111111';
  vi.mocked(loadNuniHomeSections).mockResolvedValue({
    ...data('資料庫系統'),
    courses: [
      {
        id: courseId,
        name: '資料庫系統',
        role: 'student',
        unreadCount: 0,
        href: `/classroom/course/${courseId}`,
      },
    ],
    tasks: [
      {
        id: 'hw-1',
        courseId,
        courseName: '資料庫系統',
        title: '資料庫系統 作業',
        dueAt: '2099-01-02T12:30:00Z',
      },
    ],
  });
  const app = <HomePage />;
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container.querySelector('[data-testid="today-skeleton"]')).toBeTruthy();
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  state.sessionLoading = false;
  const onRecoverableError = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, app, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect((await screen.findAllByText('資料庫系統 作業')).length).toBeGreaterThan(0);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});

it('shows confirmed work and retry together when another source failed', async () => {
  state.session = { context: 'test', platformAccountId: 'student' };
  vi.mocked(loadNuniHomeSections).mockResolvedValue(
    data('已載入課程', { tasksError: '部分測驗還沒讀到' }),
  );
  render(<HomePage />);
  expect(await screen.findByText('部分測驗還沒讀到')).toBeTruthy();
  expect(screen.getAllByText('已載入課程 作業').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: TODAY_COPY.retry })).toBeTruthy();
});

it('offers course joining for a verified empty nuni account', async () => {
  state.session = { context: 'test', platformAccountId: 'student' };
  vi.mocked(loadNuniHomeSections).mockResolvedValue({ courses: [], tasks: [], unreadCount: 0 });
  render(<HomePage />);
  expect(await screen.findByText(/還沒有 nuni 課程資料/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '加入課程' }).getAttribute('href')).toBe('/classroom');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps Firebase work when nuni is also signed in and hides it on Firebase account change', async () => {
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeSections).mockResolvedValue(data('nuni 課程'));
  vi.mocked(loadHomeData)
    .mockResolvedValueOnce(data('Firebase 私人課程'))
    .mockImplementationOnce(() => new Promise(() => {}));
  const view = render(<HomePage />);
  expect((await screen.findAllByText('Firebase 私人課程 作業')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('nuni 課程 作業').length).toBeGreaterThan(0);
  state.uid = 'bob';
  view.rerender(<HomePage />);
  expect(screen.queryByText('Firebase 私人課程 作業')).toBeNull();
  await waitFor(() => expect(loadHomeData).toHaveBeenLastCalledWith('bob'));
});

it('retains Firebase tasks and revalidates an expired nuni session', async () => {
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeSections).mockRejectedValue(new NuniError(401, 'SESSION_CHANGED'));
  vi.mocked(loadHomeData).mockResolvedValue(data('Firebase 課程'));
  render(<HomePage />);
  expect((await screen.findAllByText('Firebase 課程 作業')).length).toBeGreaterThan(0);
  expect(state.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByText('部分課程資料尚未讀到，請重試。')).toBeTruthy();
});

it('budgets first available work at 100ms with a 2000ms second source and two overview loads', async () => {
  state.session = { context: 'test', platformAccountId: 'student' };
  vi.useFakeTimers();
  vi.mocked(loadNuniHomeSections).mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(data('快速來源')), 100);
      }),
  );
  vi.mocked(loadHomeData).mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(data('慢速來源')), 2000);
      }),
  );
  try {
    render(<HomePage />);
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(screen.getAllByText('快速來源 作業').length).toBeGreaterThan(0);
    expect(screen.queryByText('慢速來源 作業')).toBeNull();
    expect(screen.queryByRole('button', { name: TODAY_COPY.retry })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(loadNuniHomeSections).toHaveBeenCalledTimes(1);
    expect(loadHomeData).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1900));
    expect(screen.getAllByText('慢速來源 作業').length).toBeGreaterThan(0);
  } finally {
    vi.useRealTimers();
  }
});

it('retries only the failed source while keeping successful work visible', async () => {
  state.session = { context: 'test', platformAccountId: 'student' };
  vi.mocked(loadNuniHomeSections).mockResolvedValue(data('保留的課程'));
  vi.mocked(loadHomeData)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(data('重試課程'));
  render(<HomePage />);
  const retry = await screen.findByRole('button', { name: '重試校園課程' });
  await act(async () => retry.click());
  expect((await screen.findAllByText('重試課程 作業')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('保留的課程 作業').length).toBeGreaterThan(0);
  expect(loadNuniHomeSections).toHaveBeenCalledTimes(1);
  expect(loadHomeData).toHaveBeenCalledTimes(2);
});

it('offers separate retries when both sources fail', async () => {
  state.session = { context: 'test', platformAccountId: 'student' };
  vi.mocked(loadNuniHomeSections).mockRejectedValue(new Error('offline'));
  vi.mocked(loadHomeData).mockRejectedValue(new Error('offline'));
  render(<HomePage />);
  expect(await screen.findByRole('button', { name: '重試 nuni 課程' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: '重試校園課程' })).toBeTruthy();
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
});

it('publishes teaching navigation before work finishes and keeps the previous work during refresh', async () => {
  state.uid = null;
  state.session = { context: 'test', platformAccountId: 'teacher' };
  let finish!: (value: HomeData) => void;
  vi.mocked(loadNuniHomeSections).mockImplementation((_transport, _account, onCourses) => {
    onCourses({
      courses: [{ id: 'teach', name: '先到的授課', role: 'co-teacher', unreadCount: 0 }],
      tasks: [],
      unreadCount: 0,
    });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  render(<HomePage />);
  expect(await screen.findByRole('heading', { name: '先到的授課' })).toBeTruthy();
  expect(screen.getByText(/課程還在讀取/)).toBeTruthy();
  await act(async () => finish(data('完成來源')));
  expect(screen.getAllByText('完成來源 作業').length).toBeGreaterThan(0);
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(screen.getAllByText('完成來源 作業').length).toBeGreaterThan(0);
});

it('ignores late data and course callbacks after switching accounts', async () => {
  state.uid = null;
  state.session = { context: 'old', platformAccountId: 'old' };
  let finish!: (value: HomeData) => void;
  let publish!: (value: HomeData) => void;
  vi.mocked(loadNuniHomeSections)
    .mockImplementationOnce((_transport, _account, onCourses) => {
      publish = onCourses;
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValueOnce(data('新帳號'));
  const view = render(<HomePage />);
  state.session = { context: 'new', platformAccountId: 'new' };
  view.rerender(<HomePage />);
  await screen.findAllByText('新帳號 作業');
  await act(async () => {
    publish(data('舊帳號'));
    finish(data('舊帳號'));
  });
  expect(screen.queryByText('舊帳號 作業')).toBeNull();
  expect(screen.getAllByText('新帳號 作業').length).toBeGreaterThan(0);
});

it('keeps source containers and main order through delayed loads and background refresh', async () => {
  state.session = { context: 'test', platformAccountId: 'student' };
  let finishNuni!: (value: HomeData) => void;
  let finishSchool!: (value: HomeData) => void;
  vi.mocked(loadNuniHomeSections).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishNuni = resolve;
      }),
  );
  vi.mocked(loadHomeData).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSchool = resolve;
      }),
  );
  const view = render(<HomePage />);
  const main = view.container.querySelector('main')!;
  const children = Array.from(main.children);
  const slots = screen.getAllByRole('region', { name: /課程讀取狀態/ });
  const verify = () => {
    expect(main.children).toHaveLength(children.length);
    children.forEach((child, index) => expect(main.children[index]).toBe(child));
    const currentSlots = screen.getAllByRole('region', { name: /課程讀取狀態/ });
    expect(currentSlots).toHaveLength(slots.length);
    slots.forEach((slot, index) => expect(currentSlots[index]).toBe(slot));
  };
  await act(async () => finishNuni(data('快速來源')));
  verify();
  await act(async () => finishSchool(data('慢速來源')));
  verify();
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  verify();
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(loadNuniHomeSections).toHaveBeenCalledTimes(2);
  expect(loadHomeData).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishNuni(data('快速來源'));
    finishSchool(data('慢速來源'));
  });
  verify();
});

it.each(['failed', 'incomplete'])(
  'deduplicates repeated todo retries for a %s source',
  async (kind) => {
    state.session = { context: 'test', platformAccountId: 'student' };
    vi.mocked(loadHomeData).mockResolvedValue(data('成功來源'));
    let finish!: (value: HomeData) => void;
    if (kind === 'failed')
      vi.mocked(loadNuniHomeSections).mockRejectedValueOnce(new Error('offline'));
    else
      vi.mocked(loadNuniHomeSections).mockResolvedValueOnce(
        data('部分來源', { tasksError: '測驗讀取失敗' }),
      );
    vi.mocked(loadNuniHomeSections).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<HomePage />);
    const retry = await screen.findByRole('button', { name: TODAY_COPY.retry });
    await act(async () => {
      retry.click();
      retry.click();
      retry.click();
    });
    expect(loadNuniHomeSections).toHaveBeenCalledTimes(2);
    expect(loadHomeData).toHaveBeenCalledTimes(1);
    await act(async () => finish(data('恢復來源')));
    expect(screen.queryByRole('button', { name: TODAY_COPY.retry })).toBeNull();
  },
);

it('does not offer error retry while course callbacks have arrived but work is pending', async () => {
  state.session = { context: 'test', platformAccountId: 'student' };
  let finish!: (value: HomeData) => void;
  vi.mocked(loadNuniHomeSections).mockImplementation((_transport, _account, onCourses) => {
    onCourses(data('先到課程', { tasks: [] }));
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  vi.mocked(loadHomeData).mockImplementation(() => new Promise(() => {}));
  render(<HomePage />);
  expect(await screen.findByText(/nuni課程還在讀取/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: /再試一次|重試.*課程/ })).toBeNull();
  await act(async () => finish(data('先到課程')));
  expect(screen.queryByRole('button', { name: /再試一次|重試.*課程/ })).toBeNull();
});

it.each(['nuni', 'school'])(
  'waits for both sources when %s arrives first and recalculates after refresh',
  async (first) => {
    state.session = { context: 'test', platformAccountId: 'teacher' };
    let finishSchool!: (value: HomeData) => void;
    const teachingData = data('授課來源', {
      courses: [{ id: 'teach', name: '授課來源', role: 'owner-teacher', unreadCount: 0 }],
      tasks: [],
    });
    const fast = first === 'nuni' ? loadNuniHomeSections : loadHomeData;
    const slow = first === 'nuni' ? loadHomeData : loadNuniHomeSections;
    vi.mocked(fast).mockResolvedValue(teachingData);
    vi.mocked(slow).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSchool = resolve;
        }),
    );
    render(<HomePage />);
    await screen.findByRole('heading', { name: /授課與協作/ });
    expect(screen.queryByRole('link', { name: /查看授課課程/ })).toBeNull();
    await act(async () => finishSchool(data('學生來源')));
    const today = screen.getByTestId('student-today');
    expect(screen.queryByRole('link', { name: /查看授課課程/ })).toBeNull();
    await act(async () => window.dispatchEvent(new Event('pageshow')));
    expect(screen.getByTestId('student-today')).toBe(today);
    await act(async () => finishSchool({ courses: [], tasks: [], unreadCount: 0 }));
    expect(screen.queryByTestId('student-today')).toBeNull();
    expect(screen.getByRole('link', { name: /查看授課課程/ })).toBeTruthy();
  },
);

it('places long source messages and reachable retry controls after the primary content', async () => {
  state.session = { context: 'test', platformAccountId: 'student' };
  const message = 'LongUnbrokenError'.repeat(200);
  const formatMessage = vi.spyOn(nuniMessages, 'nuniErrorMessage').mockReturnValueOnce(message);
  vi.mocked(loadNuniHomeSections).mockRejectedValue(new NuniError(503, 'NETWORK_ERROR'));
  render(<HomePage />);
  const retry = await screen.findByRole('button', { name: /重試 nuni 課程/ });
  const statuses = screen.getByLabelText('課程來源狀態');
  expect(
    screen.getByTestId('student-today').compareDocumentPosition(statuses) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(retry.closest('section')?.textContent).toContain(message);
  formatMessage.mockRestore();
  expect(statuses.querySelector('[aria-hidden]')).toBeNull();
});

it.each(['dual', 'student', 'empty'])(
  'recalculates a teacher home after a completed %s background refresh',
  async (mode) => {
    const teaching = { id: 'teach', name: '原授課', role: 'owner-teacher', unreadCount: 0 };
    let finish!: (value: HomeData) => void;
    vi.mocked(loadHomeData)
      .mockResolvedValueOnce(data('原授課', { courses: [teaching], tasks: [] }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    render(<HomePage />);
    await screen.findByRole('link', { name: /查看授課課程/ });
    await act(async () => window.dispatchEvent(new Event('pageshow')));
    expect(screen.getByRole('link', { name: /查看授課課程/ })).toBeTruthy();
    const next =
      mode === 'empty'
        ? { courses: [], tasks: [], unreadCount: 0 }
        : data('新增修課', {
            courses: [
              ...(mode === 'dual' ? [teaching] : []),
              { id: 'study', name: '新增修課', role: 'student', unreadCount: 0 },
            ],
          });
    await act(async () => finish(next));
    expect(loadHomeData).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('student-today')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /查看授課課程/ })).toBeNull();
    expect(screen.queryByText('0 門課正在進行')).toBeNull();
    if (mode !== 'empty') expect(screen.getAllByText('新增修課 作業').length).toBeGreaterThan(0);
  },
);

it.each(['teacher', 'student'])(
  'retains previous %s data and mode when a background source fails',
  async (mode) => {
    const previous =
      mode === 'teacher'
        ? data('保留授課', {
            courses: [{ id: 'teach', name: '保留授課', role: 'owner-teacher', unreadCount: 0 }],
            tasks: [],
          })
        : data('保留修課');
    vi.mocked(loadHomeData)
      .mockResolvedValueOnce(previous)
      .mockRejectedValueOnce(new FirebaseError('unavailable', 'offline'));
    render(<HomePage />);
    if (mode === 'teacher') await screen.findByRole('link', { name: /查看授課課程/ });
    else await screen.findAllByText('保留修課 作業');
    await act(async () => window.dispatchEvent(new Event('pageshow')));
    expect(await screen.findByRole('button', { name: '重試校園課程' })).toBeTruthy();
    if (mode === 'teacher') {
      expect(screen.getByRole('heading', { name: '1 門課正在進行' })).toBeTruthy();
      expect(document.getElementById('teaching-courses')).toBeTruthy();
    } else expect(screen.getAllByText('保留修課 作業').length).toBeGreaterThan(0);
  },
);

it('keeps the teacher mode until both background sources finish, including course callbacks', async () => {
  state.session = { context: 'test', platformAccountId: 'teacher' };
  const teaching = data('授課', {
    courses: [{ id: 'teach', name: '授課', role: 'owner-teacher', unreadCount: 0 }],
    tasks: [],
  });
  let finish!: (value: HomeData) => void;
  vi.mocked(loadHomeData).mockResolvedValueOnce(teaching).mockResolvedValueOnce(data('新增修課'));
  vi.mocked(loadNuniHomeSections)
    .mockResolvedValueOnce({ courses: [], tasks: [], unreadCount: 0 })
    .mockImplementationOnce((_transport, _account, onCourses) => {
      onCourses(data('分批課程', { tasks: [] }));
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
  render(<HomePage />);
  await screen.findByRole('link', { name: /查看授課課程/ });
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(screen.getByRole('link', { name: /查看授課課程/ })).toBeTruthy();
  await act(async () => finish({ courses: [], tasks: [], unreadCount: 0 }));
  expect(screen.getByTestId('student-today')).toBeTruthy();
  expect(screen.getAllByText('新增修課 作業').length).toBeGreaterThan(0);
});

it.each([
  ['permission-denied', false],
  ['permission-denied', true],
  ['unauthenticated', true],
  ['invalid-argument', true],
])(
  'clears school data after %s (FirebaseError: %s) without hiding the other source',
  async (code, firebase) => {
    state.session = { context: 'test', platformAccountId: 'student' };
    vi.mocked(loadNuniHomeSections).mockResolvedValue(data('可用來源'));
    vi.mocked(loadHomeData)
      .mockResolvedValueOnce(
        data('已撤權課程', {
          recentFeedback: [
            {
              kind: 'assignment',
              id: 'reviewed',
              courseId: 'revoked',
              courseName: '已撤權課程',
              title: '撤權成績',
              feedback: '撤權評語',
              score: 92,
              reviewedAt: '2026-10-01T00:00:00Z',
              href: '/course/revoked',
            },
          ],
        }),
      )
      .mockRejectedValueOnce(
        firebase
          ? new FirebaseError(code, 'school read failed')
          : Object.assign(new Error('permission-denied'), { code }),
      );
    render(<HomePage />);
    expect((await screen.findAllByText('已撤權課程 作業')).length).toBeGreaterThan(0);
    expect(screen.getByText('成績：92')).toBeTruthy();
    expect(screen.getByText('老師評語：撤權評語')).toBeTruthy();
    await act(async () => window.dispatchEvent(new Event('pageshow')));
    await screen.findByRole('button', { name: '重試校園課程' });
    expect(screen.queryByText('已撤權課程 作業')).toBeNull();
    expect(screen.queryByText('已撤權課程')).toBeNull();
    expect(screen.queryByText('成績：92')).toBeNull();
    expect(screen.queryByText('老師評語：撤權評語')).toBeNull();
    expect(screen.getAllByText('可用來源 作業').length).toBeGreaterThan(0);
    if (code === 'permission-denied')
      expect(screen.getByText(/校園課程存取權限已失效/)).toBeTruthy();
    if (code === 'unauthenticated') expect(screen.getByText(/校園登入驗證已失效/)).toBeTruthy();
    expect(state.refresh).not.toHaveBeenCalled();
  },
);
