import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceCorrectionPanel } from './AttendanceCorrectionPanel';
import { attendanceActorUid, correctCourseAttendance, loadAttendanceCorrections, loadCourseAttendanceRoster } from '@/lib/courseAttendance';
import { loadCorrectionReview } from '@/lib/attendanceCorrectionReview';

vi.mock('./AttendanceRegisterPanel', () => ({ AttendanceRegisterPanel: () => null }));
vi.mock('@/lib/attendanceCorrectionReview', () => ({
  correctionReviewScope: (course: string, session: string, uid: string) => JSON.stringify([course, session, uid]),
  loadCorrectionReview: vi.fn(),
}));
vi.mock('@/lib/courseAttendance', () => ({
  attendanceActorUid: vi.fn(),
  attendanceError: (error: unknown) => error instanceof Error ? error.message : '錯誤',
  correctCourseAttendance: vi.fn(), loadAttendanceCorrections: vi.fn(), loadCourseAttendanceRoster: vi.fn(),
}));
const props = { courseId: 'class-a', sessionId: 'session-a', onUpdated: vi.fn<() => Promise<void>>() };
const roster = [{ uid: 'student-a', displayName: '學生甲', studentId: 'S001' },
  { uid: 'student-b', displayName: '學生乙', studentId: 'S002' }];
const success = { success: true, reused: false, status: 'late' as const };
const fault = (code: string) => Object.assign(new Error(code), { code });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  vi.mocked(attendanceActorUid).mockReturnValue('teacher-a');
  vi.mocked(loadCourseAttendanceRoster).mockResolvedValue(roster);
  vi.mocked(loadAttendanceCorrections).mockResolvedValue([]);
  vi.mocked(loadCorrectionReview).mockImplementation(async (course, session, uid) => ({
    scope: JSON.stringify([course, session, uid]), revision: 4, active: false,
    row: { uid, displayName: '學生甲', studentId: 'S001', status: 'unconfirmed', source: null,
      checkedInAt: null, correctedAt: null },
  }));
  vi.mocked(correctCourseAttendance).mockResolvedValue(success);
  props.onUpdated.mockResolvedValue(undefined);
});
async function prepare() {
  fireEvent.click(screen.getByRole('button', { name: '管理出席更正' }));
  await screen.findByLabelText('選擇學生');
  fireEvent.change(screen.getByLabelText('選擇學生'), { target: { value: 'student-a' } });
  fireEvent.change(screen.getByLabelText('核定狀態'), { target: { value: 'late' } });
  fireEvent.change(screen.getByLabelText('更正原因'), { target: { value: '老師已核對現場出席時間' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '確認並保存更正' }).hasAttribute('disabled')).toBe(false));
}
it('freezes the exact command and focuses recovery after an ambiguous result', async () => {
  vi.mocked(correctCourseAttendance).mockRejectedValueOnce(fault('attendance/result-unknown'))
    .mockResolvedValueOnce({ ...success, reused: true });
  render(<AttendanceCorrectionPanel {...props} />);
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '確認並保存更正' }));
  const retry = await screen.findByRole('button', { name: '確認原更正結果' });
  await waitFor(() => expect(document.activeElement).toBe(retry));
  for (const label of ['搜尋學生', '選擇學生', '核定狀態', '更正原因'])
    expect(screen.getByLabelText(label).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '收合更正' }).hasAttribute('disabled')).toBe(true);
  // Even synthetic change events cannot mutate a previously submitted command.
  fireEvent.change(screen.getByLabelText('更正原因'), { target: { value: '另外一個原因不能替換' } });
  fireEvent.change(screen.getByLabelText('選擇學生'), { target: { value: 'student-b' } });
  fireEvent.click(retry);
  await waitFor(() => expect(correctCourseAttendance).toHaveBeenCalledTimes(2));
  const [first, second] = vi.mocked(correctCourseAttendance).mock.calls;
  expect(first[0]).toEqual(second[0]);
  expect(second[0]).toMatchObject({ studentUid: 'student-a', status: 'late', expectedRevision: 4,
    actorUid: 'teacher-a', reason: '老師已核對現場出席時間' });
  expect(await screen.findByText('這筆更正已保存，已確認先前操作結果。')).toBeTruthy();
});
it('blocks double submits and double recovery clicks', async () => {
  const pending = deferred<typeof success>();
  vi.mocked(correctCourseAttendance).mockRejectedValueOnce(fault('attendance/result-unknown'))
    .mockReturnValueOnce(pending.promise);
  render(<AttendanceCorrectionPanel {...props} />);
  await prepare();
  const submit = screen.getByRole('button', { name: '確認並保存更正' });
  fireEvent.click(submit); fireEvent.click(submit);
  const retry = await screen.findByRole('button', { name: '確認原更正結果' });
  fireEvent.click(retry); fireEvent.click(retry);
  expect(correctCourseAttendance).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(success));
});
it('requires another explicit confirmation after a version conflict', async () => {
  vi.mocked(correctCourseAttendance).mockRejectedValueOnce(fault('functions/aborted'));
  render(<AttendanceCorrectionPanel {...props} />);
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '確認並保存更正' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  await waitFor(() => expect(loadCorrectionReview).toHaveBeenCalledTimes(2));
  expect(correctCourseAttendance).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('更正原因') as HTMLTextAreaElement).value).toBe('老師已核對現場出席時間');
  expect(screen.queryByRole('button', { name: '確認原更正結果' })).toBeNull();
});
it('does not clear the uncertain attempt after a later permission rejection', async () => {
  vi.mocked(correctCourseAttendance).mockRejectedValueOnce(fault('attendance/result-unknown'))
    .mockRejectedValueOnce(fault('functions/permission-denied'));
  render(<AttendanceCorrectionPanel {...props} />);
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '確認並保存更正' }));
  fireEvent.click(await screen.findByRole('button', { name: '確認原更正結果' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('permission-denied'));
  expect(screen.getByLabelText('更正原因').hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '確認原更正結果' })).toBeTruthy();
});
it('does not turn a refresh failure into a second correction', async () => {
  props.onUpdated.mockRejectedValueOnce(new Error('refresh offline'));
  render(<AttendanceCorrectionPanel {...props} />);
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '確認並保存更正' }));
  expect(await screen.findByText('更正已由伺服器確認，但重新整理紀錄失敗，請再試一次更新。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '確認原更正結果' })).toBeNull();
  expect(correctCourseAttendance).toHaveBeenCalledTimes(1);
});
it.each(['course', 'session', 'actor'])('drops old callbacks and drafts when %s changes', async (scope) => {
  const pending = deferred<typeof success>();
  vi.mocked(correctCourseAttendance).mockReturnValueOnce(pending.promise);
  const view = render(<AttendanceCorrectionPanel {...props} />);
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '確認並保存更正' }));
  if (scope === 'actor') vi.mocked(attendanceActorUid).mockReturnValue('teacher-b');
  view.rerender(<AttendanceCorrectionPanel {...props}
    courseId={scope === 'course' ? 'class-b' : props.courseId}
    sessionId={scope === 'session' ? 'session-b' : props.sessionId} />);
  expect(screen.queryByLabelText('更正原因')).toBeNull();
  expect(screen.getByRole('button', { name: '管理出席更正' })).toBeTruthy();
  await act(async () => pending.resolve(success));
  expect(props.onUpdated).not.toHaveBeenCalled();
  expect(screen.queryByText('已保存更正，並建立操作稽核紀錄。')).toBeNull();
});
