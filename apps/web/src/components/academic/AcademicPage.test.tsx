import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GradesPage from '@/app/grades/page';
vi.mock('@/features/nuni/StudentGrades', () => ({ StudentGradesPage: () => <h1>nuni 成績</h1> }));
import TimetablePage from '@/app/timetable/page';
import CreditPlannerPage from '@/app/credit-planner/page';
import {
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
