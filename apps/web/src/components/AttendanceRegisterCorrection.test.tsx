import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceCorrectionPanel } from './AttendanceCorrectionPanel';
import { correctCourseAttendance, loadAttendanceCorrections, loadCourseAttendanceRoster } from '@/lib/courseAttendance';
import { loadAttendanceRegister } from '@/lib/loadAttendanceRegister';

vi.mock('@/lib/courseAttendance', () => ({
  attendanceError: () => '無法核實',
  correctCourseAttendance: vi.fn(), loadAttendanceCorrections: vi.fn(), loadCourseAttendanceRoster: vi.fn(),
}));
vi.mock('@/lib/loadAttendanceRegister', () => ({ loadAttendanceRegister: vi.fn() }));
const students = Array.from({ length: 91 }, (_, index) => ({
  uid: `s${index}`, displayName: `學生${index}`, studentId: `S${index}`,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCourseAttendanceRoster).mockResolvedValue(students);
  vi.mocked(loadAttendanceCorrections).mockResolvedValue([]);
  vi.mocked(correctCourseAttendance).mockResolvedValue({ success: true, reused: false, status: 'present' });
  vi.mocked(loadAttendanceRegister).mockResolvedValue({
    rows: students.map((student) => ({ ...student, status: 'unconfirmed', source: null, checkedInAt: null, correctedAt: null })),
    complete: true, active: false, checkedAt: '2026-10-27T02:00:00Z',
  });
});
it('opens the exact student beyond the old 80-option limit without writing until confirmed', async () => {
  render(<AttendanceCorrectionPanel courseId="course" sessionId="session" onUpdated={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole('button', { name: '查看全班名冊' }));
  await screen.findByText('學生0');
  fireEvent.change(screen.getByLabelText('搜尋全班名冊'), { target: { value: 'S90' } });
  fireEvent.click(screen.getByRole('button', { name: '更正 學生90 S90' }));
  const select = await screen.findByLabelText('選擇學生') as HTMLSelectElement;
  expect(select.value).toBe('s90');
  expect(screen.getByRole('option', { name: '學生90（S90）' })).toBeTruthy();
  expect(correctCourseAttendance).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('更正原因'), { target: { value: '授課教師現場核對出席' } });
  fireEvent.click(screen.getByRole('button', { name: '確認並保存更正' }));
  await waitFor(() => expect(correctCourseAttendance).toHaveBeenCalledWith(expect.objectContaining({ studentUid: 's90' })));
  await waitFor(() => expect(loadAttendanceRegister).toHaveBeenCalledTimes(2));
});
it('does not keep a student selected after their enrollment disappears during the transition', async () => {
  vi.mocked(loadCourseAttendanceRoster).mockResolvedValueOnce(students.slice(1));
  render(<AttendanceCorrectionPanel courseId="course" sessionId="session" onUpdated={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '查看全班名冊' }));
  await screen.findByText('學生0');
  fireEvent.click(screen.getByRole('button', { name: '更正 學生0 S0' }));
  const select = await screen.findByLabelText('選擇學生') as HTMLSelectElement;
  expect(select.value).toBe('');
  expect(screen.getByRole('button', { name: '確認並保存更正' }).hasAttribute('disabled')).toBe(true);
  expect(correctCourseAttendance).not.toHaveBeenCalled();
});
