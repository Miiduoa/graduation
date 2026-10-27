import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CourseAttendance } from './CourseAttendance';
import { startAttendanceCamera } from '@/lib/attendanceCamera';
import { joinCourseAttendance, loadCourseAttendance, watchCourseMembership,
  type CourseAttendance as AttendanceData } from '@/lib/courseAttendance';

vi.mock('./AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'student' }, loading: false }) }));
vi.mock('./SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('./SchoolAccountRequired', () => ({ SchoolAccountRequired: () => null }));
vi.mock('./AttendanceCorrectionPanel', () => ({ AttendanceCorrectionPanel: () => null }));
vi.mock('@/lib/pageContext', () => ({ resolveSchoolPageContext: () => ({ schoolSearch: '' }) }));
vi.mock('@/lib/attendanceCamera', () => ({ startAttendanceCamera: vi.fn() }));
vi.mock('@/lib/courseAttendance', async (original) => ({
  ...(await original<typeof import('@/lib/courseAttendance')>()),
  loadCourseAttendance: vi.fn(), joinCourseAttendance: vi.fn(), watchCourseMembership: vi.fn(),
}));
const data: AttendanceData = {
  courseId: 'course', courseName: '資料結構', canStart: false, canReadRoster: false,
  sessions: [{ id: 'session', active: true, teacherId: 'teacher',
    startedAt: '2026-10-27T01:00:00Z', endedAt: null, qrExpiresAt: '2099-01-01T00:00:00Z',
    attendeeCount: 0, ownRecord: null }],
};
const stop = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startAttendanceCamera).mockReturnValue(stop);
  vi.mocked(loadCourseAttendance).mockResolvedValue(data);
  vi.mocked(watchCourseMembership).mockImplementation((_course, _uid, changed) => {
    changed('member'); return () => {};
  });
});
it('scans into the actual course form, requires confirmation, and waits for the server receipt', async () => {
  let resolve!: (value: { success: boolean; checkedInAt: string; alreadyJoined: boolean }) => void;
  vi.mocked(joinCourseAttendance).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '開啟相機掃碼' }));
  const camera = vi.mocked(startAttendanceCamera).mock.calls[0][0];
  expect(camera.groupId).toBe('course');
  expect(camera.sessionId).toBe('session');
  act(() => camera.onDetected('camera-token'));
  expect((screen.getByLabelText('教師提供的簽到碼') as HTMLInputElement).value).toBe('camera-token');
  expect(joinCourseAttendance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '確認簽到' }));
  expect(joinCourseAttendance).toHaveBeenCalledExactlyOnceWith('course', 'session', 'camera-token');
  expect(screen.queryByText(/已簽到 ·/)).toBeNull();
  await act(async () => resolve({ success: true, checkedInAt: '2026-10-27T01:02:00Z', alreadyJoined: false }));
  expect(await screen.findByText(/已簽到 ·/)).toBeTruthy();
});
it('keeps a scanned token retryable when the server does not confirm attendance', async () => {
  vi.mocked(joinCourseAttendance).mockRejectedValueOnce({ code: 'functions/permission-denied' });
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '開啟相機掃碼' }));
  act(() => vi.mocked(startAttendanceCamera).mock.calls[0][0].onDetected('camera-token'));
  fireEvent.click(screen.getByRole('button', { name: '確認簽到' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/已簽到 ·/)).toBeNull();
  expect((screen.getByLabelText('教師提供的簽到碼') as HTMLInputElement).value).toBe('camera-token');
});
it('releases the active camera when course membership is revoked', async () => {
  let change!: Parameters<typeof watchCourseMembership>[2];
  vi.mocked(watchCourseMembership).mockImplementation((_course, _uid, changed) => {
    change = changed; changed('member'); return () => {};
  });
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '開啟相機掃碼' }));
  act(() => change(null));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '開啟相機掃碼' })).toBeNull();
  expect(joinCourseAttendance).not.toHaveBeenCalled();
});

vi.mock('@/lib/watchAttendanceLive', () => ({
  watchAttendanceLive: (options: { onState: (state: 'live') => void }) => {
    options.onState('live'); return () => {};
  },
}));
