import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CourseAttendance } from './CourseAttendance';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  joinCourseAttendance,
  loadAttendanceCode,
  loadAttendanceRecords,
  loadCourseAttendance,
  startCourseAttendance,
  watchCourseMembership,
  type CourseAttendance as Data,
} from '@/lib/courseAttendance';

const auth = vi.hoisted(() => ({ uid: 'student' as string | null }));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: auth.uid ? { uid: auth.uid } : null, loading: false }),
}));
vi.mock('./PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,a') },
}));
vi.mock('@/lib/courseAttendance', async (original) => ({
  ...(await original<typeof import('@/lib/courseAttendance')>()),
  loadCourseAttendance: vi.fn(),
  startCourseAttendance: vi.fn(),
  joinCourseAttendance: vi.fn(),
  endCourseAttendance: vi.fn(),
  loadAttendanceRecords: vi.fn(),
  loadAttendanceCode: vi.fn(),
  watchCourseMembership: vi.fn(),
}));
function data(teacher = false): Data {
  return {
    courseId: 'course',
    courseName: '資料結構',
    canStart: teacher,
    canReadRoster: teacher,
    sessions: [
      {
        id: 'session',
        teacherId: 'teacher',
        active: true,
        startedAt: '2026-10-07T01:00:00Z',
        endedAt: null,
        qrExpiresAt: '2026-10-07T01:10:00Z',
        attendeeCount: 0,
        ownRecord: null,
      },
    ],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  auth.uid = 'student';
  vi.mocked(loadCourseAttendance).mockResolvedValue(data());
  vi.mocked(watchCourseMembership).mockImplementation((_course, _uid, changed) => {
    changed('member');
    return () => {};
  });
});

it('requires a code and confirms a saved receipt only after the server acknowledges it', async () => {
  let finish!: (result: { success: boolean; checkedInAt: string; alreadyJoined: boolean }) => void;
  vi.mocked(joinCourseAttendance).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<CourseAttendance courseId="course" />);
  const input = await screen.findByLabelText('教師提供的簽到碼');
  expect(screen.getByRole('button', { name: '確認簽到' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(input, { target: { value: 'teacher-code' } });
  fireEvent.click(screen.getByRole('button', { name: '確認簽到' }));
  expect(screen.queryByText(/已簽到 ·/)).toBeNull();
  expect(joinCourseAttendance).toHaveBeenCalledWith('course', 'session', 'teacher-code');
  await act(async () =>
    finish({ success: true, checkedInAt: '2026-10-07T01:02:00Z', alreadyJoined: false }),
  );
  expect(await screen.findByText(/已簽到 ·/)).toBeTruthy();
});

it('keeps the entered code on failure and never shows a successful check-in', async () => {
  vi.mocked(joinCourseAttendance).mockRejectedValue({ code: 'functions/permission-denied' });
  render(<CourseAttendance courseId="course" />);
  const input = await screen.findByLabelText('教師提供的簽到碼');
  fireEvent.change(input, { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: '確認簽到' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((input as HTMLInputElement).value).toBe('wrong');
  expect(screen.queryByText(/已簽到 ·/)).toBeNull();
});

it('reuses the same request identity after an ambiguous start failure', async () => {
  auth.uid = 'teacher';
  vi.mocked(loadCourseAttendance).mockResolvedValue({ ...data(true), sessions: [] });
  vi.mocked(startCourseAttendance).mockRejectedValue(new Error('connection lost'));
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '開啟點名' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '開啟點名' }));
  await waitFor(() => expect(startCourseAttendance).toHaveBeenCalledTimes(2));
  expect(vi.mocked(startCourseAttendance).mock.calls[0][1]).toBe(
    vi.mocked(startCourseAttendance).mock.calls[1][1],
  );
});

it('clears teacher records when permission is revoked during refresh', async () => {
  auth.uid = 'teacher';
  vi.mocked(loadCourseAttendance).mockResolvedValue(data(true));
  vi.mocked(loadAttendanceRecords).mockResolvedValue([
    { uid: 'alice', displayName: '學生甲', studentId: 'S001', checkedInAt: '2026-10-07T01:02:00Z' },
  ]);
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看簽到名單' }));
  expect(await screen.findByText('學生甲')).toBeTruthy();
  vi.mocked(loadCourseAttendance).mockRejectedValue({ code: 'permission-denied' });
  fireEvent.click(screen.getByRole('button', { name: '更新紀錄' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('學生甲')).toBeNull();
  expect(screen.queryByText('還沒有點名紀錄')).toBeNull();
});

it('ignores a late secret response after account or course switching', async () => {
  auth.uid = 'teacher';
  vi.mocked(loadCourseAttendance).mockResolvedValue(data(true));
  let finish!: (code: string) => void;
  vi.mocked(loadAttendanceCode).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '顯示簽到碼' }));
  auth.uid = 'student';
  vi.mocked(loadCourseAttendance).mockResolvedValue(data());
  view.rerender(<CourseAttendance courseId="other-course" />);
  await act(async () => finish('private-code'));
  expect(screen.queryByText('private-code')).toBeNull();
  expect(screen.queryByAltText('本次課堂簽到 QR Code')).toBeNull();
});
it('removes private records immediately when the live membership is revoked', async () => {
  auth.uid = 'teacher';
  vi.mocked(loadCourseAttendance).mockResolvedValue(data(true));
  let changed!: (role: string | null) => void;
  vi.mocked(watchCourseMembership).mockImplementation((_course, _uid, callback) => {
    changed = callback;
    callback('instructor');
    return () => {};
  });
  vi.mocked(loadAttendanceRecords).mockResolvedValue([
    { uid: 'alice', displayName: '學生甲', studentId: 'S001', checkedInAt: '2026-10-07T01:02:00Z' },
  ]);
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看簽到名單' }));
  await screen.findByText('學生甲');
  await act(async () => changed(null));
  expect(screen.queryByText('學生甲')).toBeNull();
  expect(screen.queryByRole('button', { name: '顯示簽到碼' })).toBeNull();
});
it('lets an instructor open a session when another instructor left one active', async () => {
  auth.uid = 'replacement';
  vi.mocked(loadCourseAttendance).mockResolvedValue(data(true));
  render(<CourseAttendance courseId="course" />);
  expect((await screen.findByRole('button', { name: '開啟點名' })).hasAttribute('disabled')).toBe(
    false,
  );
});

it('keeps the teacher route and school context when returning to the course or signing in', () => {
  auth.uid = null;
  const school = { school: 'PU', schoolId: 'providence-university' };
  const { schoolSearch } = resolveSchoolPageContext(school);
  render(<CourseAttendance courseId="course/id" audience="teacher" searchParams={school} />);
  expect(screen.getByRole('link', { name: '回課程工作台' }).getAttribute('href')).toBe(
    `/teacher/course/course%2Fid${schoolSearch}`,
  );
  expect(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')).toBe(
    `/login?redirect=${encodeURIComponent(`/teacher/course/course%2Fid/attendance${schoolSearch}`)}`,
  );
  expect(screen.getByRole('main').id).toBe('page-content');
});
