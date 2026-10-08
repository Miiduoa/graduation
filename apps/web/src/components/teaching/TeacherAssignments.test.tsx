import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TeacherAssignments } from './TeacherAssignments';
import {
  loadTeacherSubmissions,
  loadGradeRevisions,
  loadEditableTeacherAssignment,
  updateTeacherAssignment,
  newGradeRevisionId,
  reviseSubmissionGrade,
  newTeacherAssignmentId,
  publishSubmissionGrade,
  publishTeacherAssignment,
} from '@/lib/teacherAssignments';

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: { uid: 'teacher' } }),
}));
vi.mock('@/lib/teacherAssignments', () => ({
  loadTeacherSubmissions: vi.fn(),
  loadGradeRevisions: vi.fn(),
  loadEditableTeacherAssignment: vi.fn(),
  updateTeacherAssignment: vi.fn(),
  newGradeRevisionId: vi.fn(() => 'revision-1234567890'),
  reviseSubmissionGrade: vi.fn(),
  newTeacherAssignmentId: vi.fn(() => 'reserved-work'),
  publishSubmissionGrade: vi.fn(),
  publishTeacherAssignment: vi.fn(),
}));

const props = {
  schoolId: 'pu',
  courseId: 'course',
  assignments: [{ id: 'work', title: '練習一' }],
  refresh: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTeacherSubmissions).mockResolvedValue({
    title: '練習一',
    points: 100,
    submissions: [{
      uid: 'student',
      content: '樹的遍歷',
      submittedAt: '2026-10-08T00:00:00Z',
      score: null,
      feedback: '',
      gradedAt: null,
      revisionCount: 0,
    }],
  });
});

it('publishes once with a reserved assignment id and confirms success', async () => {
  render(<TeacherAssignments {...props} />);
  fireEvent.click(screen.getByText('新增文字作業'));
  fireEvent.change(screen.getByPlaceholderText('例如：資料結構分析報告'), {
    target: { value: '樹狀結構作業' },
  });
  fireEvent.click(screen.getByRole('button', { name: '發布作業' }));
  await waitFor(() => expect(publishTeacherAssignment).toHaveBeenCalledTimes(1));
  expect(newTeacherAssignmentId).toHaveBeenCalledWith('course');
  expect(publishTeacherAssignment).toHaveBeenCalledWith(
    { uid: 'teacher', schoolId: 'pu', courseId: 'course' },
    'reserved-work',
    expect.objectContaining({ title: '樹狀結構作業', points: 100 }),
  );
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('作業已發布'));
  expect(props.refresh).toHaveBeenCalledOnce();
});

it('loads real submissions and publishes grading without changing course totals', async () => {
  vi.mocked(loadTeacherSubmissions)
    .mockResolvedValueOnce({
      title: '練習一', points: 100,
      submissions: [{
        uid: 'student', content: '樹的遍歷', submittedAt: '2026-10-08T00:00:00Z',
        score: null, feedback: '', gradedAt: null,
      revisionCount: 0,
      }],
    })
    .mockResolvedValueOnce({
      title: '練習一', points: 100,
      submissions: [{
        uid: 'student', content: '樹的遍歷', submittedAt: '2026-10-08T00:00:00Z',
        score: 0, feedback: '需訂正', gradedAt: '2026-10-08T01:00:00Z', revisionCount: 0,
      }],
    });
  render(<TeacherAssignments {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '查看繳交' }));
  await waitFor(() => expect(screen.getByText('樹的遍歷')).toBeTruthy());
  fireEvent.change(screen.getByRole('spinbutton', { name: /分數/ }), { target: { value: '0' } });
  fireEvent.change(screen.getByRole('textbox', { name: /評語/ }), { target: { value: '需訂正' } });
  fireEvent.click(screen.getByRole('button', { name: '發布此筆評分' }));
  await waitFor(() => expect(publishSubmissionGrade).toHaveBeenCalledWith(
    { uid: 'teacher', schoolId: 'pu', courseId: 'course' },
    'work', 'student', 0, '需訂正',
  ));
  await waitFor(() => expect(screen.getByText('已發布：0 / 100 分')).toBeTruthy());
});


