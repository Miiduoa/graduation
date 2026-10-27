import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceCorrectionPanel } from './AttendanceCorrectionPanel';
import {
  correctCourseAttendance,
  loadAttendanceCorrections,
  loadCourseAttendanceRoster,
} from '@/lib/courseAttendance';

vi.mock('@/lib/courseAttendance', () => ({
  attendanceError: (error: unknown) => error instanceof Error ? error.message : '錯誤',
  correctCourseAttendance: vi.fn(),
  loadAttendanceCorrections: vi.fn(),
  loadCourseAttendanceRoster: vi.fn(),
}));

const roster = [
  { uid: 'student-one', displayName: '學生甲', studentId: 'S001' },
  { uid: 'student-two', displayName: '學生乙', studentId: 'S002' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCourseAttendanceRoster).mockResolvedValue(roster);
  vi.mocked(loadAttendanceCorrections).mockResolvedValue([]);
  vi.mocked(correctCourseAttendance).mockResolvedValue({ success: true, reused: false, status: 'late' });
});

it('requires a confirmed roster and explicit reason for an instructor to correct a student', async () => {
  const updated = vi.fn().mockResolvedValue(undefined);
  render(<AttendanceCorrectionPanel courseId="class-a" sessionId="session-a" onUpdated={updated} />);
  expect(screen.queryByLabelText('選擇學生')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '管理出席更正' }));
  expect(await screen.findByLabelText('選擇學生')).toBeTruthy();
  expect(screen.getByRole('button', { name: '確認並保存更正' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('選擇學生'), { target: { value: 'student-two' } });
  fireEvent.change(screen.getByLabelText('核定狀態'), { target: { value: 'late' } });
  fireEvent.change(screen.getByLabelText('更正原因'), {
    target: { value: '教師已經核對學生的遲到時間' },
  });
  fireEvent.click(screen.getByRole('button', { name: '確認並保存更正' }));
  await waitFor(() => expect(correctCourseAttendance).toHaveBeenCalledTimes(1));
  expect(correctCourseAttendance).toHaveBeenCalledWith(expect.objectContaining({
    groupId: 'class-a',
    sessionId: 'session-a',
    studentUid: 'student-two',
    status: 'late',
    reason: '教師已經核對學生的遲到時間',
    requestId: expect.any(String),
  }));
  await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('已保存更正，並建立操作稽核紀錄。')).toBeTruthy();
});

it('retries an ambiguous correction with the same idempotency key', async () => {
  vi.mocked(correctCourseAttendance)
    .mockRejectedValueOnce(new Error('網路暫時無法使用'))
    .mockResolvedValueOnce({ success: true, reused: true, status: 'absent' });
  render(<AttendanceCorrectionPanel courseId="class-a" sessionId="session-a" onUpdated={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole('button', { name: '管理出席更正' }));
  await screen.findByLabelText('更正原因');
  fireEvent.change(screen.getByLabelText('更正原因'), { target: { value: '授課老師已確認沒有出席' } });
  fireEvent.click(screen.getByRole('button', { name: '確認並保存更正' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '確認並保存更正' }));
  await waitFor(() => expect(correctCourseAttendance).toHaveBeenCalledTimes(2));
  const attempts = vi.mocked(correctCourseAttendance).mock.calls;
  expect(attempts[0][0].requestId).toBe(attempts[1][0].requestId);
  expect(await screen.findByText('這筆更正已保存，已確認先前操作結果。')).toBeTruthy();
});

it('does not display a teacher correction form when roster access is denied', async () => {
  vi.mocked(loadCourseAttendanceRoster).mockRejectedValueOnce(new Error('沒有教師權限'));
  render(<AttendanceCorrectionPanel courseId="class-a" sessionId="session-a" onUpdated={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '管理出席更正' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByLabelText('選擇學生')).toBeNull();
  expect(correctCourseAttendance).not.toHaveBeenCalled();
});
