import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GradesPage from '@/app/grades/page';
vi.mock('@/features/nuni/StudentGrades', () => ({ StudentGradesPage: () => <h1>nuni 成績</h1> }));
import TimetablePage from '@/app/timetable/page';
import CreditPlannerPage from '@/app/credit-planner/page';
import {
  AcademicConnectionError,
  loadAcademicRecords,
  type AcademicSnapshot,
} from '@/lib/academicClient';
import { normalizeCourseRecords, normalizeGradeRecords } from '@/lib/academicRecords';

const account = vi.hoisted(() => ({
  user: { uid: 'one' } as { uid: string } | null,
  loading: false,
  error: null,
  studentId: true,
}));
const browse = vi.hoisted(() => ({
  schoolId: 'pu' as string | null,
  schoolName: '靜宜大學',
  catalogStatus: 'ready' as 'loading' | 'ready' | 'error',
  loading: false,
}));
const navigation = vi.hoisted(() => ({
  path: '/grades',
  search: 'schoolId=pu&campus=pu',
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => account }));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => ({
    google: true,
    studentId: account.studentId,
    loading: false,
    retry: vi.fn(),
  }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => null,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.path,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({
    children,
    title,
    schoolName,
  }: {
    children: React.ReactNode;
    title?: string;
    schoolName?: string;
  }) => (
    <main>
      {schoolName ? <p>{schoolName}</p> : null}
      {title ? <h1>{title}</h1> : null}
      {children}
    </main>
  ),
}));
vi.mock('@/lib/academicClient', async (original) => ({
  ...(await original<typeof import('@/lib/academicClient')>()),
  loadAcademicRecords: vi.fn(),
}));
vi.mock('@/components/imports/PersonalImportSummary', () => ({
  PersonalImportSummary: () => <section aria-label="自行匯入的資料">個人匯入入口</section>,
}));
const timetableApi = vi.hoisted(() => ({
  loadPersonalTimetable: vi.fn(),
  savePersonalTimetable: vi.fn(),
  createMeetup: vi.fn(),
  createServerShare: vi.fn(),
  loadFriendTimetable: vi.fn(),
  listMyMeetups: vi.fn(async () => []),
  respondMeetup: vi.fn(),
}));
vi.mock('@/lib/timetable/store', async (original) => ({
  ...(await original<typeof import('@/lib/timetable/store')>()),
  ...timetableApi,
}));
vi.mock('@/lib/timetable/friends', () => ({
  listAcceptedFriends: vi.fn(async () => []),
}));
vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => ({
    scope: {
      owner: account.user ? `school:${account.user.uid}` : 'guest',
      schoolId: browse.schoolId || 'personal',
    },
    scopeKey: 'scope',
    loading: false,
    schoolName: browse.schoolName || '未指定校園',
  }),
  usePersonalImports: () => ({ records: [], error: '', loading: false }),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => selectedSchool(),
  useOptionalSelectedSchool: () => selectedSchool(),
}));

function selectedSchool() {
  if (browse.loading || browse.catalogStatus === 'loading') {
    return {
      selectedSchoolId: null,
      selectedSchool: null,
      loading: true,
      catalogStatus: 'loading' as const,
    };
  }
  if (browse.catalogStatus === 'error') {
    return {
      selectedSchoolId: null,
      selectedSchool: null,
      loading: false,
      catalogStatus: 'error' as const,
    };
  }
  if (!browse.schoolId) {
    return {
      selectedSchoolId: null,
      selectedSchool: null,
      loading: false,
      catalogStatus: 'ready' as const,
    };
  }
  return {
    selectedSchoolId: browse.schoolId,
    selectedSchool: { id: browse.schoolId, name: browse.schoolName },
    loading: false,
    catalogStatus: 'ready' as const,
  };
}

function emptyTimetable() {
  return {
    courses: [],
    meta: { school: '', year: '', semester: '', className: '', credits: 0, title: '' },
    shareWithFriends: true,
    updatedAt: '2026-10-08T00:00:00.000Z',
    schoolId: 'pu',
  };
}
function grades(uid = 'one', name = '真實來源科目'): AcademicSnapshot<'grades'> {
  return {
    ownerUid: uid,
    schoolId: 'pu',
    fetchedAt: '2026-10-08T00:00:00.000Z',
    records: normalizeGradeRecords({
      success: true,
      grades: [
        { semester: '1151', courseName: name, credits: 3, courseType: '必修', score: '尚未公布' },
        { semester: '1142', courseName: '前期科目', credits: 2, courseType: '選修', score: 0 },
      ],
      allSemesters: ['1151', '1142'],
      summary: {},
    }),
  };
}

