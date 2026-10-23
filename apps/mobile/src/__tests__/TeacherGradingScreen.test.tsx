import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CourseGradebookData, CourseSpace } from '../data';
import TeacherGradingScreen from '../screens/TeacherGradingScreen';
import { getCourseGradebook, listCourseSpaces } from '../data/courseSpaceSource';
import { safeNavigate } from '../utils/safeNavigate';

let mockAuth = { user: { uid: 'teacher-a' }, profile: { schoolId: 'school-a', role: 'teacher' } };
const mockDataSource = { listCourseSpaces: jest.fn(), getCourseGradebook: jest.fn() };
const mockNavigation = { navigate: jest.fn() };
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'school-a' } }) }));
jest.mock('../data/courseSpaceSource', () => ({ listCourseSpaces: jest.fn(), getCourseGradebook: jest.fn() }));
jest.mock('../hooks/useDataSource', () => ({ useDataSource: () => mockDataSource }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80, useTabBarContentBottomPadding: () => 80 }));

function course(groupId = 'group-one', courseId = 'catalog-one', role = 'instructor'): CourseSpace {
  return { id: groupId, groupId, courseId, name: '資料結構', role, unreadCount: 0, assignmentCount: 1, dueSoonCount: 0,
    quizCount: 0, moduleCount: 0, activeSessionId: null, latestDueAt: null };
}
function gradebook(name = '實際學生'): CourseGradebookData {
  return { groupName: '資料結構', assignments: [], finalScoresPublished: false, finalScoresPublishedAt: null,
    rows: [{ uid: 'real-student', displayName: name, finalScore: null, passingScore: 60, result: 'pending', published: false,
      publishedAt: null, gradedAssignments: 0, totalAssignments: 1, assignmentBreakdown: [] }] };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: { uid: 'teacher-a' }, profile: { schoolId: 'school-a', role: 'teacher' } };
  jest.mocked(listCourseSpaces).mockResolvedValue([course()]);
  jest.mocked(getCourseGradebook).mockResolvedValue(gradebook());
});

test('an unscoped grading shortcut offers the real course list instead of sample submissions', () => {
  const view = render(<TeacherGradingScreen />);
  expect(view.queryByText('阿明')).toBeNull();
  expect(view.queryByText('儲存並批改下一份')).toBeNull();
  fireEvent.press(view.getByText('選擇授課課程'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'LearnHome');
  expect(listCourseSpaces).not.toHaveBeenCalled();
  expect(getCourseGradebook).not.toHaveBeenCalled();
});

test.each([
  { courseId: 'catalog-one' },
  { courseId: 'group-one' },
  { courseId: 'unrelated', groupId: 'group-one' },
  { courseSpaceId: 'group-one' },
])('resolves route %j through actual memberships and reads workspace grades', async params => {
  const view = render(<TeacherGradingScreen route={{ params: { ...params, assignmentId: 'hw-one', assignmentTitle: '作業一' } }} />);
  await view.findByText('實際學生');
  expect(listCourseSpaces).toHaveBeenCalledWith('teacher-a', 'school-a');
  expect(getCourseGradebook).toHaveBeenCalledWith('group-one');
  expect(mockDataSource.getCourseGradebook).not.toHaveBeenCalled();
  expect(mockDataSource.listCourseSpaces).not.toHaveBeenCalled();
  expect(view.queryByText(/全部批改完成/)).toBeNull();
});

test.each([
  { courses: [course('other-group', 'other-catalog')] },
  { courses: [course('group-one', 'catalog-one', 'member')] },
  { courses: [course('group-one', 'catalog-one'), course('group-two', 'catalog-one')] },
  { courses: [course('catalog-one', 'other-catalog', 'member'), course('group-one', 'catalog-one')] },
])('does not guess a group for missing, unauthorized, or ambiguous memberships', async ({ courses }) => {
  jest.mocked(listCourseSpaces).mockResolvedValue(courses);
  const view = render(<TeacherGradingScreen route={{ params: { courseId: 'catalog-one' } }} />);
  await view.findByText('目前無法開啟這門課的成績');
  expect(getCourseGradebook).not.toHaveBeenCalled();
});

test('a membership read failure offers retry and does not announce grading success', async () => {
  jest.mocked(listCourseSpaces).mockRejectedValueOnce(new Error('offline'));
  const view = render(<TeacherGradingScreen route={{ params: { courseId: 'catalog-one' } }} />);
  await view.findByText('無法讀取授課清單，請確認連線後重試。');
  expect(getCourseGradebook).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('重新讀取'));
  await view.findByText('實際學生');
  expect(view.queryByText(/全部批改完成/)).toBeNull();
});

test('clears the old roster immediately and ignores a pending gradebook after an account switch', async () => {
  let finish!: (value: CourseGradebookData) => void;
  jest.mocked(getCourseGradebook).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const route = { params: { courseId: 'catalog-one' } };
  const view = render(<TeacherGradingScreen route={route} />);
  await waitFor(() => expect(getCourseGradebook).toHaveBeenCalledTimes(1));
  mockAuth = { ...mockAuth, user: { uid: 'teacher-b' } };
  jest.mocked(listCourseSpaces).mockResolvedValue([]);
  view.rerender(<TeacherGradingScreen route={route} />);
  await act(async () => finish(gradebook('舊帳號名單')));
  await view.findByText('目前無法開啟這門課的成績');
  expect(view.queryByText('舊帳號名單')).toBeNull();
});
