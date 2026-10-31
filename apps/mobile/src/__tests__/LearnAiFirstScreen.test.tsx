import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import LearnAiFirstScreen from '../screens/LearnAiFirstScreen';
import { loadStudentHome } from '../data/studentHome';
import { rootNavigateMeScreen } from '../app/rootNavigation';
import type { CourseSpace, InboxTask } from '../data/types';

let mockAuth: {
  user: { uid: string } | null;
  profile: { uid: string; schoolId: string; role: string } | null;
} = {
  user: { uid: 'student-a' },
  profile: { uid: 'student-a', schoolId: 'school-a', role: 'student' },
};
const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate };
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../data/studentHome', () => ({ loadStudentHome: jest.fn() }));
jest.mock('../app/rootNavigation', () => ({ rootNavigateMeScreen: jest.fn() }));
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

test('opens the original LMS course list without refreshing school data', async () => {
  const view = render(<LearnAiFirstScreen />);
  await view.findByText('迴歸分析作業');

  fireEvent.press(view.getByRole('button', { name: /LMS 課程/ }));

  expect(rootNavigateMeScreen).toHaveBeenCalledTimes(1);
  expect(rootNavigateMeScreen).toHaveBeenCalledWith('NuniWorkspace', { tab: 'courses' });
  expect(loadStudentHome).toHaveBeenCalledTimes(1);
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('keeps the LMS entry available while school courses are loading', () => {
  jest.mocked(loadStudentHome).mockReturnValue(new Promise(() => {}));
  const view = render(<LearnAiFirstScreen />);

  fireEvent.press(view.getByRole('button', { name: /LMS 課程/ }));

  expect(rootNavigateMeScreen).toHaveBeenCalledWith('NuniWorkspace', { tab: 'courses' });
});

test('keeps the LMS entry available when school courses cannot be read', async () => {
  jest.mocked(loadStudentHome).mockRejectedValue(new Error('school-unavailable'));
  const view = render(<LearnAiFirstScreen />);
  await view.findByText('無法讀取課程與待辦，請確認登入狀態與網路後重試。');

  fireEvent.press(view.getByRole('button', { name: /LMS 課程/ }));

  expect(rootNavigateMeScreen).toHaveBeenCalledWith('NuniWorkspace', { tab: 'courses' });
  expect(loadStudentHome).toHaveBeenCalledTimes(1);
});

test('keeps the LMS entry independent of the school session', async () => {
  mockAuth = { user: null, profile: null };
  const view = render(<LearnAiFirstScreen />);
  await view.findByText('無法讀取課程與待辦，請確認登入狀態與網路後重試。');

  fireEvent.press(view.getByRole('button', { name: /LMS 課程/ }));

  expect(rootNavigateMeScreen).toHaveBeenCalledWith('NuniWorkspace', { tab: 'courses' });
  expect(loadStudentHome).not.toHaveBeenCalled();
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

test('filters real tasks by course and search term without changing the course membership list', async () => {
  const data = result();
  data.courses.push({ ...data.courses[0], id: 'course-b', groupId: 'course-b', name: '資料庫' });
  data.tasks = [
    { ...data.tasks[0], id: 'task-a', title: '資料結構作業', dueAt: new Date(Date.now() + 3600000) },
    { ...data.tasks[0], id: 'task-b', groupId: 'course-b', groupName: '資料庫', title: '資料庫期中報告', dueAt: new Date(Date.now() + 3600000) },
  ];
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<LearnAiFirstScreen />);
  await view.findByText('資料結構作業');
  expect(view.getByText('資料庫期中報告')).toBeTruthy();

  fireEvent.press(view.getByText('只看：資料結構'));
  expect(view.queryByText('資料庫期中報告')).toBeNull();
  expect(view.getByText('資料結構作業')).toBeTruthy();

  fireEvent.press(view.getByText('所有課程'));
  fireEvent.changeText(view.getByLabelText('搜尋課務'), '資料庫');
  expect(view.getByText('資料庫期中報告')).toBeTruthy();
  expect(view.queryByText('資料結構作業')).toBeNull();

  fireEvent.changeText(view.getByLabelText('搜尋課務'), '不存在的作業');
  expect(view.getByText('目前沒有符合條件的課務，請調整搜尋或篩選。')).toBeTruthy();
});

test('initially renders a manageable number of tasks and reveals remaining items on demand', async () => {
  const data = result();
  data.tasks = Array.from({ length: 26 }, (_, i) => ({
    ...data.tasks[0],
    id: 'task-' + i,
    assignmentId: 'assignment-' + i,
    title: '額外作業 ' + i,
    dueAt: new Date(Date.now() + (i + 1) * 60000),
  }));
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<LearnAiFirstScreen />);
  await view.findByText('額外作業 0');
  expect(view.getByText('目前符合條件：26 項 · 依優先處理順序排列')).toBeTruthy();
  expect(view.queryByText('額外作業 25')).toBeNull();
  fireEvent.press(view.getByText('顯示更多（尚有 6 項）'));
  expect(view.getByText('額外作業 25')).toBeTruthy();
});
