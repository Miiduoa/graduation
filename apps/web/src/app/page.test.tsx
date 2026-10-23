import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HomePage from './page';
import { loadHomeData, type HomeData } from '@/lib/homeOverview';
import { HOME_MATERIALS_UNAVAILABLE, loadNuniHomeData, loadNuniHomeMaterials } from '@/lib/nuniHomeOverview';
import { queryTransit } from '@/lib/transit';
import { NuniError } from '@campus/shared/src/nuni';
import { IDENTITY_LOOKUP_FAILED_COPY, IDENTITY_LOOKUP_FAILED_HINT } from '@/lib/accountIdentity';
import {
  applySenseAction,
  emptySenseState,
  makeSenseCardId,
  SENSE_EMPTY_TEXT,
  SENSE_HANDLE_PREVIEW,
  SENSE_SAVE_FAILED_TEXT,
  SENSE_SECTION_TITLE,
  SENSE_UNSIGNED_TEXT,
  senseStorageKey,
  serializeSenseState,
} from '@campus/shared/src/todaySense';
import { TODAY_WORK_EMPTY, TODAY_WORK_NO_CLASS, TODAY_WORK_UNSIGNED } from '@/lib/todayCourseWork';
const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  session: null as null | { context: string; platformAccountId: string },
  sessionLoading: false,
  sessionError: '',
  pendingLogout: false,
  nextClass: null as string | null,
  refresh: vi.fn(),
  request: vi.fn(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    if (path === 'merchant-applications') return { applications: [] };
    if (path === 'merchant-workspaces') return { workspaces: [] };
    return {};
  }),
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/components/timetable/TodayTimetable', () => ({
  TodayTimetable: () => <section aria-label="今天的課表">今天的課表</section>,
  NextClassCard: () =>
    state.nextClass ? <div data-testid="home-next-class">{state.nextClass}</div> : null,
}));
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
vi.mock('@/lib/homeOverview', async (original) => {
  const actual = await original<typeof import('@/lib/homeOverview')>();
  return { ...actual, loadHomeData: vi.fn() };
});
vi.mock('@/lib/nuniHomeOverview', async (original) => {
  const actual = await original<typeof import('@/lib/nuniHomeOverview')>();
  return { ...actual, loadNuniHomeData: vi.fn(), loadNuniHomeMaterials: vi.fn() };
});
vi.mock('@/lib/transit', async (original) => {
  const actual = await original<typeof import('@/lib/transit')>();
  return {
    ...actual,
    queryTransit: vi.fn(async () => ({
      status: 'unavailable' as const,
      reason: 'not-configured' as const,
    })),
  };
});
const data = (name: string): HomeData => ({
  courses: [{ id: name, name, role: 'member', unreadCount: 0 }],
  tasks: [],
  unreadCount: 0,
});
beforeEach(() => {
  vi.clearAllMocks();
  state.uid = 'alice';
  state.session = null;
  state.sessionLoading = false;
  state.sessionError = '';
  state.pendingLogout = false;
  state.nextClass = null;
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'unavailable',
    reason: 'not-configured',
  });
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
  state.uid = 'bob';
  view.rerender(<HomePage />);
  await waitFor(() => expect(loadHomeData).toHaveBeenCalledWith('bob'));
  await act(async () => finishAlice(data('Alice private course')));
  expect(screen.queryByText('Alice private course')).toBeNull();
  await act(async () => finishBob(data('Bob course')));
  expect(screen.getByText('Bob course')).toBeTruthy();
  state.uid = null;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Bob course')).toBeNull();
  expect(screen.getByRole('link', { name: /用 Google 帳號登入/ })).toBeTruthy();
});
it('does not report an empty course list as success after a failed load', async () => {
  vi.mocked(loadHomeData).mockRejectedValue(new Error('permission-denied'));
  render(<HomePage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('目前沒有待繳作業。')).toBeNull();
  expect(screen.queryByText(TODAY_WORK_EMPTY)).toBeNull();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(screen.queryByRole('heading', { name: SENSE_SECTION_TITLE })).toBeNull();
});
it('uses the Nuni account for home and links directly to pending work with its actual deadline and submission state', async () => {
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
  const taskLink = await screen.findByRole('link', { name: /週五提案/ });
  expect(taskLink.getAttribute('href')).toBe('/classroom/course/design#assignment-draft');
  expect(loadHomeData).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: /用 Google 帳號登入/ })).toBeNull();
  expect(screen.getAllByText('已過參考期限・仍可繳交')).toHaveLength(1);
  expect(screen.getAllByText(/1\/2 20:30/).length).toBeGreaterThanOrEqual(1);
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
it('keeps teaching and studying roles separate for the same account', async () => {
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
  expect(screen.getByRole('heading', { name: /修習課程/ })).toBeTruthy();
  expect(screen.getByText('協同教師')).toBeTruthy();
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
});
it('hides all previous Nuni data immediately during session revalidation and ignores a previous context response', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  let finishOld!: (value: HomeData) => void;
  let finishNew!: (value: HomeData) => void;
  vi.mocked(loadNuniHomeData)
    .mockResolvedValueOnce(data('Alice private course'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
  const view = render(<HomePage />);
  expect(await screen.findByText('Alice private course')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更新課程' }));
  state.sessionLoading = true;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Alice private course')).toBeNull();
  state.session = { context: 'session-b', platformAccountId: 'student-b' };
  state.sessionLoading = false;
  view.rerender(<HomePage />);
  await waitFor(() => expect(loadNuniHomeData).toHaveBeenCalledTimes(3));
  await act(async () => finishOld(data('Old response')));
  expect(screen.queryByText('Old response')).toBeNull();
  await act(async () => finishNew(data('Bob course')));
  expect(screen.getByText('Bob course')).toBeTruthy();
  state.pendingLogout = true;
  view.rerender(<HomePage />);
  expect(screen.queryByText('Bob course')).toBeNull();
});
it('removes a loaded overview when refreshing discovers revoked access', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData)
    .mockResolvedValueOnce(data('Private course'))
    .mockRejectedValueOnce(new NuniError(403, 'ACCESS_DENIED'));
  render(<HomePage />);
  expect(await screen.findByText('Private course')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更新課程' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Private course')).toBeNull();
  expect(screen.queryByText('目前沒有待繳作業。')).toBeNull();
  expect(screen.queryByText(TODAY_WORK_EMPTY)).toBeNull();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
});
it('keeps public campus entries usable when the course session is unavailable', () => {
  state.uid = null;
  state.sessionError = '無法確認登入狀態';
  render(<HomePage />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('link', { name: /校園地圖/ }).getAttribute('href')).toBe('/map');
  expect(screen.getByRole('link', { name: /公車資訊/ }).getAttribute('href')).toBe('/bus');
  expect(screen.getByRole('link', { name: /公開公告/ }).getAttribute('href')).toBe(
    '/announcements',
  );
  expect(screen.queryByRole('link', { name: /用 Google 帳號登入/ })).toBeNull();
});

