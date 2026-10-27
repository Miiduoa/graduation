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
vi.mock('@/components/SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({ session: null, loading: false, pendingLogout: false, logout: vi.fn() }),
  useOptionalNuniSession: () => null,
}));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => ({ google: false, studentId: false, loading: false, retry: vi.fn() }),
}));
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
  expect(screen.getByText('這堂課已有進行中的點名，開啟新場次會先結束舊場。')).toBeTruthy();
});

it('shows a student only one check-in box when two sessions of the same course are still open', async () => {
  vi.mocked(loadCourseAttendance).mockResolvedValue({
    ...data(),
    sessions: [
      {
        id: 'session-a',
        teacherId: 'teacher-a',
        active: false,
        startedAt: '2026-10-16T01:00:00Z',
        endedAt: '2026-10-16T01:20:00Z',
        qrExpiresAt: '2026-10-16T01:10:00Z',
        attendeeCount: 0,
        ownRecord: null,
      },
      {
        id: 'session-b',
        teacherId: 'teacher-b',
        active: true,
        startedAt: '2026-10-16T02:00:00Z',
        endedAt: null,
        qrExpiresAt: '2026-10-16T02:10:00Z',
        attendeeCount: 0,
        ownRecord: null,
      },
      {
        id: 'session-c',
        teacherId: 'teacher-c',
        active: true,
        startedAt: '2026-10-16T01:30:00Z',
        endedAt: null,
        qrExpiresAt: '2026-10-16T01:40:00Z',
        attendeeCount: 0,
        ownRecord: null,
      },
    ],
  });
  render(<CourseAttendance courseId="course" />);
  expect(await screen.findByLabelText('教師提供的簽到碼')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '確認簽到' })).toHaveLength(1);
  expect(screen.getByLabelText('教師提供的簽到碼').id).toBe('code-session-b');
  expect(document.getElementById('code-session-c')).toBeNull();
  expect(screen.getByText('資料結構 · 點名進行中')).toBeTruthy();
  expect(screen.getByText('資料結構 · 點名已結束')).toBeTruthy();
});

it('keeps the teacher route and school context when returning to the course or signing in', () => {
  auth.uid = null;
  const school = { school: 'PU', schoolId: 'providence-university' };
  const { schoolSearch } = resolveSchoolPageContext(school);
  render(<CourseAttendance courseId="course/id" audience="teacher" searchParams={school} />);
  expect(screen.getByRole('link', { name: '回課程工作台' }).getAttribute('href')).toBe(
    `/teacher/course/course%2Fid${schoolSearch}`,
  );
  expect(screen.getByRole('heading', { name: '這個功能還沒接通' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1, name: '點名' })).toBeTruthy();
  expect(screen.queryByText('靜宜大學')).toBeNull();
  expect(screen.getByText('出缺席請先在課堂上向老師確認。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '登入帳號' })).toBeNull();
  expect(screen.getByRole('main').id).toBe('page-content');
});

it('filters the verified teacher roster by student name or ID without including unmatched rows', async () => {
  auth.uid = 'teacher';
  vi.mocked(loadCourseAttendance).mockResolvedValue(data(true));
  vi.mocked(loadAttendanceRecords).mockResolvedValue([
    { uid: 'alice', displayName: '學生甲', studentId: 'S001', checkedInAt: '2026-10-07T01:02:00Z' },
    { uid: 'bob', displayName: '學生乙', studentId: 'S002', checkedInAt: '2026-10-07T01:03:00Z' },
  ]);
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看簽到名單' }));
  expect(await screen.findByText('學生甲')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜尋簽到學生'), { target: { value: 'S002' } });
  expect(screen.queryByText('學生甲')).toBeNull();
  expect(screen.getByText('學生乙')).toBeTruthy();
  expect(screen.getByText('1 / 2 筆')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜尋簽到學生'), { target: { value: '找不到' } });
  expect(screen.getByText('沒有符合搜尋條件的學生。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '匯出目前名單' }).hasAttribute('disabled')).toBe(true);
});

it('filters sessions without exposing an extra student check-in box', async () => {
  vi.mocked(loadCourseAttendance).mockResolvedValue({
    ...data(),
    sessions: [
      data().sessions[0],
      {
        ...data().sessions[0],
        id: 'ended',
        active: false,
        teacherId: 'teacher',
        endedAt: '2026-10-07T01:30:00Z',
      },
    ],
  });
  render(<CourseAttendance courseId="course" />);
  expect(await screen.findByRole('group', { name: '篩選點名紀錄' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '已結束' }));
  expect(screen.queryByLabelText('教師提供的簽到碼')).toBeNull();
  expect(screen.getByRole('button', { name: '已結束' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '進行中' }));
  expect(screen.getByLabelText('教師提供的簽到碼')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '確認簽到' })).toHaveLength(1);
});

it('does not reveal a teacher QR after the server-side expiry window', async () => {
  auth.uid = 'teacher';
  vi.mocked(loadCourseAttendance).mockResolvedValue(data(true));
  vi.mocked(loadAttendanceCode).mockResolvedValue('secret-must-not-show');
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '顯示簽到碼' }));
  await screen.findByRole('alert');
  expect(loadAttendanceCode).toHaveBeenCalledWith('course', 'session');
  expect(screen.queryByText('secret-must-not-show')).toBeNull();
  expect(screen.queryByAltText('本次課堂簽到 QR Code')).toBeNull();
});

it('labels manually corrected attendance as an instructor decision, not an instant QR check-in', async () => {
  const saved = data();
  saved.sessions[0].ownStatus = 'present';
  saved.sessions[0].ownRecord = {
    uid: 'student',
    displayName: '學生乙',
    studentId: 'S027',
    checkedInAt: '2026-10-27T01:00:00.000Z',
    status: 'present',
    source: 'manual',
    correctedAt: '2026-10-27T04:00:00.000Z',
  };
  vi.mocked(loadCourseAttendance).mockResolvedValue(saved);
  render(<CourseAttendance courseId="course" />);
  expect(await screen.findByText(/教師已補登出席 · 核定/)).toBeTruthy();
  expect(screen.queryByLabelText('教師提供的簽到碼')).toBeNull();
});