function setBrowse(schoolId: string | null, extras?: Partial<typeof browse> & { search?: string }) {
  browse.schoolId = schoolId;
  browse.schoolName =
    extras?.schoolName ??
    (schoolId === 'nthu' ? '國立清華大學' : schoolId === 'pu' ? '靜宜大學' : '');
  browse.catalogStatus = extras?.catalogStatus ?? 'ready';
  browse.loading = extras?.loading ?? false;
  if (extras?.search !== undefined) {
    navigation.search = extras.search;
  } else if (!schoolId) {
    navigation.search = 'campus=all';
  } else {
    navigation.search = `schoolId=${schoolId}&campus=${schoolId}`;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  account.user = { uid: 'one' };
  account.loading = false;
  account.studentId = true;
  navigation.path = '/grades';
  setBrowse('pu');
  vi.mocked(loadAcademicRecords).mockResolvedValue(grades());
  timetableApi.loadPersonalTimetable.mockResolvedValue(emptyTimetable());
  timetableApi.savePersonalTimetable.mockResolvedValue({ stored: 'local' });
});
it('keeps unknown official graduation credits separate from the derived passed-credit total', async () => {
  navigation.path = '/credit-planner';
  const snapshot = grades();
  snapshot.records.creditSummary = {
    source: 'derived-from-grade-rows',
    officialAudit: false,
    totalRequired: null,
    totalEarned: 0,
    totalCourses: 2,
  };
  vi.mocked(loadAcademicRecords).mockResolvedValue(snapshot);
  render(<CreditPlannerPage />);
  const result = within(await screen.findByRole('region', { name: '學分讀取結果' }));
  expect(result.getByText('0')).toBeTruthy();
  expect(result.getByText('尚未取得')).toBeTruthy();
  expect(result.getByText(/以 60 分或通過判斷/)).toBeTruthy();
  expect((screen.getByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe(
    '',
  );
});

it('keeps weekend and unrecognized school courses as drafts until confirm', async () => {
  navigation.path = '/timetable';
  const course = {
    code: 'A',
    name: '週末課',
    credits: 2,
    dayOfWeek: 6,
    periods: [1, 2],
    startTime: '08:10',
    endTime: '10:00',
    location: '教室一',
    courseType: '選修',
  };
  vi.mocked(loadAcademicRecords).mockResolvedValue({
    ownerUid: 'one',
    schoolId: 'pu',
    fetchedAt: '2026-10-08T00:00:00.000Z',
    records: normalizeCourseRecords({
      success: true,
      semester: '1151',
      courses: [
        course,
        { ...course, code: 'B', name: '週末另一課' },
        {
          ...course,
          code: 'C',
          name: '另約時間',
          dayOfWeek: null,
          periods: [],
          startTime: null,
          endTime: null,
          timePlaceRaw: '另行公告',
        },
      ],
    }),
  });
  render(<TimetablePage />);
  expect(await screen.findByRole('heading', { name: '匯入課表' })).toBeTruthy();
  await waitFor(() => expect(loadAcademicRecords).toHaveBeenCalledWith('courses', 'one', 'pu'));
  fireEvent.click(screen.getByRole('button', { name: '從學校課表帶入' }));
  expect(screen.getByText('課表尚未被修改，按確認匯入後才會套用')).toBeTruthy();
  expect(screen.getByText('週末課')).toBeTruthy();
  expect(screen.getByText('週末另一課')).toBeTruthy();
  expect(screen.getByText('另約時間')).toBeTruthy();
  expect(screen.getAllByText(/時間待定/).length).toBeGreaterThan(0);
  expect(timetableApi.savePersonalTimetable).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '確認匯入' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '存在這台裝置' }));
  await waitFor(() => expect(timetableApi.savePersonalTimetable).toHaveBeenCalled());
  expect(screen.getByRole('status').textContent).toBe(
    '已存在這台裝置，換手機或清除瀏覽器資料就會不見',
  );
  expect(screen.queryByText(/已儲存|已同步/)).toBeNull();
});
it('requires personal input for credit planning and clears it when the account changes', async () => {
  navigation.path = '/credit-planner';
  const view = render(<CreditPlannerPage />);
  const approved = await screen.findByLabelText('已確認可採計學分（自行填寫）');
  expect((approved as HTMLInputElement).value).toBe('');
  fireEvent.change(approved, { target: { value: '60' } });
  fireEvent.change(screen.getByLabelText('希望累計的學分'), { target: { value: '128' } });
  fireEvent.change(screen.getByLabelText('預計再修學分'), { target: { value: '20' } });
  expect(
    within(screen.getByRole('region', { name: '個人學分試算' })).getByRole('status').textContent,
  ).toContain('48');
  account.user = { uid: 'two' };
  vi.mocked(loadAcademicRecords).mockResolvedValue(grades('two'));
  view.rerender(<CreditPlannerPage />);
  expect(
    ((await screen.findByLabelText('已確認可採計學分（自行填寫）')) as HTMLInputElement).value,
  ).toBe('');
});