it('lets a guest browse before signing in and never loads personal courses', () => {
  state.uid = null;
  render(<HomePage />);
  expect(screen.queryByTestId('home-bus-entry')).toBeNull();
  expect(screen.queryByTestId('home-next-class')).toBeNull();
  expect(screen.getByRole('link', { name: /公車資訊/ }).getAttribute('href')).toBe('/bus');
  expect(screen.queryByText('162、301、368、326')).toBeNull();
  expect(screen.getByRole('link', { name: '先瀏覽校園資訊' }).getAttribute('href')).toBe(
    '#public-services',
  );
  expect(screen.getByRole('region', { name: '校園生活' }).id).toBe('public-services');
  expect(screen.getByRole('link', { name: /校園地圖/ }).getAttribute('href')).toBe('/map');
  expect(screen.getByRole('link', { name: /公開公告/ }).getAttribute('href')).toBe(
    '/announcements',
  );
  expect(screen.getByRole('link', { name: /用 Google 帳號登入/ }).getAttribute('href')).toBe(
    '/classroom/login?returnUrl=%2F',
  );
  expect(loadHomeData).not.toHaveBeenCalled();
  expect(loadNuniHomeData).not.toHaveBeenCalled();
  expect(screen.getByText(TODAY_WORK_UNSIGNED)).toBeTruthy();
  expect(screen.getByText(SENSE_UNSIGNED_TEXT)).toBeTruthy();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(screen.queryByText(TODAY_WORK_EMPTY)).toBeNull();
});

