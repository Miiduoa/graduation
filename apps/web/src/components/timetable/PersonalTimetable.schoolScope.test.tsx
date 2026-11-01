import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanMeta } from '@campus/shared';
import {
  PersonalTimetable,
  SHARE_NEEDS_SCHOOL_LOGIN_COPY,
  SHARE_SCHOOL_LOGIN_UNAVAILABLE_COPY,
} from './PersonalTimetable';

const context = vi.hoisted(() => ({
  schoolId: 'nthu',
  owner: 'guest',
  records: [] as Array<Record<string, unknown>>,
  load: vi.fn(),
  academic: vi.fn(),
  signIn: {
    studentId: false,
    loading: false,
    error: false,
    google: false,
    retry: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/timetable',
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => ({
    scope: { owner: context.owner, schoolId: context.schoolId },
    scopeKey: context.owner + ':' + context.schoolId,
    loading: false,
    schoolName: context.schoolId === 'nthu' ? '國立清華大學' : '靜宜大學',
  }),
  usePersonalImports: () => ({
    records: context.records,
    error: '',
    loading: false,
  }),
}));
vi.mock('@/lib/timetable/store', () => ({
  CLOUD_NOT_READY_COPY: '目前只能儲存在這台裝置',
  TIMETABLE_DEVICE_ONLY_STORED_COPY: '已存在這台裝置',
  TIMETABLE_DEVICE_ONLY_SUBMIT_COPY: '存在這台裝置',
  TimetableCloudSaveError: class TimetableCloudSaveError extends Error {},
  loadPersonalTimetable: context.load,
  savePersonalTimetable: vi.fn(async () => ({ stored: 'local' })),
  loadFriendTimetable: vi.fn(async () => null),
  listMyMeetups: vi.fn(async () => []),
  listAcceptedFriends: vi.fn(async () => []),
  createMeetup: vi.fn(),
  createServerShare: vi.fn(),
  respondMeetup: vi.fn(),
}));
vi.mock('@/lib/timetable/friends', () => ({
  listAcceptedFriends: vi.fn(async () => []),
}));
vi.mock('@/lib/useAcademicRecords', () => ({
  useAcademicRecords: (kind: string, enabled: boolean) => {
    context.academic(kind, enabled);
    return { state: null, refresh: vi.fn() };
  },
}));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => context.signIn,
}));

const record = (schoolId: string, id: string, title: string) => ({
  id,
  batchId: 'batch',
  kind: 'timetable',
  schoolId,
  title,
  academicYear: '115',
  semester: '1',
  dayOfWeek: 1,
  startPeriod: 3,
  endPeriod: 4,
  teacher: '',
  location: '',
  importedAt: '2026-10-14T00:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/timetable');
  context.schoolId = 'nthu';
  context.owner = 'guest';
  context.records = [];
  context.signIn.studentId = false;
  context.signIn.loading = false;
  context.signIn.error = false;
  context.load.mockImplementation(async (_uid: string | null, schoolId: string) => ({
    schoolId,
    courses: [],
    meta: cleanMeta({}),
    shareWithFriends: false,
    updatedAt: '2026-10-14T00:00:00Z',
  }));
});
afterEach(cleanup);

it('shows only imported courses belonging to the selected university', async () => {
  context.records = [
    record('pu', 'pu-course', '靜宜舊課表'),
    record('nthu', 'nthu-course', '清大新課表'),
  ];
  render(<PersonalTimetable />);
  await waitFor(() => expect(context.load).toHaveBeenCalledWith(null, 'nthu', 'guest'));
  expect(await screen.findByText(/自行匯入 1 筆/)).toBeTruthy();
  expect(screen.getAllByText('清大新課表').length).toBeGreaterThan(0);
  expect(screen.queryByText('靜宜舊課表')).toBeNull();
  expect(screen.getByText(/尚未取得這所學校的節次時間/)).toBeTruthy();
  expect(screen.queryByText(/08:10/)).toBeNull();
  expect(screen.queryByRole('button', { name: '格子' })).toBeNull();
  expect(screen.queryByRole('button', { name: '新增課程' })).toBeNull();
  expect(context.academic).toHaveBeenCalledWith('courses', false);
});

