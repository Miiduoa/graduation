import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TeacherAssignments } from './TeacherAssignments';
import {
  loadTeacherSubmissions,
  newTeacherAssignmentId,
  publishSubmissionGrade,
  publishTeacherAssignment,
} from '@/lib/teacherAssignments';

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: { uid: 'teacher' } }),
}));
vi.mock('@/lib/teacherAssignments', () => ({
  loadTeacherSubmissions: vi.fn(),
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
      }],
    })
    .mockResolvedValueOnce({
      title: '練習一', points: 100,
      submissions: [{
        uid: 'student', content: '樹的遍歷', submittedAt: '2026-10-08T00:00:00Z',
        score: 0, feedback: '需訂正', gradedAt: '2026-10-08T01:00:00Z',
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