it('shows the fastest campus-gate bus on one home row', async () => {
  state.uid = null;
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'ready',
    kind: 'arrivals',
    fetchedAt: now,
    arrivals: [
      {
        id: '162',
        route: '162',
        direction: 1,
        destination: '沙鹿火車站',
        status: 0,
        seconds: 180,
        updatedAt: now,
        stopName: '靜宜大學(英才路)',
      },
      {
        id: '301',
        route: '301',
        direction: 1,
        destination: '台中車站',
        status: 3,
        seconds: null,
        updatedAt: now,
        stopName: '靜宜大學(專用道)',
        scheduledAt: new Date(Date.now() + 12 * 60_000).toISOString(),
      },
      {
        id: '368',
        route: '368',
        direction: 0,
        destination: '校內',
        status: 3,
        seconds: null,
        updatedAt: now,
        stopName: '靜宜大學(校門)',
      },
    ],
  });
  render(<HomePage />);
  expect(await screen.findByText(/162 往沙鹿 3 分/)).toBeTruthy();
  expect(screen.queryByText('沒有班次')).toBeNull();
  expect(screen.queryByText('暫時沒資料')).toBeNull();
  expect(screen.getByRole('link', { name: /下一班公車/ }).getAttribute('href')).toBe('/bus');
});

it('revalidates an expired course session before retrying with the new account context', async () => {
  state.uid = null;
  state.session = { context: 'expired', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData).mockRejectedValueOnce(new NuniError(409, 'SESSION_CHANGED'));
  const view = render(<HomePage />);
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  vi.mocked(loadNuniHomeData).mockResolvedValueOnce(data('New account course'));
  state.session = { context: 'renewed', platformAccountId: 'student-b' };
  view.rerender(<HomePage />);
  await screen.findByText('New account course');
  expect(loadNuniHomeData).toHaveBeenLastCalledWith(expect.any(Function), 'student-b');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps an overdue but open quiz actionable before later tasks', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    ...data('設計'),
    tasks: [
      {
        kind: 'quiz',
        id: 'quiz1',
        courseId: 'design',
        courseName: '設計',
        title: '課堂提問',
        dueAt: '2020-01-02T12:30:00Z',
        acceptsLate: true,
        href: '/classroom/course/design#quiz-quiz1',
      },
      {
        id: 'later',
        courseId: 'design',
        courseName: '設計',
        title: '期末作業',
        dueAt: '2099-01-02T12:30:00Z',
        acceptsLate: true,
      },
    ],
  });
  render(<HomePage />);
  const action = await screen.findByRole('link', { name: /課堂提問/ });
  expect(action.getAttribute('href')).toBe('/classroom/course/design#quiz-quiz1');
  expect(screen.getAllByText('已過參考期限・仍可作答')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /期末作業/ }).getAttribute('href')).toBe(
    '/course/design#assignment-later',
  );
});

function dueSoonTomorrow() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

it('hides 現在可處理 when later work was already handled and today work exists', async () => {
  const cardId = makeSenseCardId('due_soon', { courseId: 'cs101', id: 'later' });
  window.localStorage.setItem(
    senseStorageKey('school:alice'),
    serializeSenseState(
      applySenseAction(emptySenseState(), 'handle', { id: cardId, title: '遠期作業' }, new Date()),
    ),
  );
  vi.mocked(loadHomeData).mockResolvedValue({
    ...data('資料結構'),
    tasks: [
      {
        id: 'hw-1',
        courseId: 'cs101',
        courseName: '資料結構',
        title: '期末報告',
        dueAt: '2020-01-02T12:30:00Z',
        href: '/course/cs101#assignment-hw-1',
      },
      {
        id: 'later',
        courseId: 'cs101',
        courseName: '資料結構',
        title: '遠期作業',
        dueAt: dueSoonTomorrow(),
        href: '/course/cs101#assignment-later',
      },
    ],
  });
  render(<HomePage />);
  expect(await screen.findByTestId('today-work-list')).toBeTruthy();
  await waitFor(() => {
    expect(screen.queryByRole('heading', { name: /現在可處理/ })).toBeNull();
  });
});

