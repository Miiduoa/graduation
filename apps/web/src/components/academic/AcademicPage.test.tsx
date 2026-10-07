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
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => account }));
vi.mock('next/navigation', () => ({ usePathname: () => '/grades' }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/academicClient', async (original) => ({
  ...(await original<typeof import('@/lib/academicClient')>()),
  loadAcademicRecords: vi.fn(),
}));
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
  vi.mocked(loadAcademicRecords).mockResolvedValue(grades());
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
  expect(screen.queryByText('真實來源科目')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('真實來源科目');
});
it('clears private records synchronously when signing out', async () => {
  const view = render(<GradesPage />);
  await screen.findByText('真實來源科目');
  account.user = null;
  view.rerender(<GradesPage />);
  expect(screen.queryByText('真實來源科目')).toBeNull();
  expect(screen.getByRole('link', { name: '登入學校帳號' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fgrades',
  );
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
it('keeps weekend and unrecognized course times discoverable and detects actual overlaps', async () => {
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
  expect(await screen.findByText('有 1 組課程時間重疊')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '上課日待確認' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '課程清單' }));
  expect(screen.getByRole('heading', { name: '週末課' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('上課日'), { target: { value: '6' } });
  expect(screen.queryByRole('heading', { name: '另約時間' })).toBeNull();
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
