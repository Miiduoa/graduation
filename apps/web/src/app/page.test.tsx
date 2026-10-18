import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HomePage from './page';
import { loadHomeData, type HomeData } from '@/lib/homeOverview';
import { loadNuniHomeData } from '@/lib/nuniHomeOverview';
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
const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
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
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/components/timetable/TodayTimetable', () => ({ TodayTimetable: () => null }));
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
vi.mock('@/lib/homeOverview', () => ({ loadHomeData: vi.fn() }));
vi.mock('@/lib/nuniHomeOverview', () => ({ loadNuniHomeData: vi.fn() }));
vi.mock('@/lib/transit', async (original) => {
  const actual = await original<typeof import('@/lib/transit')>();
  return {
    ...actual,
    queryTransit: vi.fn(async () => ({ status: 'unavailable' as const, reason: 'not-configured' as const })),
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
  const taskLink = await screen.findByRole('link', { name: /查看並繳交作業/ });
  expect(taskLink.getAttribute('href')).toBe('/classroom/course/design#assignment-draft');
  expect(loadHomeData).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: /用 Google 帳號登入/ })).toBeNull();
  expect(screen.getAllByText('已過參考期限・仍可繳交')).toHaveLength(2);
  expect(screen.getAllByText(/1\/2 20:30/).length).toBeGreaterThanOrEqual(2);
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
  expect(await screen.findByRole('heading', { name: '今天的教學' })).toBeTruthy();
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
  const bus = screen.getByTestId('home-bus-entry');
  expect(bus.textContent).toContain('校門口公車');
  expect(screen.getByRole('link', { name: /看全部/ }).getAttribute('href')).toBe('/bus');
  expect(screen.queryByText('162、301、368、326')).toBeNull();
  expect(screen.getByRole('link', { name: '先瀏覽校園資訊' }).getAttribute('href')).toBe(
    '#public-services',
  );
  expect(screen.getByRole('region', { name: '校園生活' }).id).toBe('public-services');
  expect(screen.getByRole('link', { name: /校園地圖/ }).getAttribute('href')).toBe('/map');
  expect(screen.getByRole('link', { name: /公開公告/ }).getAttribute('href')).toBe(
    '/announcements',
  );
  expect(loadHomeData).not.toHaveBeenCalled();
  expect(loadNuniHomeData).not.toHaveBeenCalled();
  expect(screen.getByText(SENSE_UNSIGNED_TEXT)).toBeTruthy();
  expect(screen.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
});

it('shows the two soonest campus-gate buses on the home card with the same row style', async () => {
  state.uid = null;
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'ready', kind: 'arrivals', fetchedAt: now,
    arrivals: [
      { id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 180, updatedAt: now, stopName: '靜宜大學(英才路)' },
      { id: '301', route: '301', direction: 1, destination: '台中車站', status: 3, seconds: null, updatedAt: now, stopName: '靜宜大學(專用道)', scheduledAt: new Date(Date.now() + 12 * 60_000).toISOString() },
      { id: '368', route: '368', direction: 0, destination: '校內', status: 3, seconds: null, updatedAt: now, stopName: '靜宜大學(校門)' },
    ],
  });
  render(<HomePage />);
  expect(await screen.findByText('3 分')).toBeTruthy();
  expect(screen.getByText(/表定 \d{1,2}:\d{2}/)).toBeTruthy();
  expect(screen.getByText('往 沙鹿火車站')).toBeTruthy();
  expect(screen.getByText('往 台中車站')).toBeTruthy();
  expect(screen.queryByText('沒有班次')).toBeNull();
  expect(screen.queryByText('暫時沒資料')).toBeNull();
  expect(screen.getByRole('link', { name: /看全部/ }).getAttribute('href')).toBe('/bus');
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
  const action = await screen.findByRole('link', { name: /查看並作答測驗/ });
  expect(action.getAttribute('href')).toBe('/classroom/course/design#quiz-quiz1');
  expect(screen.getAllByText('已過參考期限・仍可作答')).toHaveLength(2);
});

it('builds a sense card from the real overdue task, writes local state after preview, and undoes it', async () => {
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
    ],
  });
  render(<HomePage />);
  expect(await screen.findByRole('heading', { name: /現在可處理/ })).toBeTruthy();
  expect(screen.getByText(/依據作業「期末報告」已過截止時間/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /前往這份作業/ }).getAttribute('href')).toBe(
    '/course/cs101#assignment-hw-1',
  );
  fireEvent.click(screen.getByRole('button', { name: '從清單移出' }));
  expect(screen.getByText(SENSE_HANDLE_PREVIEW)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '確認移出' }));
  expect(await screen.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(window.localStorage.getItem(senseStorageKey('school:alice'))).toContain('"handle"');
  fireEvent.click(screen.getByRole('button', { name: '撤銷上次操作' }));
  expect(await screen.findByText(/依據作業「期末報告」已過截止時間/)).toBeTruthy();
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

it.each([
  ['從清單移出', '確認移出', '"handle"'],
  ['稍後一小時', '確認稍後', '"snooze"'],
] as const)('keeps %s after remounting from saved local state', async (action, confirm, token) => {
  vi.mocked(loadHomeData).mockResolvedValue(overdueHome());
  const view = render(<HomePage />);
  expect(await screen.findByText(/依據作業「期末報告」已過截止時間/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: action }));
  fireEvent.click(screen.getByRole('button', { name: confirm }));
  expect(await screen.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(window.localStorage.getItem(senseStorageKey('school:alice'))).toContain(token);
  view.unmount();
  render(<HomePage />);
  expect(await screen.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(screen.queryByText(/依據作業「期末報告」已過截止時間/)).toBeNull();
  expect(screen.queryByRole('button', { name: action })).toBeNull();
});

it('reads a previously saved handle on first mount instead of showing the card again', async () => {
  vi.mocked(loadHomeData).mockResolvedValue(overdueHome());
  const cardId = makeSenseCardId('overdue', { courseId: 'cs101', id: 'hw-1' });
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
  vi.mocked(loadHomeData).mockResolvedValue(overdueHome());
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
    expect(await screen.findByText(/依據作業「期末報告」已過截止時間/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '從清單移出' }));
    fireEvent.click(screen.getByRole('button', { name: '確認移出' }));
    expect(await screen.findByText(SENSE_SAVE_FAILED_TEXT)).toBeTruthy();
    expect(screen.getByText(/依據作業「期末報告」已過截止時間/)).toBeTruthy();
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
  expect(await screen.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(screen.queryByText('遠期作業是範例')).toBeNull();
  expect(screen.queryByRole('button', { name: '從清單移出' })).toBeNull();
});
