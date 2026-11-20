import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceRegisterPanel } from './AttendanceRegisterPanel';
import { loadAttendanceRegister } from '@/lib/loadAttendanceRegister';
import type { AttendanceRegister, RegisterRow } from '@/lib/attendanceRegister';

vi.mock('@/lib/loadAttendanceRegister', () => ({ loadAttendanceRegister: vi.fn() }));
vi.mock('@/lib/courseAttendance', () => ({ attendanceError: () => '請檢查權限後重試。' }));
const row = (uid: string, status: RegisterRow['status']): RegisterRow => ({
  uid, displayName: `學生${uid}`, studentId: `S${uid}`, status, source: null, checkedInAt: null, correctedAt: null,
});
const snapshot: AttendanceRegister = {
  rows: [row('1', 'present'), row('2', 'unconfirmed'), row('3', 'absent')],
  complete: true, active: false, checkedAt: '2026-10-27T02:00:00Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAttendanceRegister).mockResolvedValue(snapshot);
});
it('reads only when opened, filters the whole class and routes the chosen student to correction', async () => {
  const correct = vi.fn();
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={correct} />);
  expect(loadAttendanceRegister).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查看全班名冊' }));
  await screen.findByText('學生2');
  const filters = screen.getByRole('group', { name: '篩選全班出席狀態' });
  fireEvent.click(within(filters).getByRole('button', { name: /尚無紀錄/ }));
  expect(screen.queryByText('學生1')).toBeNull();
  expect(screen.getByText('學生2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更正 學生2 S2' }));
  expect(correct).toHaveBeenCalledWith('2');
});
it('pages the visible roster without reading the database again', async () => {
  vi.mocked(loadAttendanceRegister).mockResolvedValueOnce({ ...snapshot, rows: Array.from({ length: 35 }, (_, index) => row(String(index), 'unconfirmed')) });
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '查看全班名冊' }));
  const list = await screen.findByRole('list', { name: '學生出席明細' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(30);
  fireEvent.click(screen.getByRole('button', { name: '顯示更多學生（剩餘 5 人）' }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(35);
  expect(loadAttendanceRegister).toHaveBeenCalledTimes(1);
});
it('does not allow incomplete snapshots to be exported or unavailable rows to be corrected', async () => {
  vi.mocked(loadAttendanceRegister).mockResolvedValueOnce({ ...snapshot, complete: false, rows: [row('1', 'unavailable')] });
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '查看全班名冊' }));
  await screen.findByText('學生1');
  expect(screen.getByRole('button', { name: '匯出篩選名冊' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '更正 學生1 S1' }).hasAttribute('disabled')).toBe(true);
});
it('removes failed data and supports an explicit server retry', async () => {
  vi.mocked(loadAttendanceRegister).mockRejectedValueOnce(new Error('offline'));
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '查看全班名冊' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('list', { name: '學生出席明細' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取名冊' }));
  expect(await screen.findByText('學生1')).toBeTruthy();
});
it('discards a late response from a previous course', async () => {
  let resolveOld!: (value: AttendanceRegister) => void;
  vi.mocked(loadAttendanceRegister).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  const view = render(<AttendanceRegisterPanel courseId="old" sessionId="session" onCorrect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '查看全班名冊' }));
  vi.mocked(loadAttendanceRegister).mockResolvedValueOnce({ ...snapshot, rows: [row('new', 'late')] });
  view.rerender(<AttendanceRegisterPanel courseId="new" sessionId="session" onCorrect={vi.fn()} />);
  await screen.findByText('學生new');
  await act(async () => resolveOld(snapshot));
  expect(screen.queryByText('學生1')).toBeNull();
  expect(screen.getByText('學生new')).toBeTruthy();
});
it('refreshes confirmed corrections without resetting the active search', async () => {
  const correct = vi.fn();
  const view = render(<AttendanceRegisterPanel courseId="course" sessionId="session" revision={0} onCorrect={correct} />);
  fireEvent.click(screen.getByRole('button', { name: '查看全班名冊' }));
  await screen.findByText('學生1');
  fireEvent.change(screen.getByLabelText('搜尋全班名冊'), { target: { value: 'S2' } });
  view.rerender(<AttendanceRegisterPanel courseId="course" sessionId="session" revision={1} onCorrect={correct} />);
  await screen.findByText('學生2');
  expect(screen.queryByText('學生1')).toBeNull();
  expect(loadAttendanceRegister).toHaveBeenCalledTimes(2);
});
