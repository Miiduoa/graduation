import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { CourseAttendance } from './CourseAttendance';
import { endCourseAttendance, loadAttendanceCode, loadCourseAttendance, type CourseAttendance as Data } from '@/lib/courseAttendance';

const state = vi.hoisted(() => ({
  uid: 'teacher',
  access: null as null | ((role: string | null) => void),
  sessions: null as null | ((sessions: Data['sessions']) => void),
}));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('./AuthGuard', () => ({ useAuth: () => ({ user: { uid: state.uid }, loading: false }) }));
vi.mock('./SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('./SchoolAccountRequired', () => ({ SchoolAccountRequired: () => null }));
vi.mock('./AttendanceCorrectionPanel', () => ({ AttendanceCorrectionPanel: () => <p>僅教師可見的更正工作區</p> }));
vi.mock('./AttendanceQrScanner', () => ({ AttendanceQrScanner: () => null }));
vi.mock('./AttendanceSyncStatus', () => ({ AttendanceSyncStatus: () => null }));
vi.mock('@/lib/pageContext', () => ({ resolveSchoolPageContext: () => ({ schoolSearch: '' }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }));
vi.mock('@/lib/watchAttendanceLive', () => ({
  watchAttendanceLive: (options: { onState: (state: string) => void; onSessions: (sessions: Data['sessions']) => void }) => {
    state.sessions = options.onSessions; options.onState('live'); return () => {};
  },
}));
vi.mock('@/lib/courseAttendance', () => ({
  loadCourseAttendance: vi.fn(), loadAttendanceCode: vi.fn(), endCourseAttendance: vi.fn(),
  loadAttendanceRecords: vi.fn(), startCourseAttendance: vi.fn(), joinCourseAttendance: vi.fn(),
  attendanceCsv: () => '', attendanceError: () => '請重新確認課堂',
  hasOwnActiveAttendance: () => true,
  studentAttendanceHeading: (name: string) => name,
  studentCheckInSession: (sessions: Data['sessions']) => sessions.find((row) => row.active),
  watchCourseMembership: (_course: string, _uid: string, change: (role: string | null) => void) => {
    state.access = change; change(state.uid === 'teacher' ? 'instructor' : 'member'); return () => {};
  },
}));
function data(teacher = true): Data {
  return { courseId: 'course', courseName: '資料結構', canStart: teacher, canReadRoster: teacher,
    sessions: [{ id: 'session', teacherId: 'teacher', active: true,
      startedAt: new Date().toISOString(), endedAt: null,
      qrExpiresAt: new Date(Date.now() + 600_000).toISOString(), attendeeCount: 23, ownRecord: null }] };
}
beforeEach(() => {
  vi.resetAllMocks(); state.uid = 'teacher'; state.access = null; state.sessions = null;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(loadCourseAttendance).mockResolvedValue(data());
  vi.mocked(loadAttendanceCode).mockResolvedValue('server-issued-classroom-token');
  vi.mocked(QRCode.toDataURL).mockResolvedValue('data:image/png;base64,QUJDRA==');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
    value: function(this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function showQr() {
  fireEvent.click(await screen.findByRole('button', { name: '顯示簽到碼' }));
  await screen.findByAltText('本次課堂簽到 QR Code');
}
it('uses a high-resolution existing server token and presents no roster in the dialog', async () => {
  render(<CourseAttendance courseId="course" audience="teacher" />); await showQr();
  expect(QRCode.toDataURL).toHaveBeenCalledWith(JSON.stringify({ groupId: 'course', sessionId: 'session', qrToken: 'server-issued-classroom-token' }),
    { width: 768, margin: 4, errorCorrectionLevel: 'M' });
  fireEvent.click(screen.getByRole('button', { name: '放大投影 QR Code' }));
  const projection = screen.getByRole('dialog', { name: '資料結構' });
  expect(within(projection).queryByText('僅教師可見的更正工作區')).toBeNull();
  expect(within(projection).queryByText('server-issued-classroom-token')).toBeNull();
  act(() => state.sessions?.([{ ...data().sessions[0], attendeeCount: 25 }]));
  expect(within(projection).getByText('25')).toBeTruthy();
  fireEvent.click(within(projection).getByRole('button', { name: '結束投影' }));
  expect(endCourseAttendance).not.toHaveBeenCalled();
});
it('discards a QR lookup that crossed a background transition even after the page returns', async () => {
  let finish!: (value: string) => void;
  vi.mocked(loadAttendanceCode).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '顯示簽到碼' }));
  visibility.mockReturnValue('hidden'); act(() => document.dispatchEvent(new Event('visibilitychange')));
  visibility.mockReturnValue('visible'); act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => finish('late-token'));
  expect(screen.queryByText('late-token')).toBeNull(); expect(QRCode.toDataURL).not.toHaveBeenCalled();
});
it('discards a late image encoder result after the page is hidden', async () => {
  let finish!: (value: string) => void;
  vi.mocked(QRCode.toDataURL).mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
  render(<CourseAttendance courseId="course" />);
  fireEvent.click(await screen.findByRole('button', { name: '顯示簽到碼' }));
  await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalled());
  act(() => window.dispatchEvent(new Event('pagehide')));
  await act(async () => finish('data:image/png;base64,QUJDRA=='));
  expect(screen.queryByAltText('本次課堂簽到 QR Code')).toBeNull();
});
it('hides projected and inline credentials when instructor permission is revoked', async () => {
  render(<CourseAttendance courseId="course" />); await showQr();
  fireEvent.click(screen.getByRole('button', { name: '放大投影 QR Code' }));
  act(() => state.access?.(null));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('server-issued-classroom-token')).toBeNull();
});
it('removes the projected QR when the teacher ends the session elsewhere', async () => {
  render(<CourseAttendance courseId="course" />); await showQr();
  fireEvent.click(screen.getByRole('button', { name: '放大投影 QR Code' }));
  act(() => state.sessions?.([{ ...data().sessions[0], active: false }]));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByAltText('本次課堂簽到 QR Code')).toBeNull();
});
it('does not expose instructor presentation controls to students', async () => {
  state.uid = 'student'; vi.mocked(loadCourseAttendance).mockResolvedValue(data(false));
  render(<CourseAttendance courseId="course" />);
  await screen.findByLabelText('教師提供的簽到碼');
  expect(screen.queryByRole('button', { name: '顯示簽到碼' })).toBeNull();
  expect(loadAttendanceCode).not.toHaveBeenCalled();
});