it('does not repeat today-due work under 現在可處理', async () => {
  vi.mocked(loadHomeData).mockResolvedValue(overdueHome());
  render(<HomePage />);
  expect(await screen.findByRole('link', { name: /期末報告/ })).toBeTruthy();
  expect(screen.getByTestId('today-work-list').textContent).toContain('期末報告');
  expect(screen.queryByRole('heading', { name: /現在可處理/ })).toBeNull();
  expect(screen.queryByText(/依據作業「期末報告」已過截止時間/)).toBeNull();
});

it('lists recent published feedback with a deep link into the assignment', async () => {
  vi.mocked(loadHomeData).mockResolvedValue({
    ...data('資料結構'),
    tasks: [],
    recentFeedback: [
      {
        kind: 'assignment',
        id: 'hw-1',
        courseId: 'cs101',
        courseName: '資料結構',
        title: '期末報告',
        feedback: '結構清楚，請補結論',
        score: 88,
        reviewedAt: '2026-10-08T02:00:00.000Z',
        submittedAt: '2026-10-07T10:00:00.000Z',
        href: '/course/cs101#assignment-hw-1',
      },
    ],
  });
  render(<HomePage />);
  const section = await screen.findByTestId('recent-feedback');
  expect(section.textContent).toContain('最近老師回饋');
  expect(section.textContent).toContain('結構清楚，請補結論');
  const link = screen.getByRole('link', { name: /期末報告/ });
  expect(link.getAttribute('href')).toBe('/course/cs101#assignment-hw-1');
});

it('labels homepage feedback that predates a later student resubmission', async () => {
  vi.mocked(loadHomeData).mockResolvedValue({
    ...data('資料結構'),
    tasks: [],
    recentFeedback: [
      {
        kind: 'assignment',
        id: 'hw-1',
        courseId: 'cs101',
        courseName: '資料結構',
        title: '期末報告',
        feedback: '針對舊稿',
        score: null,
        reviewedAt: '2026-10-08T02:00:00.000Z',
        submittedAt: '2026-10-09T04:00:00.000Z',
        href: '/course/cs101#assignment-hw-1',
      },
    ],
  });
  render(<HomePage />);
  const section = await screen.findByTestId('recent-feedback');
  expect(section.textContent).toContain('早於最近繳交');
  expect(section.textContent).toContain(
    '這則回饋早於你最近一次繳交，請到作業頁確認是否仍適用。',
  );
});

it('builds a sense card from later work due within a day, writes local state after preview, and undoes it', async () => {
  vi.mocked(loadHomeData).mockResolvedValue({
    ...data('資料結構'),
    tasks: [
      {
        id: 'hw-1',
        courseId: 'cs101',
        courseName: '資料結構',
        title: '期末報告',
        dueAt: dueSoonTomorrow(),
        href: '/course/cs101#assignment-hw-1',
      },
    ],
  });
  render(<HomePage />);
  expect(await screen.findByRole('heading', { name: /現在可處理/ })).toBeTruthy();
  expect(screen.getByText(/依據作業「期末報告」將於 24 小時內截止/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /前往這份作業/ }).getAttribute('href')).toBe(
    '/course/cs101#assignment-hw-1',
  );
  fireEvent.click(screen.getByRole('button', { name: '從清單移出' }));
  expect(screen.getByText(SENSE_HANDLE_PREVIEW)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '確認移出' }));
  expect(await screen.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(window.localStorage.getItem(senseStorageKey('school:alice'))).toContain('"handle"');
  fireEvent.click(screen.getByRole('button', { name: '撤銷上次操作' }));
  expect(await screen.findByText(/依據作業「期末報告」將於 24 小時內截止/)).toBeTruthy();
});

const overdueHome = (): HomeData => ({
  ...data('資料結構'),
  tasks: [
    {
      id: 'hw-1',
      courseId: 'cs101',
      courseName: '資料結構',
      title: '期末報告',
      dueAt: '2020-01-02T12:30:00Z',
      href: '/course/cs101#assignment-hw-1',
    },
  ],
});