it('offers local credit planning in another campus without reading Providence grades', async () => {
  navigation.path = '/credit-planner';
  setBrowse('nthu');
  render(<CreditPlannerPage />);
  expect(await screen.findByLabelText('已確認可採計學分（自行填寫）')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '這所學校尚未提供官方成績來源' })).toBeTruthy();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('已確認可採計學分（自行填寫）'), {
    target: { value: '48' },
  });
  fireEvent.change(screen.getByLabelText('希望累計的學分'), { target: { value: '128' } });
  expect(screen.getByRole('region', { name: '個人學分試算' }).textContent).toContain('80 學分');
});

it('hides locally scoped plans while school selection or account state is unresolved', async () => {
  navigation.path = '/credit-planner';
  setBrowse(null, { catalogStatus: 'loading', loading: true, search: '' });
  const view = render(<CreditPlannerPage />);
  expect(screen.queryByRole('region', { name: '個人學分試算' })).toBeNull();
  expect(loadAcademicRecords).not.toHaveBeenCalled();

  setBrowse('pu');
  account.loading = true;
  view.rerender(<CreditPlannerPage />);
  expect(screen.queryByRole('region', { name: '個人學分試算' })).toBeNull();

  account.loading = false;
  view.rerender(<CreditPlannerPage />);
  expect(await screen.findByLabelText('已確認可採計學分（自行填寫）')).toBeTruthy();
});

