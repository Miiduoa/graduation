import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CourseGradebookScreen } from '../screens/CourseGradebookScreen';
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'student-a' }, profile: { schoolId: 'pu', role: 'student' } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../hooks/useDataSource', () => ({ useDataSource: () => ({}) }));
jest.mock('../data/courseSpaceSource', () => ({ listCourseSpaces: jest.fn(), getCourseGradebook: jest.fn() }));
jest.mock('../services/courseWorkspace', () => ({ canManageCourse: () => false, formatDateTime: (_value: unknown, fallback: string) => fallback }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../hooks/useAsyncList', () => ({
  useAsyncList: (_load: unknown, deps: unknown[]) => ({
    loading: false, error: null, reload: jest.fn(),
    items: deps.length === 5 ? [{ groupId: 'course-1', name: '資料庫', role: 'member' }] : [{
      assignments: [{ id: 'work-1', title: '期末作業', weight: 100, dueAt: null, gradesPublished: false, averageScore: null }],
      finalScoresPublished: false, finalScoresPublishedAt: null,
      rows: [{ uid: 'student-a', finalScore: 0, result: 'failed', gradedAssignments: 0, totalAssignments: 1,
        assignmentBreakdown: [{ assignmentId: 'work-1', title: '期末作業', weight: 100, grade: null, submittedAt: new Date(), feedback: null }] }],
    }],
  }),
}));
test('pending work stays unknown even when a stored total is zero and opens the exact assignment', () => {
  const navigate = jest.fn();
  const view = render(<CourseGradebookScreen navigation={{ navigate }} route={{ params: { groupId: 'course-1' } }} />);
  expect(view.getByText(/來源：nuni 課程/)).toBeTruthy();
  expect(view.getByText('總分 未知（仍有待評項目）')).toBeTruthy();
  expect(view.getByText('待評 · 尚無分數')).toBeTruthy();
  expect(view.queryByText('總分 0')).toBeNull();
  fireEvent.press(view.getByText('查看原始作業／測驗紀錄'));
  expect(navigate).toHaveBeenCalledWith('HomeworkSubmit', { courseId: 'course-1', hwId: 'work-1', hwTitle: '期末作業' });
});
