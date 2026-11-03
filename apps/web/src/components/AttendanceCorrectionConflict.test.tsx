import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceCorrectionPanel } from './AttendanceCorrectionPanel';
import { loadCorrectionReview, type CorrectionReview } from '@/lib/attendanceCorrectionReview';
import { correctCourseAttendance, loadAttendanceCorrections, loadCourseAttendanceRoster } from '@/lib/courseAttendance';

vi.mock('./AttendanceRegisterPanel', () => ({ AttendanceRegisterPanel: () => null }));
vi.mock('@/lib/attendanceCorrectionReview', () => ({
  correctionReviewScope: (course: string, session: string, uid: string) => JSON.stringify([course, session, uid]),
  loadCorrectionReview: vi.fn(),
}));
vi.mock('@/lib/courseAttendance', () => ({
  attendanceActorUid: () => 'teacher',
  attendanceError: () => '操作未完成', correctCourseAttendance: vi.fn(),
  loadAttendanceCorrections: vi.fn(), loadCourseAttendanceRoster: vi.fn(),
}));
function review(uid = 'student', revision: number | null = 0): CorrectionReview {
  return { scope: JSON.stringify(['course', 'session', uid]), revision, active: false,
    row: { uid, displayName: uid, studentId: 'S001', status: 'present', source: 'qr',
      checkedInAt: '2026-10-28T01:00:00Z', correctedAt: null } };
}
const button = () => screen.getByRole('button', { name: '確認並保存更正' });
async function open() {
  render(<AttendanceCorrectionPanel courseId="course" sessionId="session" onUpdated={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole('button', { name: '管理出席更正' }));
  await screen.findByLabelText('選擇學生');
  fireEvent.change(screen.getByLabelText('選擇學生'), { target: { value: 'student' } });
  fireEvent.change(screen.getByLabelText('核定狀態'), { target: { value: 'late' } });
  fireEvent.change(screen.getByLabelText('更正原因'), { target: { value: '教師現場核對學生到課時間' } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadCourseAttendanceRoster).mockResolvedValue([
    { uid: 'student', displayName: '學生甲', studentId: 'S001' },
    { uid: 'other', displayName: '學生乙', studentId: 'S002' },
  ]);
  vi.mocked(loadAttendanceCorrections).mockResolvedValue([]);
  vi.mocked(loadCorrectionReview).mockResolvedValue(review());
  vi.mocked(correctCourseAttendance).mockResolvedValue({ success: true, reused: false, status: 'late' });
});
it('requires a server review before a form can send a correction', async () => {
  let finish!: (value: CorrectionReview) => void;
  vi.mocked(loadCorrectionReview).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  await open();
  expect(button().hasAttribute('disabled')).toBe(true);
  fireEvent.click(button());
  expect(correctCourseAttendance).not.toHaveBeenCalled();
  await act(async () => finish(review()));
  expect(screen.getByRole('region', { name: '更正前核對' })).toBeTruthy();
  fireEvent.click(button());
  await waitFor(() => expect(correctCourseAttendance).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 0 })));
});
it('preserves the reason on conflict and requires another explicit confirmation with the fresh revision', async () => {
  vi.mocked(loadCorrectionReview).mockResolvedValueOnce(review()).mockResolvedValue(review('student', 1));
  vi.mocked(correctCourseAttendance).mockRejectedValueOnce({ code: 'functions/aborted' });
  await open();
  await waitFor(() => expect(button().hasAttribute('disabled')).toBe(false));
  fireEvent.click(button());
  expect(await screen.findByRole('alert')).toBeTruthy();
  await waitFor(() => expect(loadCorrectionReview).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(button().hasAttribute('disabled')).toBe(false));
  expect((screen.getByLabelText('更正原因') as HTMLTextAreaElement).value).toBe('教師現場核對學生到課時間');
  expect(correctCourseAttendance).toHaveBeenCalledTimes(1);
  fireEvent.click(button());
  await waitFor(() => expect(correctCourseAttendance).toHaveBeenCalledTimes(2));
  const [first, second] = vi.mocked(correctCourseAttendance).mock.calls.map(([command]) => command);
  expect(first).toMatchObject({ expectedRevision: 0 });
  expect(second).toMatchObject({ expectedRevision: 1 });
  expect(second.requestId).not.toBe(first.requestId);
});
it('cannot submit a late review that belongs to the previously selected student', async () => {
  let old!: (value: CorrectionReview) => void;
  let next!: (value: CorrectionReview) => void;
  vi.mocked(loadCorrectionReview)
    .mockImplementationOnce(() => new Promise((done) => { old = done; }))
    .mockImplementationOnce(() => new Promise((done) => { next = done; }));
  await open();
  fireEvent.change(screen.getByLabelText('選擇學生'), { target: { value: 'other' } });
  await act(async () => old(review()));
  expect(button().hasAttribute('disabled')).toBe(true);
  expect(correctCourseAttendance).not.toHaveBeenCalled();
  await act(async () => next(review('other', 2)));
  fireEvent.click(button());
  await waitFor(() => expect(correctCourseAttendance).toHaveBeenCalledWith(expect.objectContaining({ studentUid: 'other', expectedRevision: 2 })));
});
it('does not infer an empty receipt when the review request fails', async () => {
  vi.mocked(loadCorrectionReview).mockRejectedValueOnce(new Error('offline'));
  await open();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(button().hasAttribute('disabled')).toBe(true);
  expect(correctCourseAttendance).not.toHaveBeenCalled();
});
it('keeps the reviewed revision and operation identity when a response is lost', async () => {
  vi.mocked(correctCourseAttendance).mockRejectedValueOnce({ code: 'functions/unavailable' });
  await open();
  await waitFor(() => expect(button().hasAttribute('disabled')).toBe(false));
  fireEvent.click(button());
  await screen.findByRole('alert');
  const retry = await screen.findByRole('button', { name: '確認原更正結果' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
  expect(screen.getByLabelText('更正原因').hasAttribute('disabled')).toBe(true);
  fireEvent.click(retry);
  await waitFor(() => expect(correctCourseAttendance).toHaveBeenCalledTimes(2));
  expect(vi.mocked(correctCourseAttendance).mock.calls[0][0]).toEqual(vi.mocked(correctCourseAttendance).mock.calls[1][0]);
});