it('restores the configured grid after switching from an unknown period school', async () => {
  const view = render(<PersonalTimetable />);
  await screen.findByText(/尚未取得這所學校的節次時間/);
  context.schoolId = 'pu';
  view.rerender(<PersonalTimetable />);
  expect(await screen.findByRole('button', { name: '格子' })).toBeTruthy();
  expect(screen.queryByText(/尚未取得這所學校的節次時間/)).toBeNull();
});

it('does not show a manual and imported copy of the same class as conflicting courses', async () => {
  context.schoolId = 'pu';
  context.records = [record('pu', 'imported', '同一門課')];
  context.load.mockResolvedValue({
    schoolId: 'pu',
    courses: [
      {
        id: 'manual',
        name: '同一門課',
        day: 1,
        start: 3,
        end: 4,
        teacher: '',
        room: '',
        color: 'blue',
      },
    ],
    meta: cleanMeta({ year: '115', semester: '1' }),
    shareWithFriends: false,
    updatedAt: '2026-10-20T00:00:00Z',
  });
  render(<PersonalTimetable />);
  await screen.findAllByText('同一門課');
  fireEvent.click(screen.getByRole('button', { name: '一週' }));
  // The date-specific schedule correctly repeats a title already in the weekly baseline.
  // Its <strong> is not a second weekly course; count only the weekly <h4> cards.
  expect(screen.getAllByRole('heading', { name: '同一門課', level: 4 })).toHaveLength(1);
  expect(screen.queryByRole('region', { name: '衝堂' })).toBeNull();
});

it('resets the timetable and importer when the browsing school changes', async () => {
  context.records = [
    record('pu', 'pu-course', '靜宜舊課表'),
    record('nthu', 'nthu-course', '清大新課表'),
  ];
  const view = render(<PersonalTimetable />);
  expect(await screen.findByText(/自行匯入 1 筆/)).toBeTruthy();
  context.schoolId = 'pu';
  view.rerender(<PersonalTimetable />);
  await waitFor(() => expect(context.load).toHaveBeenCalledWith(null, 'pu', 'guest'));
  expect(screen.getAllByText('靜宜舊課表').length).toBeGreaterThan(0);
  expect(screen.queryByText('清大新課表')).toBeNull();
  expect(context.academic).toHaveBeenCalledWith('courses', true);
});

it('does not offer a school login link for sharing when student ID sign-in is closed', async () => {
  context.schoolId = 'pu';
  const view = render(<PersonalTimetable />);
  await screen.findByRole('button', { name: '新增課程' });
  expect(screen.getByText(SHARE_SCHOOL_LOGIN_UNAVAILABLE_COPY)).toBeTruthy();
  expect(screen.queryByText(SHARE_NEEDS_SCHOOL_LOGIN_COPY)).toBeNull();
  expect(screen.queryByText(/這個功能還沒接通/)).toBeNull();
  expect(screen.queryByRole('link', { name: '登入學校帳號' })).toBeNull();
  expect(screen.queryByRole('button', { name: '複製分享連結' })).toBeNull();
  const common = within(screen.getByRole('region', { name: '共同空堂' }));
  expect(common.getByText('目前尚未開放學校帳號登入，暫時無法讀取好友課表。')).toBeTruthy();
  expect(common.queryByRole('link', { name: '登入查看好友' })).toBeNull();
  expect(common.getByRole('link', { name: '匯入自己的課表' }).getAttribute('href')).toBe(
    '/import?kind=timetable&campus=pu',
  );
  context.records = [record('pu', 'mine', '自己的課程')];
  view.rerender(<PersonalTimetable />);
  fireEvent.click(common.getByRole('button', { name: '查看自己的空堂' }));
  const planning = screen.getByRole('region', { name: '幫我安排' });
  expect(within(planning).getByRole('heading', { name: '今天空堂' })).toBeTruthy();
  expect(document.activeElement).toBe(planning);
});

