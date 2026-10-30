import { act, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import HomePage from './page';
import { loadHomeData, type HomeData } from '@/lib/homeOverview';
import { loadNuniHomeData } from '@/lib/nuniHomeOverview';
import { NuniError } from '@campus/shared/src/nuni';
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
  return { ...actual, loadNuniHomeData: vi.fn(), loadNuniHomeMaterials: vi.fn() };
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
  vi.mocked(loadHomeData).mockReset();
  vi.mocked(loadNuniHomeData).mockReset();
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

it('clears visible school account data and ignores an old response after account switching', async () => {
  let finishAlice!: (value: HomeData) => void;
  let finishBob!: (value: HomeData) => void;
  vi.mocked(loadHomeData).mockImplementation(
    (uid) =>
      new Promise((resolve) => {
        if (uid === 'alice') finishAlice = resolve;
        else finishBob = resolve;
      }),
  );
  const view = render(<HomePage />);
  await waitFor(() => expect(loadHomeData).toHaveBeenCalledWith('alice'));
  expect(screen.queryByRole('region', { name: /修習課程/ })).toBeNull();
  state.uid = 'bob';
  view.rerender(<HomePage />);
  await waitFor(() => expect(loadHomeData).toHaveBeenCalledWith('bob'));
  await act(async () => finishAlice(data('Alice private course')));
  expect(screen.queryByText('Alice private course 作業')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Alice private course' })).toBeNull();
  await act(async () => finishBob(data('Bob course')));
  expect(screen.getAllByText('Bob course 作業').length).toBeGreaterThan(0);
  expect(screen.getByRole('heading', { name: 'Bob course' })).toBeTruthy();
  state.uid = null;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Bob course 作業')).toBeNull();
  expect(screen.queryByRole('region', { name: /修習課程/ })).toBeNull();
  expect(screen.getAllByText(TODAY_COPY.unsigned).length).toBeGreaterThan(0);
});

it('does not report an empty course list as success after a failed load', async () => {
  vi.mocked(loadHomeData).mockRejectedValue(new Error('permission-denied'));
  render(<HomePage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(screen.queryByRole('heading', { name: SENSE_SECTION_TITLE })).toBeNull();
  expect(screen.queryByRole('region', { name: /修習課程/ })).toBeNull();
});

it('keeps every enrolled course reachable when there are no classes or pending tasks today', async () => {
  vi.mocked(loadHomeData).mockResolvedValue({
    courses: [
      { id: '資料 結構', name: '資料結構', role: 'member', unreadCount: 0 },
      { id: 'database', name: '資料庫系統', role: 'member', unreadCount: 2 },
    ],
    tasks: [],
    unreadCount: 2,
  });
  render(<HomePage />);
  const courses = await screen.findByRole('region', { name: /修習課程 2/ });
  expect(courses.id).toBe('courses');
  expect(
    within(courses)
      .getByRole('link', { name: /資料結構/ })
      .getAttribute('href'),
  ).toBe(`/course/${encodeURIComponent('資料 結構')}`);
  expect(
    within(courses)
      .getByRole('link', { name: /資料庫系統/ })
      .getAttribute('href'),
  ).toBe('/course/database');
  expect(within(courses).getByText('2 則新動態')).toBeTruthy();
  expect(within(courses).getByRole('link', { name: '查看全部課程 →' }).getAttribute('href')).toBe(
    '/groups',
  );
  expect(screen.getByTestId('student-today')).toBeTruthy();
  expect(screen.getByText(TODAY_COPY.noTimetable)).toBeTruthy();
});

it('preserves platform course destinations and offers the archived course directory', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  const coursePath = '/classroom/course/cw_design?view=materials';
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    courses: [
      { id: 'cw_design', name: '視覺設計', role: 'student', unreadCount: 0, href: coursePath },
    ],
    tasks: [],
    unreadCount: 0,
    archivedCount: 3,
  });
  render(<HomePage />);
  const courses = await screen.findByRole('region', { name: /修習課程 1/ });
  expect(
    within(courses)
      .getByRole('link', { name: /視覺設計/ })
      .getAttribute('href'),
  ).toBe(coursePath);
  expect(within(courses).getByRole('link', { name: '查看全部課程 →' }).getAttribute('href')).toBe(
    '/classroom',
  );
  expect(screen.getByText(/另有 3 門已封存課程/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '課程空間' }).getAttribute('href')).toBe(
    '/classroom?courses=archived',
  );
  expect(loadHomeData).not.toHaveBeenCalled();
});

it('shows archived-only courses without presenting them as current enrolments', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    courses: [],
    tasks: [],
    unreadCount: 0,
    archivedCount: 2,
  });
  render(<HomePage />);
  expect(await screen.findByText(/另有 2 門已封存課程/)).toBeTruthy();
  const courses = screen.getByRole('region', { name: /修習課程 0/ });
  expect(courses.id).toBe('courses');
  expect(within(courses).getByText('目前沒有修習中的課程。')).toBeTruthy();
  expect(within(courses).getByRole('link', { name: '查看全部課程 →' }).getAttribute('href')).toBe(
    '/classroom',
  );
  expect(screen.getByRole('link', { name: '課程空間' }).getAttribute('href')).toBe(
    '/classroom?courses=archived',
  );
});