it('loads semester scores, school averages and rankings and filters semesters', async () => {
  navigation.search += '&tab=semester&from=profile';
  const snapshot = grades();
  snapshot.records.summary = {
    '1151': { semesterAverage: 85, classRanking: '3/40' },
    '1142': { semesterAverage: 70, departmentRanking: '20/100' },
  };
  vi.mocked(loadAcademicRecords).mockResolvedValue(snapshot);
  render(<GradesPage />);
  expect(await screen.findByText('真實來源科目')).toBeTruthy();
  expect(screen.getByText('尚未公布')).toBeTruthy();
  expect(screen.getByText('3/40')).toBeTruthy();
  expect(screen.getByText('20/100')).toBeTruthy();
  expect(screen.getByText('85')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1151' } });
  expect(screen.queryByText('前期科目')).toBeNull();
  expect(screen.queryByText('20/100')).toBeNull();
  const feedback = new URL(screen.getByRole('link', { name: '課程成績' }).getAttribute('href')!, 'https://test.local');
  expect(feedback.searchParams.get('tab')).toBe('feedback');
  expect(feedback.searchParams.get('campus')).toBe('pu');
  expect(feedback.searchParams.get('from')).toBe('profile');
});

it.each(['guest', 'reconnect', 'unavailable'] as const)(
  'preserves semester and existing query parameters on school login: %s',
  async (state) => {
    navigation.search =
      'tab=semester&from=profile&filter=a&filter=b&school=pu&schoolId=pu&campus=pu';
    if (state === 'guest') account.user = null;
    else vi.mocked(loadAcademicRecords).mockRejectedValue(new AcademicConnectionError(state));
    render(<GradesPage />);
    const label = state === 'guest'
      ? '用學校帳號登入'
      : state === 'reconnect' ? '連線學校帳號' : '重新連線學校帳號';
    const link = await screen.findByRole('link', { name: label });
    const login = new URL(link.getAttribute('href')!, 'https://test.local');
    expect(login.pathname).toBe('/login');
    expect(login.searchParams.get('returnUrl')).toBe(`/grades?${navigation.search}`);
    if (state !== 'guest') expect(login.searchParams.get('reconnect')).toBe('school');
  },
);

it('clears private records synchronously when signing out', async () => {
  navigation.search += '&tab=semester';
  const view = render(<GradesPage />);
  await screen.findByText('真實來源科目');
  account.user = null;
  account.studentId = false;
  view.rerender(<GradesPage />);
  expect(screen.queryByText('真實來源科目')).toBeNull();
  expect(screen.getByRole('heading', { name: '這個功能還沒接通' })).toBeTruthy();
  expect(screen.getByText('成績請先到學校的 e 校園查看。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /學校帳號/ })).toBeNull();
});

it('ignores an old account response even after logging out and back into the same UID', async () => {
  let finish!: (value: AcademicSnapshot<'grades'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  navigation.search += '&tab=semester';
  const view = render(<GradesPage />);
  // 控制器會在 microtask 才開始讀取。先讓舊的進行中請求成立，再登出；
  // 若在開始前就釋放，請求會整筆取消。
  await waitFor(() => expect(loadAcademicRecords).toHaveBeenCalledTimes(1));
  expect(loadAcademicRecords).toHaveBeenLastCalledWith('grades', 'one', 'pu');
  account.user = null;
  view.rerender(<GradesPage />);
  account.user = { uid: 'one' };
  view.rerender(<GradesPage />);
  await screen.findByText('真實來源科目');
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
  await act(async () => finish(grades('one', '舊回應不得出現')));
  expect(screen.queryByText('舊回應不得出現')).toBeNull();
  expect(screen.getByText('真實來源科目')).toBeTruthy();
});

it('removes the previous account transcript before loading the next account', async () => {
  navigation.search += '&tab=semester';
  const view = render(<GradesPage />);
  await screen.findByText('真實來源科目');
  vi.mocked(loadAcademicRecords).mockReturnValue(new Promise(() => {}));
  account.user = { uid: 'two' };
  view.rerender(<GradesPage />);
  expect(screen.queryByText('真實來源科目')).toBeNull();
  await waitFor(() =>
    expect(loadAcademicRecords).toHaveBeenLastCalledWith('grades', 'two', 'pu'),
  );
});

it('hides a Providence transcript immediately when switching to NTHU and does not query again', async () => {
  navigation.search += '&tab=semester';
  const view = render(<GradesPage />);
  await screen.findByText('真實來源科目');
  const callsBefore = vi.mocked(loadAcademicRecords).mock.calls.length;
  setBrowse('nthu');
  navigation.search += '&tab=semester';
  view.rerender(<GradesPage />);
  expect(screen.queryByText('真實來源科目')).toBeNull();
  expect(screen.getByRole('heading', { name: '這所學校尚未提供官方成績來源' })).toBeTruthy();
  expect(screen.getByText(/國立清華大學/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /e 校園/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /連線學校帳號/ })).toBeNull();
  expect(screen.getByRole('region', { name: '自行匯入的資料' })).toBeTruthy();
  expect(vi.mocked(loadAcademicRecords).mock.calls.length).toBe(callsBefore);
});

it('does not query official records on an NTHU first visit and keeps personal import', async () => {
  setBrowse('nthu');
  navigation.search += '&tab=semester';
  render(<GradesPage />);
  expect(await screen.findByRole('heading', { name: '這所學校尚未提供官方成績來源' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '自行匯入的資料' })).toBeTruthy();
  expect(screen.queryByText('真實來源科目')).toBeNull();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
});

it('does not query Providence for signed-in unresolved browse scopes', async () => {
  setBrowse(null, { search: 'campus=all' });
  navigation.search += '&tab=semester';
  render(<GradesPage />);
  expect(await screen.findByRole('heading', { name: '請先選擇一所學校' })).toBeTruthy();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
});

it('ignores an in-flight Providence response after leaving and returning to PU', async () => {
  let finish!: (value: AcademicSnapshot<'grades'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  navigation.search += '&tab=semester';
  const view = render(<GradesPage />);
  expect(await screen.findByText('正在向學校讀取資料…')).toBeTruthy();
  await waitFor(() => expect(loadAcademicRecords).toHaveBeenCalledTimes(1));
  setBrowse('nthu');
  navigation.search += '&tab=semester';
  view.rerender(<GradesPage />);
  expect(screen.queryByText('真實來源科目')).toBeNull();
  vi.mocked(loadAcademicRecords).mockResolvedValue(grades('one', '返回後的新資料'));
  setBrowse('pu');
  navigation.search += '&tab=semester';
  view.rerender(<GradesPage />);
  expect(await screen.findByText('返回後的新資料')).toBeTruthy();
  await act(async () => finish(grades('one', '切校前的舊回應')));
  expect(screen.queryByText('切校前的舊回應')).toBeNull();
  expect(screen.getByText('返回後的新資料')).toBeTruthy();
});

it('guest NTHU shows school unavailable without school login or official query', async () => {
  account.user = null;
  account.studentId = true;
  setBrowse('nthu');
  navigation.search += '&tab=semester';
  render(<GradesPage />);
  expect(await screen.findByRole('heading', { name: '這所學校尚未提供官方成績來源' })).toBeTruthy();
  expect(screen.getByText(/國立清華大學/)).toBeTruthy();
  expect(screen.getByRole('region', { name: '自行匯入的資料' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /學校帳號/ })).toBeNull();
  expect(screen.queryByText('成績請先到學校的 e 校園查看。')).toBeNull();
  expect(screen.queryByRole('link', { name: /e 校園/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /alcat/i })).toBeNull();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
});

it('never falls back to Providence for a valid unknown school id', async () => {
  account.user = null;
  account.studentId = true;
  setBrowse('new-campus', { schoolName: '新接入校園' });
  navigation.search += '&tab=semester';
  render(<GradesPage />);
  expect(await screen.findByRole('heading', { name: '這所學校尚未提供官方成績來源' })).toBeTruthy();
  expect(screen.getByText(/新接入校園/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /學校帳號/ })).toBeNull();
  expect(screen.queryByText('成績請先到學校的 e 校園查看。')).toBeNull();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
});

it('never falls back to Providence for an invalid school id', async () => {
  account.user = null;
  account.studentId = true;
  // Catalog rejects unknown ids → selectedSchool null → unselected (never PU).
  setBrowse(null, { search: 'schoolId=not-a-real-school&campus=not-a-real-school' });
  navigation.search += '&tab=semester';
  render(<GradesPage />);
  expect(await screen.findByRole('heading', { name: '請先選擇一所學校' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /學校帳號/ })).toBeNull();
  expect(screen.queryByText('成績請先到學校的 e 校園查看。')).toBeNull();
  expect(loadAcademicRecords).not.toHaveBeenCalled();
});

it('keeps the next account grades when the previous account responds late', async () => {
  navigation.search += '&tab=semester';
  let finish!: (value: AcademicSnapshot<'grades'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve;
  }));
  const view = render(<GradesPage />);
  await waitFor(() => expect(loadAcademicRecords).toHaveBeenCalledWith('grades', 'one', 'pu'));
  account.user = { uid: 'two' };
  vi.mocked(loadAcademicRecords).mockResolvedValue(grades('two', '新帳號成績'));
  view.rerender(<GradesPage />);
  await screen.findByText('新帳號成績');
  expect(loadAcademicRecords).toHaveBeenLastCalledWith('grades', 'two', 'pu');
  await act(async () => finish(grades('one', '前帳號延遲成績')));
  expect(screen.queryByText('前帳號延遲成績')).toBeNull();
  expect(screen.getByText('新帳號成績')).toBeTruthy();
});

it.each(['loading', 'error'] as const)('hides semester grades while the campus catalog is %s', async (status) => {
  navigation.search += '&tab=semester';
  const view = render(<GradesPage />);
  await screen.findByText('真實來源科目');
  setBrowse(null, { catalogStatus: status, loading: status === 'loading', search: '' });
  navigation.search += 'tab=semester';
  view.rerender(<GradesPage />);
  expect(screen.queryByText('真實來源科目')).toBeNull();
  expect(screen.getByRole('heading', { name: status === 'loading' ? '正在確認所選校園…' : '暫時無法確認所選校園' })).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
