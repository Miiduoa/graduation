import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CourseGradebookScreen } from '../screens/CourseGradebookScreen';
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'student-a' }, profile: { schoolId: 'pu', role: 'student' } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../hooks/useDataSource', () => ({ useDataSource: () => ({}) }));
jest.mock('../data/courseSpaceSource', () => ({ listCourseSpaces: jest.fn(), getCourseGradebook: jest.fn() }));
jest.mock('../services/courseWorkspace', () => ({ canManageCourse: () => false, formatDateTime: (_value: unknown, fallback: string) => fallback }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let mockPublished = false;
let mockReadError: string | null = null;
const mockReload = jest.fn();
jest.mock('../hooks/useAsyncList', () => ({
  useAsyncList: (_load: unknown, deps: unknown[]) => ({
    loading: false, error: deps.length === 5 ? null : mockReadError, reload: mockReload,
    items: deps.length === 5 ? [{ groupId: 'course-1', name: '資料庫', role: 'member' }] : [{
      assignments: [{ id: 'work-1', title: '期末作業', weight: 100, dueAt: null, gradesPublished: false, averageScore: null }],
      finalScoresPublished: mockPublished, finalScoresPublishedAt: null,
      rows: [{ uid: 'student-a', published: mockPublished, finalScore: mockPublished ? 80 : 0, result: mockPublished ? 'passed' : 'failed', gradedAssignments: mockPublished ? 1 : 0, totalAssignments: 2,
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

test('published final scores remain visible while individual work is pending', () => {
  mockPublished = true;
  const view = render(<CourseGradebookScreen route={{ params: { groupId: 'course-1' } }} />);
  expect(view.getByText('總分 80')).toBeTruthy();
  expect(view.getByText('通過')).toBeTruthy();
  expect(view.queryByText(/班平均/)).toBeNull();
  expect(view.getByText('評分進度 1/2')).toBeTruthy();
  mockPublished = false;
});

test('failed gradebook reads show retry without scores, progress, or missing submissions', () => {
  mockReadError = '讀取失敗';
  const view = render(<CourseGradebookScreen route={{ params: { groupId: 'course-1' } }} />);
  expect(view.getByText('讀取成績簿失敗')).toBeTruthy();
  expect(view.queryByText(/評分進度 0/)).toBeNull();
  expect(view.queryByText(/缺件/)).toBeNull();
  expect(view.queryByText(/班平均/)).toBeNull();
  fireEvent.press(view.getByText('重試'));
  expect(mockReload).toHaveBeenCalled();
  mockReadError = null;
  view.rerender(<CourseGradebookScreen route={{ params: { groupId: 'course-1' } }} />);
  expect(view.getByText('總分 未知（仍有待評項目）')).toBeTruthy();
});