it('uses the Nuni account for home and links directly to pending work', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
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
  vi.mocked(loadNuniHomeData).mockResolvedValue({
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

it('keeps enrolled courses and teaching courses in their respective sections', async () => {
  state.session = { context: 'session-a', platformAccountId: 'teacher-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
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
  const studying = screen.getByRole('region', { name: /修習課程 1/ });
  const teaching = screen.getByRole('region', { name: /授課與協作 1/ });
  expect(within(studying).getByRole('heading', { name: '教育心理學' })).toBeTruthy();
  expect(within(studying).queryByRole('heading', { name: '教學實習' })).toBeNull();
  expect(within(teaching).getByRole('heading', { name: '教學實習' })).toBeTruthy();
  expect(within(teaching).queryByRole('heading', { name: '教育心理學' })).toBeNull();
});

it('does not tell a teacher they have no homework and opens the teaching course list', async () => {
  state.session = { context: 'session-a', platformAccountId: 'teacher-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
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
  const courses = screen.getByRole('region', { name: /修習課程 0/ });
  expect(courses.id).toBe('courses');
  expect(within(courses).getByText('目前沒有修習中的課程。')).toBeTruthy();
  expect(within(courses).getByRole('link', { name: '查看全部課程 →' }).getAttribute('href')).toBe(
    '/classroom',
  );
  expect(
    within(screen.getByRole('region', { name: /授課與協作/ })).getByRole('heading', {
      name: '教學實習',
    }),
  ).toBeTruthy();
});

it('hides all previous Nuni data immediately during session revalidation and ignores a previous context response', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  let finishNew!: (value: HomeData) => void;
  vi.mocked(loadNuniHomeData)
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
  expect(screen.queryByRole('region', { name: /修習課程/ })).toBeNull();
  state.session = { context: 'session-b', platformAccountId: 'student-b' };
  state.sessionLoading = false;
  view.rerender(<HomePage />);
  await waitFor(() => expect(loadNuniHomeData).toHaveBeenCalledTimes(2));
  await act(async () => finishNew(data('Bob course')));
  expect(screen.getAllByText('Bob course 作業').length).toBeGreaterThan(0);
  state.pendingLogout = true;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Bob course 作業')).toBeNull();
  expect(screen.queryByRole('region', { name: /修習課程/ })).toBeNull();
});

it('removes a loaded overview when refreshing discovers revoked access', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData)
    .mockResolvedValueOnce(data('Private course'))
    .mockRejectedValueOnce(new NuniError(403, 'ACCESS_DENIED'));
  render(<HomePage />);
  expect((await screen.findAllByText('Private course 作業')).length).toBeGreaterThan(0);
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Private course 作業')).toBeNull();
  expect(screen.queryByRole('region', { name: /修習課程/ })).toBeNull();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
});

it('keeps confirmed work visible while the same account refreshes in the background', async () => {
  let finishRefresh!: (value: HomeData) => void;
  vi.mocked(loadHomeData)
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
  expect(loadHomeData).toHaveBeenCalledTimes(2);
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
  expect(loadNuniHomeData).not.toHaveBeenCalled();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(screen.queryByRole('heading', { name: SENSE_SECTION_TITLE })).toBeNull();
  expect(screen.queryByRole('region', { name: /修習課程/ })).toBeNull();
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
  vi.mocked(loadNuniHomeData).mockRejectedValueOnce(new NuniError(409, 'SESSION_CHANGED'));
  const view = render(<HomePage />);
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  vi.mocked(loadNuniHomeData).mockResolvedValueOnce(data('New account course'));
  state.session = { context: 'renewed', platformAccountId: 'student-b' };
  view.rerender(<HomePage />);
  await screen.findAllByText('New account course 作業');
  expect(loadNuniHomeData).toHaveBeenLastCalledWith(expect.any(Function), 'student-b');
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

it('keeps the course directory reachable after confirming an empty list without claiming all homework is done', async () => {
  let finish!: (value: HomeData) => void;
  vi.mocked(loadHomeData).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<HomePage />);
  await waitFor(() => expect(loadHomeData).toHaveBeenCalledWith('alice'));
  expect(screen.queryByText('目前沒有修習中的課程。')).toBeNull();
  expect(screen.queryByRole('region', { name: /修習課程/ })).toBeNull();
  await act(async () =>
    finish({
      courses: [],
      tasks: [],
      unreadCount: 0,
    }),
  );
  expect(await screen.findByText(TODAY_COPY.lmsUnconnected)).toBeTruthy();
  expect(screen.queryByText('目前沒有待繳作業。')).toBeNull();
  const courses = screen.getByRole('region', { name: /修習課程 0/ });
  expect(courses.id).toBe('courses');
  expect(within(courses).getByText('目前沒有修習中的課程。')).toBeTruthy();
  expect(within(courses).getByRole('link', { name: '查看全部課程 →' }).getAttribute('href')).toBe(
    '/groups',
  );
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
  vi.mocked(loadNuniHomeData).mockResolvedValue({
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
