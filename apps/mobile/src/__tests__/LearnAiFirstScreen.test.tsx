import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import LearnAiFirstScreen from '../screens/LearnAiFirstScreen';
import { loadStudentHome } from '../data/studentHome';
import type { CourseSpace, InboxTask } from '../data/types';

let mockAuth = {
  user: { uid: 'student-a' },
  profile: { uid: 'student-a', schoolId: 'school-a', role: 'student' },
};
const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate };
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../data/studentHome', () => ({ loadStudentHome: jest.fn() }));
jest.mock('../components/LearningNextClassCard', () => ({ LearningNextClassCard: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

function result(): Awaited<ReturnType<typeof loadStudentHome>> {
  const course: CourseSpace = {
    id: 'course-a',
    groupId: 'course-a',
    name: '資料結構',
    unreadCount: 0,
    assignmentCount: 1,
    dueSoonCount: 1,
    quizCount: 0,
    moduleCount: 0,
    activeSessionId: null,
    latestDueAt: null,
  };
  const task: InboxTask = {
    id: 'assignment-a',
    kind: 'assignment',
    groupId: course.groupId,
    groupName: course.name,
    title: '迴歸分析作業',
    subtitle: '報告尚未繳交',
    assignmentId: 'homework-a',
    priority: 1,
    dueAt: new Date('2026-10-20T16:00:00.000Z'),
  };
  return { courses: [course], tasks: [task] };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    user: { uid: 'student-a' },
    profile: { uid: 'student-a', schoolId: 'school-a', role: 'student' },
  };
  jest.mocked(loadStudentHome).mockResolvedValue(result());
});

test('a course task opens that assignment instead of the class feed', async () => {
  const view = render(<LearnAiFirstScreen />);
  fireEvent.press(await view.findByText('迴歸分析作業'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'HomeworkSubmit',
    params: {
      courseId: 'course-a',
      hwId: 'homework-a',
      hwTitle: '迴歸分析作業',
      dueAt: '2026-10-20T16:00:00.000Z',
    },
  });
  expect(mockNavigate).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ screen: 'GroupDetail' }),
  );
});

test('a course card opens the materials cabinet instead of the class feed', async () => {
  const view = render(<LearnAiFirstScreen />);
  fireEvent.press(await view.findByText('教材'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'CourseHub',
    params: { groupId: 'course-a', groupName: '資料結構' },
  });
});