it('offers school login for sharing only when student ID sign-in is open', async () => {
  context.schoolId = 'pu';
  context.signIn.studentId = true;
  render(<PersonalTimetable />);
  await screen.findByRole('button', { name: '新增課程' });
  expect(screen.getByText(SHARE_NEEDS_SCHOOL_LOGIN_COPY, { exact: false })).toBeTruthy();
  expect(screen.queryByText(SHARE_SCHOOL_LOGIN_UNAVAILABLE_COPY)).toBeNull();
  expect(screen.getByRole('link', { name: '登入學校帳號' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Ftimetable%3Fcampus%3Dpu',
  );
  expect(screen.getByRole('link', { name: '登入查看好友' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Ftimetable%3Fcampus%3Dpu',
  );
  expect(screen.queryByRole('button', { name: '複製分享連結' })).toBeNull();
});

it.each([
  { loading: true, error: false, label: 'still loading' },
  { loading: false, error: true, label: 'unavailable' },
])(
  'treats $label sign-in options as school login still closed for sharing',
  async ({ loading, error }) => {
    context.schoolId = 'pu';
    context.signIn.loading = loading;
    context.signIn.error = error;
    context.signIn.studentId = true;
    render(<PersonalTimetable />);
    await screen.findByRole('button', { name: '新增課程' });
    expect(screen.getByText(SHARE_SCHOOL_LOGIN_UNAVAILABLE_COPY)).toBeTruthy();
    expect(screen.queryByText(SHARE_NEEDS_SCHOOL_LOGIN_COPY)).toBeNull();
    expect(screen.queryByRole('link', { name: '登入學校帳號' })).toBeNull();
    const common = within(screen.getByRole('region', { name: '共同空堂' }));
    expect(common.queryByRole('link', { name: '登入查看好友' })).toBeNull();
    expect(common.queryByText('目前尚未開放學校帳號登入，暫時無法讀取好友課表。')).toBeNull();
    if (error) {
      expect(common.getByRole('alert').textContent).toContain('暫時無法確認');
      fireEvent.click(common.getByRole('button', { name: '重新確認' }));
      expect(context.signIn.retry).toHaveBeenCalledOnce();
    } else {
      expect(common.getByRole('status').textContent).toContain('正在確認');
    }
  },
);

it('does not silently load Providence data when no campus is selected', () => {
  context.schoolId = 'personal';
  render(<PersonalTimetable />);
  expect(screen.getByRole('status').textContent).toContain('請先選擇一所學校');
  expect(context.load).not.toHaveBeenCalled();
});

it.each(['nthu', 'pu'])(
  'labels and switches academic terms in the %s timetable',
  async (schoolId) => {
    context.schoolId = schoolId;
    context.records = [
      record(schoolId, 'new', '本學期課程'),
      {
        ...record(schoolId, 'old', '舊學期課程'),
        academicYear: '114',
        semester: '2',
      },
    ];
    render(<PersonalTimetable />);
    expect((await screen.findAllByText('本學期課程')).length).toBeGreaterThan(0);
    expect(screen.queryByText('舊學期課程')).toBeNull();
    const terms = screen.getByRole('combobox', { name: '顯示自行匯入的學期' });
    expect(
      within(terms).getByRole('option', { name: '115 學年度 1 學期' }).getAttribute('value'),
    ).toBe('115|1');
    expect(
      within(terms).getByRole('option', { name: '114 學年度 2 學期' }).getAttribute('value'),
    ).toBe('114|2');
    fireEvent.change(terms, { target: { value: '114|2' } });
    expect(screen.getAllByText('舊學期課程').length).toBeGreaterThan(0);
    expect(screen.queryByText('本學期課程')).toBeNull();
  },
);

it('keeps the academic term selected on Today when opening the full timetable', async () => {
  window.history.replaceState({}, '', '/timetable?term=114%7C2');
  context.records = [
    record('nthu', 'new', '本學期課程'),
    {
      ...record('nthu', 'old', '舊學期課程'),
      academicYear: '114',
      semester: '2',
    },
  ];
  render(<PersonalTimetable />);
  expect((await screen.findAllByText('舊學期課程')).length).toBeGreaterThan(0);
  expect(screen.queryByText('本學期課程')).toBeNull();
});

it('shows explicit clock times for unknown-school imports that also carry periods', async () => {
  context.records = [
    {
      ...record('nthu', 'mixed', '微積分'),
      startTime: '09:30',
      endTime: '11:20',
    },
  ];
  render(<PersonalTimetable />);
  expect(await screen.findByText('微積分')).toBeTruthy();
  expect(screen.getByText(/09:30–11:20/)).toBeTruthy();
  expect(screen.getByText(/尚未取得這所學校的節次時間/)).toBeTruthy();
  expect(screen.queryByText(/第 3–4 節/)).toBeNull();
  expect(screen.queryByText(/08:10/)).toBeNull();
  expect(screen.queryByRole('button', { name: '格子' })).toBeNull();
  expect(screen.queryByRole('button', { name: '新增課程' })).toBeNull();
  expect(screen.queryByRole('button', { name: '今天空堂' })).toBeNull();
});

it('falls back to ordinal labels when imported clock times are invalid', async () => {
  const cases = [
    { startTime: '9:30', endTime: '11:20' },
    { startTime: '24:00', endTime: '25:00' },
    { startTime: '11:20', endTime: '09:30' },
    { startTime: '09:30', endTime: '09:30' },
  ];
  for (const times of cases) {
    cleanup();
    context.records = [{ ...record('nthu', 'bad-clock', '時鐘異常課'), ...times }];
    render(<PersonalTimetable />);
    expect(await screen.findByText('時鐘異常課')).toBeTruthy();
    expect(screen.getByText(/第 3–4 節（時間未確認）/)).toBeTruthy();
    expect(screen.queryByText(`${times.startTime}–${times.endTime}`)).toBeNull();
  }
});

it('does not take actual clock from another school or academic term with the same id', async () => {
  context.records = [
    {
      ...record('pu', 'shared-id', '靜宜同號課'),
      startTime: '09:30',
      endTime: '11:20',
    },
    {
      ...record('nthu', 'shared-id', '舊學期同號課'),
      academicYear: '114',
      semester: '2',
      startTime: '13:00',
      endTime: '14:50',
    },
    record('nthu', 'shared-id', '清大可見課'),
  ];
  render(<PersonalTimetable />);
  expect(await screen.findByText('清大可見課')).toBeTruthy();
  expect(screen.getByText(/第 3–4 節（時間未確認）/)).toBeTruthy();
  expect(screen.queryByText(/09:30–11:20/)).toBeNull();
  expect(screen.queryByText(/13:00–14:50/)).toBeNull();
  expect(screen.queryByText('靜宜同號課')).toBeNull();
  expect(screen.queryByText('舊學期同號課')).toBeNull();
});

it('keeps manual courses on ordinal labels when no import source supplies clock times', async () => {
  context.load.mockResolvedValue({
    schoolId: 'nthu',
    courses: [
      {
        id: 'manual',
        name: '手排課程',
        day: 1,
        start: 3,
        end: 4,
        teacher: '',
        room: '',
        color: 'blue',
      },
    ],
    meta: cleanMeta({}),
    shareWithFriends: false,
    updatedAt: '2026-10-14T00:00:00Z',
  });
  render(<PersonalTimetable />);
  expect(await screen.findByText('手排課程')).toBeTruthy();
  expect(screen.getByText(/第 3–4 節（時間未確認）/)).toBeTruthy();
  expect(screen.queryByText(/\d{2}:\d{2}–\d{2}:\d{2}/)).toBeNull();
  expect(screen.getByText(/尚未取得這所學校的節次時間/)).toBeTruthy();
});