const soonHome = (): HomeData => ({
  ...data('資料結構'),
  tasks: [
    {
      id: 'hw-1',
      courseId: 'cs101',
      courseName: '資料結構',
      title: '期末報告',
      dueAt: dueSoonTomorrow(),
      href: '/course/cs101#assignment-hw-1',
    },
  ],
});

it.each([
  ['從清單移出', '確認移出', '"handle"'],
  ['稍後一小時', '確認稍後', '"snooze"'],
] as const)('keeps %s after remounting from saved local state', async (action, confirm, token) => {
  vi.mocked(loadHomeData).mockResolvedValue(soonHome());
  const view = render(<HomePage />);
  expect(await screen.findByText(/依據作業「期末報告」將於 24 小時內截止/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: action }));
  fireEvent.click(screen.getByRole('button', { name: confirm }));
  expect(await screen.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(window.localStorage.getItem(senseStorageKey('school:alice'))).toContain(token);
  view.unmount();
  render(<HomePage />);
  expect(await screen.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(screen.queryByText(/依據作業「期末報告」將於 24 小時內截止/)).toBeNull();
  expect(screen.queryByRole('button', { name: action })).toBeNull();
});

it('reads a previously saved handle on first mount instead of showing the card again', async () => {
  vi.mocked(loadHomeData).mockResolvedValue(soonHome());
  const cardId = makeSenseCardId('due_soon', { courseId: 'cs101', id: 'hw-1' });
  window.localStorage.setItem(
    senseStorageKey('school:alice'),
    serializeSenseState(
      applySenseAction(emptySenseState(), 'handle', { id: cardId, title: '期末報告' }, new Date()),
    ),
  );
  render(<HomePage />);
  expect(await screen.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(screen.queryByText(/依據作業「期末報告」已過截止時間/)).toBeNull();
});

it('keeps the card and says it did not save when local write fails', async () => {
  vi.mocked(loadHomeData).mockResolvedValue(soonHome());
  const key = senseStorageKey('school:alice');
  const memory: Record<string, string> = {};
  const previous = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem(name: string) {
        return Object.prototype.hasOwnProperty.call(memory, name) ? memory[name] : null;
      },
      setItem(name: string, value: string) {
        if (name === key) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        memory[name] = String(value);
      },
      removeItem(name: string) {
        delete memory[name];
      },
      clear() {
        for (const name of Object.keys(memory)) delete memory[name];
      },
      key(index: number) {
        return Object.keys(memory)[index] ?? null;
      },
      get length() {
        return Object.keys(memory).length;
      },
    },
  });
  try {
    render(<HomePage />);
    expect(await screen.findByText(/依據作業「期末報告」將於 24 小時內截止/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '從清單移出' }));
    fireEvent.click(screen.getByRole('button', { name: '確認移出' }));
    expect(await screen.findByText(SENSE_SAVE_FAILED_TEXT)).toBeTruthy();
    expect(screen.getByText(/依據作業「期末報告」將於 24 小時內截止/)).toBeTruthy();
    expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
    expect(screen.queryByRole('button', { name: '撤銷上次操作' })).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  } finally {
    if (previous) Object.defineProperty(window, 'localStorage', previous);
  }
});

