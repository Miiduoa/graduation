import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceQrScanner } from './AttendanceQrScanner';
import { startAttendanceCamera } from '@/lib/attendanceCamera';

vi.mock('@/lib/attendanceCamera', () => ({ startAttendanceCamera: vi.fn() }));
const stop = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.mocked(startAttendanceCamera).mockReturnValue(stop); });
it('does not request a camera until the student presses the scan button', () => {
  render(<AttendanceQrScanner groupId="course" sessionId="session" onToken={vi.fn()} />);
  expect(startAttendanceCamera).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  expect(startAttendanceCamera).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '關閉相機' })).toBeTruthy();
});
it('fills a matching code but neither submits the form nor reports attendance success', () => {
  const onToken = vi.fn();
  const submitted = vi.fn();
  render(<form onSubmit={submitted}><AttendanceQrScanner groupId="course" sessionId="session" onToken={onToken} /></form>);
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  act(() => vi.mocked(startAttendanceCamera).mock.calls[0][0].onDetected('validated-token'));
  expect(onToken).toHaveBeenCalledExactlyOnceWith('validated-token');
  expect(submitted).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toContain('請按「確認簽到」');
  expect(screen.queryByText('已完成簽到')).toBeNull();
});
it('releases the camera when the user cancels or leaves the page', () => {
  const view = render(<AttendanceQrScanner groupId="course" sessionId="session" onToken={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  fireEvent.click(screen.getByRole('button', { name: '關閉相機' }));
  expect(stop).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(2);
});
it('closes a camera before changing course, attendance session or submitting', () => {
  const onToken = vi.fn();
  const view = render(<AttendanceQrScanner groupId="course" sessionId="session" onToken={onToken} />);
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  view.rerender(<AttendanceQrScanner groupId="other" sessionId="session" onToken={onToken} />);
  expect(stop).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  view.rerender(<AttendanceQrScanner groupId="other" sessionId="session" onToken={onToken} disabled />);
  expect(stop).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '開啟相機掃碼' }).hasAttribute('disabled')).toBe(true);
});
it('allows retrying after a permission error without turning it into attendance success', () => {
  const onToken = vi.fn();
  render(<AttendanceQrScanner groupId="course" sessionId="session" onToken={onToken} />);
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  act(() => vi.mocked(startAttendanceCamera).mock.calls[0][0].onError('請允許相機或輸入簽到碼。'));
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '開啟相機掃碼' }));
  expect(startAttendanceCamera).toHaveBeenCalledTimes(2);
  expect(onToken).not.toHaveBeenCalled();
});