it('requires a reason for grade correction and shows the immutable revision history', async () => {
  vi.mocked(loadTeacherSubmissions)
    .mockResolvedValueOnce({
      title: '練習一', points: 100,
      submissions: [{
        uid: 'student', content: '樹的遍歷',
        submittedAt: '2026-10-08T00:00:00Z',
        score: 60, feedback: '初次評分', gradedAt: '2026-10-08T01:00:00Z',
        revisionCount: 0,
      }],
    })
    .mockResolvedValueOnce({
      title: '練習一', points: 100,
      submissions: [{
        uid: 'student', content: '樹的遍歷',
        submittedAt: '2026-10-08T00:00:00Z',
        score: 80, feedback: '依評分規準調整', gradedAt: '2026-10-08T02:00:00Z',
        revisionCount: 1,
      }],
    });
  vi.mocked(loadGradeRevisions).mockResolvedValue([{
    id: 'revision-1234567890', beforeScore: 60, afterScore: 80,
    beforeFeedback: '初次評分', afterFeedback: '依評分規準調整',
    reason: '核對配分後修正', changedBy: 'teacher',
    changedAt: '2026-10-08T02:00:00Z',
  }]);
  render(<TeacherAssignments {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '查看繳交' }));
  await waitFor(() => expect(screen.getByText('已發布：60 / 100 分')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '更正成績' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: /更正後分數/ }), {
    target: { value: '80' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /更正後評語/ }), {
    target: { value: '依評分規準調整' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /更正原因/ }), {
    target: { value: '核對配分後修正' },
  });
  fireEvent.click(screen.getByRole('button', { name: '確認更正並保留紀錄' }));
  await waitFor(() => expect(reviseSubmissionGrade).toHaveBeenCalledWith(
    { uid: 'teacher', schoolId: 'pu', courseId: 'course' },
    'work', 'student', 'revision-1234567890',
    { score: 60, feedback: '初次評分', gradedAt: '2026-10-08T01:00:00Z' },
    80, '依評分規準調整', '核對配分後修正',
  ));
  await waitFor(() => expect(screen.getByText('已發布：80 / 100 分')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '查看更正紀錄' }));
  await waitFor(() => expect(screen.getByText('原因：核對配分後修正')).toBeTruthy());
  expect(screen.getByText('60 → 80 分')).toBeTruthy();
});


it('edits a published assignment without changing points or existing grades', async () => {
  vi.mocked(loadEditableTeacherAssignment).mockResolvedValue({
    title: '練習一', description: '原始說明', dueAt: '',
    allowLateSubmission: false, updatedAt: '2026-10-08T01:00:00Z',
  });
  render(<TeacherAssignments {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '編輯作業' }));
  await waitFor(() => expect(screen.getByDisplayValue('原始說明')).toBeTruthy());
  fireEvent.change(screen.getByRole('textbox', { name: '標題' }), {
    target: { value: '修訂後練習' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存作業修改' }));
  await waitFor(() => expect(updateTeacherAssignment).toHaveBeenCalledWith(
    { uid: 'teacher', schoolId: 'pu', courseId: 'course' },
    'work', '2026-10-08T01:00:00Z',
    { title: '修訂後練習', description: '原始說明', dueAt: '', allowLateSubmission: false },
  ));
  expect(props.refresh).toHaveBeenCalledOnce();
});

it('keeps assignment edit values available after a failed save', async () => {
  vi.mocked(loadEditableTeacherAssignment).mockResolvedValue({
    title: '練習一', description: '原始說明', dueAt: '',
    allowLateSubmission: false, updatedAt: '2026-10-08T01:00:00Z',
  });
  vi.mocked(updateTeacherAssignment).mockRejectedValue(new Error('作業已由其他操作更新'));
  render(<TeacherAssignments {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '編輯作業' }));
  await waitFor(() => expect(screen.getByDisplayValue('原始說明')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '儲存作業修改' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('其他操作更新'));
  expect(screen.getByDisplayValue('原始說明')).toBeTruthy();
  expect(props.refresh).not.toHaveBeenCalled();
});