it('says there is nothing to handle when loaded tasks are not due soon, without filling sample cards', async () => {
  vi.mocked(loadHomeData).mockResolvedValue({
    ...data('資料結構'),
    tasks: [
      {
        id: 'later',
        courseId: 'cs101',
        courseName: '資料結構',
        title: '遠期作業',
        dueAt: '2099-01-02T12:30:00Z',
      },
    ],
  });
  render(<HomePage />);
  expect(await screen.findByText(TODAY_WORK_EMPTY)).toBeTruthy();
  expect(await screen.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(screen.getByRole('link', { name: /遠期作業/ }).getAttribute('href')).toBe(
    '/course/cs101#assignment-later',
  );
  expect(screen.queryByText('遠期作業是範例')).toBeNull();
  expect(screen.queryByRole('button', { name: '從清單移出' })).toBeNull();
});

it('lists every course today item on the first screen and opens the real assignment or quiz hash', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    courses: [
      { id: 'design', name: '視覺設計', role: 'student', unreadCount: 0 },
      { id: 'cs101', name: '資料結構', role: 'student', unreadCount: 0 },
    ],
    tasks: Array.from({ length: 6 }, (_, index) => ({
      kind: index === 1 ? 'quiz' : 'assignment',
      id: index === 1 ? 'quiz-1' : `hw-${index}`,
      courseId: index < 3 ? 'design' : 'cs101',
      courseName: index < 3 ? '視覺設計' : '資料結構',
      title: `今日項目 ${index}`,
      dueAt: '2020-01-02T12:30:00Z',
      acceptsLate: true,
      href:
        index === 1
          ? '/classroom/course/design#quiz-quiz-1'
          : `/classroom/course/${index < 3 ? 'design' : 'cs101'}#assignment-hw-${index}`,
    })),
    unreadCount: 0,
  });
  render(<HomePage />);
  expect(await screen.findByRole('heading', { name: /今天要交/ })).toBeTruthy();
  const items = screen.getByTestId('today-work-list').querySelectorAll('a');
  expect(items).toHaveLength(6);
  expect(items[1].getAttribute('href')).toBe('/classroom/course/design#quiz-quiz-1');
  expect(items[0].getAttribute('href')).toBe('/classroom/course/design#assignment-hw-0');
  expect(screen.queryByTestId('later-work-list')).toBeNull();
  expect(screen.queryByRole('heading', { name: /現在可處理/ })).toBeNull();
});

it('puts next class, next bus and today work on the same first screen when those facts exist', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  state.nextClass = '下一堂課 微積分 · 資工101';
  const fetchedAt = new Date().toISOString();
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'ready',
    kind: 'arrivals',
    fetchedAt,
    arrivals: [
      {
        id: '162',
        route: '162',
        direction: 1,
        destination: '沙鹿火車站',
        status: 0,
        seconds: 180,
        updatedAt: fetchedAt,
        stopName: '靜宜大學(英才路)',
      },
    ],
  });
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
  expect((await screen.findByTestId('home-next-class')).textContent).toContain('微積分 · 資工101');
  expect(await screen.findByText(/162 往沙鹿 3 分/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /週五提案/ }).getAttribute('href')).toBe(
    '/classroom/course/design#assignment-draft',
  );
});

it('says no class has been joined instead of inventing today work', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    courses: [],
    tasks: [],
    unreadCount: 0,
  });
  render(<HomePage />);
  expect(await screen.findByText(TODAY_WORK_NO_CLASS)).toBeTruthy();
  expect(screen.getByRole('link', { name: /匯入課表/ }).getAttribute('href')).toBe(
    '/import?kind=timetable',
  );
  expect(screen.queryByTestId('today-work-list')).toBeNull();
});

it('does not show a next-bus row when campus arrivals are missing', async () => {
  state.uid = null;
  render(<HomePage />);
  await waitFor(() => expect(queryTransit).toHaveBeenCalled());
  expect(screen.queryByTestId('home-bus-entry')).toBeNull();
  expect(screen.queryByText('看全部')).toBeNull();
  expect(screen.queryByText('正在查看…')).toBeNull();
});

it('keeps today-work and next-class rows wrapping on a 390-wide phone', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const css = readFileSync(join(process.cwd(), 'src/app/home.module.css'), 'utf8');
  expect(css).toMatch(/\.todayFacts \{[^}]*min-width: 0/);
  expect(css).toMatch(/\.todayFacts:not\(:has\(\*\)\)/);
  expect(css).toMatch(/\.nextClassBody \{[^}]*overflow-wrap: anywhere/);
  expect(css).toMatch(/\.busEntryMeta \{[^}]*overflow-wrap: anywhere/);
  expect(css).toMatch(/\.taskContent strong,\s*\.course h3 \{\s*overflow-wrap: anywhere;/);
  expect(css).toMatch(/\.list \{[^}]*min-width: 0/);
  expect(css).toMatch(/\.list \{[^}]*overflow-x: clip/);
  expect(css).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
  expect(css).toMatch(/\.courseWorkTarget \{[^}]*scroll-margin-top: 48px/);
  expect(css).toMatch(/@media \(max-width: 480px\) \{[\s\S]*?\.task \{[\s\S]*?padding: 12px 0/);
});

it('lists new materials on today and opens the cabinet hash', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  const materialId = 'cwm_11111111-1111-4111-8111-111111111111';
  const courseId = 'cw_11111111-1111-4111-8111-111111111111';
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    ...data('資料庫系統'),
    courses: [{ id: courseId, name: '資料庫系統', role: 'student', unreadCount: 0, href: `/classroom/course/${courseId}` }],
    materials: [
      {
        id: materialId,
        courseId,
        courseName: '資料庫系統',
        title: '本週講義',
        unitTitle: '第 03 週',
        createdAt: new Date().toISOString(),
        href: `/classroom/course/${courseId}#material-${materialId}`,
      },
    ],
  });
  render(<HomePage />);
  const link = await screen.findByRole('link', { name: /本週講義/ });
  expect(link.getAttribute('href')).toBe(`/classroom/course/${courseId}#material-${materialId}`);
  expect(link.textContent).toContain('資料庫系統');
  expect(link.textContent).toContain('第 03 週');
  expect(screen.getByLabelText('找所有課的教材')).toBeTruthy();
});

