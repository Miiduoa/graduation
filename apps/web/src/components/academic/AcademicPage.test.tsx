import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GradesPage from '@/app/grades/page';
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
  usePathname: () => '/grades',
  useRouter: () => ({ push: vi.fn() }),
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
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => ({ selectedSchoolId: 'pu' }),
  useOptionalSelectedSchool: () => ({ selectedSchoolId: 'pu' }),
}));
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
beforeEach(() => {
  vi.clearAllMocks();
  account.user = { uid: 'one' };
  account.loading = false;
  account.studentId = true;
  vi.mocked(loadAcademicRecords).mockResolvedValue(grades());
  timetableApi.loadPersonalTimetable.mockResolvedValue(emptyTimetable());
  timetableApi.savePersonalTimetable.mockResolvedValue({ stored: 'local' });
});
it('uses the function name in the header instead of a school name before the school account is connected', async () => {
  account.studentId = false;
  vi.mocked(loadAcademicRecords).mockRejectedValue(new AcademicConnectionError('reconnect'));
  render(<GradesPage />);
  expect(await screen.findByRole('heading', { level: 1, name: '成績' })).toBeTruthy();
  expect(screen.queryByText('靜宜大學')).toBeNull();
});
it('preserves unknown grades and a real zero without manufacturing GPA or rank', async () => {
  render(<GradesPage />);
  expect(await screen.findByText('真實來源科目')).toBeTruthy();
  expect(screen.getByText('尚未公布')).toBeTruthy();
  expect(screen.getByText('0.00')).toBeTruthy();
  expect(screen.queryByText('3.82')).toBeNull();
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1151' } });
  expect(screen.queryByText('前期科目')).toBeNull();
  expect(screen.getByText('—')).toBeTruthy();
});
it('shows failure and retries without falling back to demo or previously loaded grades', async () => {
  render(<GradesPage />);
  await screen.findByText('真實來源科目');
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  fireEvent.click(screen.getByRole('button', { name: '更新資料' }));
  expect(await screen.findByText('暫時無法讀取學校資料')).toBeTruthy();
  expect(screen.getByText(/暫時讀不到資料，請稍後再試/)).toBeTruthy();
  expect(screen.queryByText(/請確認網路後再試/)).toBeNull();
  expect(screen.queryByText('真實來源科目')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('真實來源科目');
});

it('shows that academic Cloud Functions are not enabled instead of a retryable failure', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unconfigured'));
  render(<GradesPage />);
  expect(await screen.findByText('學校資料雲端讀取尚未啟用')).toBeTruthy();
  expect(screen.getByText(/目前尚未接上雲端函式服務/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重新讀取' })).toBeNull();
  expect(screen.queryByText(/請稍後再試/)).toBeNull();
});

it('asks to check the network only when the academic fetch fails at the network layer', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(
    new AcademicConnectionError('unavailable', new TypeError('Failed to fetch')),
  );
  render(<GradesPage />);
  expect(await screen.findByText('暫時無法讀取學校資料')).toBeTruthy();
  expect(screen.getByText(/請確認網路後再試/)).toBeTruthy();
  expect(screen.queryByText(/暫時讀不到資料，請稍後再試/)).toBeNull();
});
it('clears private records synchronously when signing out', async () => {
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
  const view = render(<GradesPage />);
  account.user = null;
  view.rerender(<GradesPage />);
  account.user = { uid: 'one' };
  view.rerender(<GradesPage />);
  await screen.findByText('真實來源科目');
  await act(async () => finish(grades('one', '舊回應不得出現')));
  expect(screen.queryByText('舊回應不得出現')).toBeNull();
});
it('removes the previous account transcript before loading the next account', async () => {
  const view = render(<GradesPage />);
  await screen.findByText('真實來源科目');
  vi.mocked(loadAcademicRecords).mockReturnValue(new Promise(() => {}));
  account.user = { uid: 'two' };
  view.rerender(<GradesPage />);
  expect(screen.queryByText('真實來源科目')).toBeNull();
  await waitFor(() => expect(loadAcademicRecords).toHaveBeenLastCalledWith('grades', 'two'));
});
it('offers reconnection without pretending an expired session has an empty transcript', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValue(new AcademicConnectionError('reconnect'));
  render(<GradesPage />);
  const link = await screen.findByRole('link', { name: '連線學校帳號' });
  expect(link.getAttribute('href')).toContain('reconnect=school');
  expect(screen.queryByText('課程紀錄')).toBeNull();
});
it('does not open a school login form when student ID is unavailable', async () => {
  account.studentId = false;
  vi.mocked(loadAcademicRecords).mockRejectedValue(new AcademicConnectionError('reconnect'));
  render(<GradesPage />);
  expect(await screen.findByRole('heading', { name: '這個功能還沒接通' })).toBeTruthy();
  expect(screen.getByText('成績請先到學校的 e 校園查看。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /學校帳號/ })).toBeNull();
});
it('keeps weekend and unrecognized school courses as drafts until confirm', async () => {
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
  await waitFor(() => expect(loadAcademicRecords).toHaveBeenCalledWith('courses', 'one'));
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
  const view = render(<CreditPlannerPage />);
  const approved = await screen.findByLabelText('已確認可採計學分（自行填寫）');
  expect((approved as HTMLInputElement).value).toBe('');
  fireEvent.change(approved, { target: { value: '60' } });
  fireEvent.change(screen.getByLabelText('希望累計的學分'), { target: { value: '128' } });
  fireEvent.change(screen.getByLabelText('預計再修學分'), { target: { value: '20' } });
  expect(screen.getByRole('status').textContent).toContain('48');
  account.user = { uid: 'two' };
  vi.mocked(loadAcademicRecords).mockResolvedValue(grades('two'));
  view.rerender(<CreditPlannerPage />);
  expect(
    ((await screen.findByLabelText('已確認可採計學分（自行填寫）')) as HTMLInputElement).value,
  ).toBe('');
});
