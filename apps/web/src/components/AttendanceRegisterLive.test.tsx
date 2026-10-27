import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceRegisterPanel } from './AttendanceRegisterPanel';
import { loadAttendanceRegister } from '@/lib/loadAttendanceRegister';
import { watchAttendanceRegister, type LiveAttendanceRegister } from '@/lib/watchAttendanceRegister';

vi.mock('@/lib/courseAttendance', () => ({ attendanceError: () => '請確認連線與授課資格。' }));
vi.mock('@/lib/loadAttendanceRegister', () => ({ loadAttendanceRegister: vi.fn() }));
vi.mock('@/lib/watchAttendanceRegister', () => ({ watchAttendanceRegister: vi.fn() }));
const stop = vi.fn();
const register: LiveAttendanceRegister = {
  rows: [
    { uid: 'one', displayName: '學生甲', studentId: 'S001', status: 'unconfirmed', source: null, checkedInAt: null, correctedAt: null },
    { uid: 'two', displayName: '學生乙', studentId: 'S002', status: 'unconfirmed', source: null, checkedInAt: null, correctedAt: null },
  ],
  complete: true, membersComplete: true, receiptsComplete: true,
  checkedAt: '2026-10-28T01:00:00Z', active: true,
};
function emit(data = register) {
  const options = vi.mocked(watchAttendanceRegister).mock.lastCall?.[0];
  if (!options) throw new Error('No live subscription');
  act(() => { options.onData(data); options.onState('live'); });
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '查看全班名冊' }));
  await screen.findByText('學生甲');
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAttendanceRegister).mockResolvedValue(register);
  vi.mocked(watchAttendanceRegister).mockReturnValue(stop);
});
it('preserves manual mode by default and subscribes only after a deliberate opt-in', async () => {
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
  expect(loadAttendanceRegister).not.toHaveBeenCalled();
  expect(watchAttendanceRegister).not.toHaveBeenCalled();
  await open();
  expect(watchAttendanceRegister).not.toHaveBeenCalled();
  const toggle = screen.getByRole('switch', { name: '自動更新全班名冊' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  expect(watchAttendanceRegister).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('學生甲')).toBeNull();
  emit();
  expect(screen.getByText('學生甲')).toBeTruthy();
  expect(loadAttendanceRegister).toHaveBeenCalledTimes(1);
});
it('keeps filters and search while receipt updates change the matching rows', async () => {
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
  await open();
  fireEvent.change(screen.getByLabelText('搜尋全班名冊'), { target: { value: 'S001' } });
  fireEvent.click(screen.getByRole('button', { name: /尚無紀錄/ }));
  fireEvent.click(screen.getByRole('switch', { name: '自動更新全班名冊' }));
  emit();
  expect(screen.getByText('學生甲')).toBeTruthy();
  emit({ ...register, rows: [{ ...register.rows[0], status: 'present', source: 'qr', checkedInAt: '2026-10-28T01:01:00Z' }, register.rows[1]] });
  expect(screen.getByText('沒有符合條件的學生。')).toBeTruthy();
  expect((screen.getByLabelText('搜尋全班名冊') as HTMLInputElement).value).toBe('S001');
  fireEvent.click(screen.getByRole('button', { name: /出席/ }));
  expect(screen.getByText('學生甲')).toBeTruthy();
  expect(watchAttendanceRegister).toHaveBeenCalledTimes(1);
});
it.each(['offline', 'paused', 'connecting', 'error'] as const)(
  'removes private rows and actions when the stream becomes %s', async (state) => {
    render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
    await open();
    fireEvent.click(screen.getByRole('switch', { name: '自動更新全班名冊' })); emit();
    act(() => vi.mocked(watchAttendanceRegister).mock.lastCall?.[0].onState(state));
    expect(screen.queryByText('學生甲')).toBeNull();
    expect(screen.queryByRole('button', { name: '匯出篩選名冊' })).toBeNull();
    expect(screen.queryByRole('button', { name: '更正 學生甲 S001' })).toBeNull();
    expect(screen.getByRole('switch', { name: '自動更新全班名冊' })).toBeTruthy();
  },
);
it('stops streaming on collapse and ignores callbacks queued before the panel closed', async () => {
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
  await open();
  fireEvent.click(screen.getByRole('switch', { name: '自動更新全班名冊' })); emit();
  fireEvent.click(screen.getByRole('button', { name: '收合全班名冊' }));
  expect(stop).toHaveBeenCalledTimes(1);
  emit();
  expect(screen.queryByText('學生甲')).toBeNull();
});
it('does not resubscribe for each teacher correction revision when the server stream is active', async () => {
  const onCorrect = vi.fn();
  const view = render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={onCorrect} revision={0} />);
  await open();
  fireEvent.click(screen.getByRole('switch', { name: '自動更新全班名冊' })); emit();
  view.rerender(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={onCorrect} revision={1} />);
  expect(watchAttendanceRegister).toHaveBeenCalledTimes(1);
  expect(loadAttendanceRegister).toHaveBeenCalledTimes(1);
});
it('falls back to a fresh manual snapshot and ignores an old live response', async () => {
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
  await open();
  fireEvent.click(screen.getByRole('switch', { name: '自動更新全班名冊' })); emit();
  vi.mocked(loadAttendanceRegister).mockResolvedValueOnce({ ...register, rows: [register.rows[1]] });
  fireEvent.click(screen.getByRole('switch', { name: '自動更新全班名冊' }));
  await screen.findByText('學生乙');
  emit();
  expect(screen.queryByText('學生甲')).toBeNull();
  expect(stop).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(loadAttendanceRegister).toHaveBeenCalledTimes(2));
});
it('clearly labels a partial enrollment query and refuses exporting a truncated class list', async () => {
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
  await open();
  fireEvent.click(screen.getByRole('switch', { name: '自動更新全班名冊' }));
  emit({ ...register, complete: false, membersComplete: false });
  expect(screen.getByText(/這不是完整班級名冊/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '匯出篩選名冊' }).hasAttribute('disabled')).toBe(true);
});
it('reconnects after a failed stream without enabling actions before new data arrives', async () => {
  render(<AttendanceRegisterPanel courseId="course" sessionId="session" onCorrect={vi.fn()} />);
  await open();
  fireEvent.click(screen.getByRole('switch', { name: '自動更新全班名冊' })); emit();
  act(() => vi.mocked(watchAttendanceRegister).mock.lastCall?.[0].onState('error'));
  fireEvent.click(screen.getByRole('button', { name: '重新連線名冊' }));
  expect(watchAttendanceRegister).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('學生甲')).toBeNull();
  emit();
  expect(screen.getByText('學生甲')).toBeTruthy();
});