it('keeps today work and feedback when materials fail, and retries only materials', async () => {
  state.uid = null;
  state.session = { context: 'session-a', platformAccountId: 'student-a' };
  const courseId = 'cw_11111111-1111-4111-8111-111111111111';
  const materialId = 'cwm_11111111-1111-4111-8111-111111111111';
  vi.mocked(loadNuniHomeData).mockResolvedValue({
    courses: [{ id: courseId, name: '資料庫系統', role: 'student', unreadCount: 0, href: `/classroom/course/${courseId}` }],
    tasks: [
      {
        kind: 'assignment',
        id: 'hw-1',
        courseId,
        courseName: '資料庫系統',
        title: '週五提案',
        dueAt: '2020-01-02T12:30:00Z',
        acceptsLate: true,
        href: `/classroom/course/${courseId}#assignment-hw-1`,
      },
    ],
    recentFeedback: [
      {
        kind: 'assignment',
        id: 'hw-2',
        courseId,
        courseName: '資料庫系統',
        title: '期末報告',
        feedback: '結構清楚',
        score: 88,
        reviewedAt: '2026-10-08T02:00:00.000Z',
        submittedAt: '2026-10-07T10:00:00.000Z',
        href: `/classroom/course/${courseId}#assignment-hw-2`,
      },
    ],
    materials: [],
    materialsError: '目前無法連線。請保留填寫內容，稍後重試。',
    materialSearchSeed: { items: [], courseIds: [], truncated: false },
    unreadCount: 0,
  });
  vi.mocked(loadNuniHomeMaterials).mockResolvedValue({
    materials: [
      {
        id: materialId,
        courseId,
        courseName: '資料庫系統',
        title: '本週講義',
        unitTitle: '第 03 週',
        createdAt: new Date().toISOString(),
        href: `/classroom/course/${courseId}#material-${materialId}`,
      },
    ],
    materialsError: null,
    materialSearchSeed: {
      items: [
        {
          id: materialId,
          workspaceId: courseId,
          courseTitle: '資料庫系統',
          title: '本週講義',
          body: 'https://example.test/week.pdf',
          unitTitle: '第 03 週',
          createdAt: new Date().toISOString(),
        },
      ],
      courseIds: [courseId],
      truncated: false,
    },
  });
  render(<HomePage />);
  expect(await screen.findByRole('heading', { name: HOME_MATERIALS_UNAVAILABLE })).toBeTruthy();
  expect(screen.getByRole('link', { name: /週五提案/ })).toBeTruthy();
  expect(screen.getByTestId('recent-feedback').textContent).toContain('結構清楚');
  expect(screen.queryByRole('link', { name: /本週講義/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重試載入教材' }));
  expect(await screen.findByRole('link', { name: /本週講義/ })).toBeTruthy();
  expect(loadNuniHomeMaterials).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('heading', { name: HOME_MATERIALS_UNAVAILABLE })).toBeNull();
  expect(screen.getByRole('link', { name: /週五提案/ })).toBeTruthy();
  expect(screen.getByTestId('recent-feedback').textContent).toContain('結構清楚');
});
