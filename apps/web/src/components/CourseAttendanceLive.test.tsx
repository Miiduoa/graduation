import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CourseAttendance } from './CourseAttendance';
import { joinCourseAttendance, loadCourseAttendance, watchCourseMembership, type CourseAttendance as Data, type AttendanceSession } from '@/lib/courseAttendance';
import { watchAttendanceLive, type AttendanceLiveOptions } from '@/lib/watchAttendanceLive';
import { startAttendanceCamera } from '@/lib/attendanceCamera';

const user = vi.hoisted(() => ({ uid: 'student' }));
vi.mock('./AuthGuard', () => ({ useAuth: () => ({ user: { uid: user.uid }, loading: false }) }));
vi.mock('./SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('./SchoolAccountRequired', () => ({ SchoolAccountRequired: () => null }));
vi.mock('./AttendanceCorrectionPanel', () => ({ AttendanceCorrectionPanel: () => <div>教師更正表單</div> }));
vi.mock('@/lib/pageContext', () => ({ resolveSchoolPageContext: () => ({ schoolSearch: '' }) }));
vi.mock('@/lib/watchAttendanceLive', () => ({ watchAttendanceLive: vi.fn() }));
vi.mock('@/lib/attendanceCamera', () => ({ startAttendanceCamera: vi.fn() }));
vi.mock('@/lib/courseAttendance', async (original) => ({
  ...(await original<typeof import('@/lib/courseAttendance')>()),
  loadCourseAttendance: vi.fn(), watchCourseMembership: vi.fn(), joinCourseAttendance: vi.fn(),
}));
let active: AttendanceLiveOptions;
let membership: (role: string | null) => void;
const stop = vi.fn(); const stopCamera = vi.fn();
const session = (patch: Partial<AttendanceSession> = {}): AttendanceSession => ({
  id: 'session', teacherId: 'teacher', active: true, startedAt: '2026-10-27T01:00:00Z',
  endedAt: null, qrExpiresAt: '2099-01-01T00:00:00Z', attendeeCount: 0, ownRecord: null, ...patch,
});
const data = (rows: AttendanceSession[] = []): Data => ({
  courseId: 'course', courseName: '資料結構', canStart: false, canReadRoster: false, sessions: rows,
});
function publish(rows: AttendanceSession[]) { act(() => { active.onSessions(rows); active.onState('live'); }); }
beforeEach(() => {
  vi.clearAllMocks(); user.uid = 'student';
  vi.mocked(loadCourseAttendance).mockResolvedValue(data());
  vi.mocked(startAttendanceCamera).mockReturnValue(stopCamera);
  vi.mocked(watchCourseMembership).mockImplementation((_course, _uid, next) => {
    membership = next; next('member'); return () => {};
  });
  vi.mocked(watchAttendanceLive).mockImplementation((options) => {
    active = options; options.onState('connecting'); return stop;
  });
});
it('automatically shows a newly started session without reloading history', async () => {
  render(<CourseAttendance courseId="course" />);
  await screen.findByText('正在核對課堂最新狀態');
  expect(screen.queryByLabelText('教師提供的簽到碼')).toBeNull();
  publish([]); expect(screen.getByText('還沒有點名紀錄')).toBeTruthy();
  publish([session()]);
  expect(screen.getByLabelText('教師提供的簽到碼')).toBeTruthy();
  expect(loadCourseAttendance).toHaveBeenCalledTimes(1);
});
it('closes the active camera when the teacher ends the session remotely', async () => {
  render(<CourseAttendance courseId="course" />); await screen.findByText('正在核對課堂最新狀態');
  publish([session()]); fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  publish([session({ active: false, endedAt: '2026-10-27T01:10:00Z' })]);
  expect(stopCamera).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '確認簽到' })).toBeNull();
});
it('removes signatures and camera while offline, without fabricating a saved receipt', async () => {
  render(<CourseAttendance courseId="course" />); await screen.findByText('正在核對課堂最新狀態');
  publish([session()]); fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  act(() => active.onState('offline'));
  expect(stopCamera).toHaveBeenCalledTimes(1);
  expect(screen.getByText('目前離線，尚未確認出席狀態')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '確認簽到' })).toBeNull();
  expect(screen.queryByText(/已簽到 ·/)).toBeNull();
});
it('updates the student after an instructor correction with no manual refresh', async () => {
  render(<CourseAttendance courseId="course" />); await screen.findByText('正在核對課堂最新狀態');
  publish([session()]); publish([session({ active: false, ownStatus: 'excused' })]);
  expect(screen.getByText('本次課堂已登記請假。')).toBeTruthy();
  expect(loadCourseAttendance).toHaveBeenCalledTimes(1);
});
it('ignores an earlier manual load once a newer live session has arrived', async () => {
  render(<CourseAttendance courseId="course" />); await screen.findByText('正在核對課堂最新狀態'); publish([]);
  let finish!: (result: Data) => void;
  vi.mocked(loadCourseAttendance).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '更新紀錄' }));
  await waitFor(() => expect(watchAttendanceLive).toHaveBeenCalledTimes(2));
  publish([session()]); await act(async () => finish(data()));
  expect(screen.getByLabelText('教師提供的簽到碼')).toBeTruthy();
});
it('does not revive a revoked course via a late subscription callback', async () => {
  render(<CourseAttendance courseId="course" />); await screen.findByText('正在核對課堂最新狀態');
  publish([session()]); const old = active;
  act(() => membership(null));
  act(() => { old.onSessions([session()]); old.onState('live'); });
  expect(screen.queryByLabelText('教師提供的簽到碼')).toBeNull();
  expect(stop).toHaveBeenCalled();
});
it('keeps errors recoverable through the existing refresh action', async () => {
  render(<CourseAttendance courseId="course" />); await screen.findByText('正在核對課堂最新狀態');
  act(() => active.onState('error')); expect(screen.getByText('課堂同步暫時中斷')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更新紀錄' }));
  await waitFor(() => expect(watchAttendanceLive).toHaveBeenCalledTimes(2));
  publish([session()]); expect(screen.getByLabelText('教師提供的簽到碼')).toBeTruthy();
});
it('updates teacher counts without reading the complete class register', async () => {
  user.uid = 'teacher'; vi.mocked(loadCourseAttendance).mockResolvedValue({ ...data(), canStart: true, canReadRoster: true });
  render(<CourseAttendance courseId="course" audience="teacher" />); await screen.findByText('正在核對課堂最新狀態');
  expect(active.canReadRoster).toBe(true);
  publish([session({ attendeeCount: 40 })]);
  expect(screen.getAllByText('40')).toHaveLength(2);
  expect(screen.getByText('點名場次與人數自動更新；詳細名冊仍以各次查核時間為準。')).toBeTruthy();
  expect(loadCourseAttendance).toHaveBeenCalledTimes(1);
});

it('does not let a late successful submit hide a newer teacher-confirmed absence', async () => {
  let finish!: (result: { success: boolean; checkedInAt: string; alreadyJoined: boolean }) => void;
  vi.mocked(joinCourseAttendance).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<CourseAttendance courseId="course" />); await screen.findByText('正在核對課堂最新狀態');
  publish([session()]);
  fireEvent.change(screen.getByLabelText('教師提供的簽到碼'), { target: { value: 'teacher-code' } });
  fireEvent.click(screen.getByRole('button', { name: '確認簽到' }));
  publish([session({ active: false, ownStatus: 'absent' })]);
  vi.mocked(loadCourseAttendance).mockResolvedValueOnce(data([session({ active: false, ownStatus: 'absent' })]));
  await act(async () => finish({ success: true, checkedInAt: '2026-10-27T01:02:00Z', alreadyJoined: false }));
  expect(screen.getByText('教師已登記本次缺席。如需更正，請聯絡授課教師。')).toBeTruthy();
  expect(screen.queryByText(/已簽到 ·/)).toBeNull();
});
it('restarts monitoring for a changed teacher role even when roster capabilities are unchanged', async () => {
  user.uid = 'teacher';
  vi.mocked(loadCourseAttendance).mockResolvedValue({ ...data(), canStart: true, canReadRoster: true });
  render(<CourseAttendance courseId="course" />); await screen.findByText('正在核對課堂最新狀態');
  publish([]); const old = active;
  await act(async () => membership('instructor'));
  await waitFor(() => expect(watchAttendanceLive).toHaveBeenCalledTimes(2));
  act(() => { old.onSessions([session({ attendeeCount: 99 })]); old.onState('live'); });
  expect(screen.queryByText('99')).toBeNull();
  publish([session({ attendeeCount: 2 })]);
  expect(screen.getByText('課堂狀態已連線')).toBeTruthy();
});
