import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import StudentTodayScreen from '../screens/StudentTodayScreen';
import { loadStudentHome } from '../data/studentHome';
import type { CourseSpace, InboxTask } from '../data/types';

let mockAuth = {
  user: { uid: 'student-a' },
  profile: { schoolId: 'school-a', role: 'student' },
};
const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate };
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../data/studentHome', () => ({ loadStudentHome: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('../services/companionSignalRecorder', () => ({ recordCompanionEvent: jest.fn() }));
jest.mock('../app/useAIOverlay', () => ({ aiOverlay: { open: jest.fn() } }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

function result(name = '資料結構'): Awaited<ReturnType<typeof loadStudentHome>> {
  const course: CourseSpace = {
    id: 'course-a',
    groupId: 'course-a',
    name,
    unreadCount: 0,
    assignmentCount: 1,
    dueSoonCount: 1,
    quizCount: 1,
    moduleCount: 0,
    activeSessionId: null,
    latestDueAt: null,
  };
  const task: InboxTask = {
    id: 'assignment-a',
    kind: 'assignment',
    groupId: course.groupId,
    groupName: name,
    title: '繳交期末報告',
    subtitle: '報告尚未繳交',
    assignmentId: 'homework-a',
    priority: 1,
  };
  return { courses: [course], tasks: [task] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: { uid: 'student-a' }, profile: { schoolId: 'school-a', role: 'student' } };
  jest.mocked(loadStudentHome).mockResolvedValue(result());
});

test('opens the real platform workspace and school services even while school data is unavailable', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  jest.mocked(loadStudentHome).mockReturnValueOnce(pending.promise);
  const view = render(<StudentTodayScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Campus One 課程與作業' }));
  expect(mockNavigate).toHaveBeenCalledWith('我的', { screen: 'NuniWorkspace', params: undefined });
  fireEvent.press(view.getByRole('button', { name: '校務服務' }));
  expect(mockNavigate).toHaveBeenCalledWith('學習', { screen: 'CoursesHome', params: undefined });
  await act(async () => pending.resolve(result()));
});

test.each([
  [
    'assignment',
    '去繳交',
    'HomeworkSubmit',
    { courseId: 'course-a', hwId: 'homework-a', hwTitle: '繳交期末報告' },
  ],
  ['quiz', '去作答', 'QuizCenter', { groupId: 'course-a', groupName: '資料結構' }],
  ['live', '去簽到', 'AttendanceMultiMethod', { courseId: 'course-a', sessionId: 'attendance-a' }],
] as const)(
  'opens the actual %s action instead of stopping at the course overview',
  async (kind, label, screen, params) => {
    const data = result();
    data.tasks[0] = { ...data.tasks[0], kind, sessionId: 'attendance-a' };
    jest.mocked(loadStudentHome).mockResolvedValue(data);
    const view = render(<StudentTodayScreen />);
    fireEvent.press(await view.findByRole('button', { name: `繳交期末報告，${label}` }));
    expect(mockNavigate).toHaveBeenCalledWith('學習', { screen, params });
  },
);

test('a failed refresh hides old records and never turns the failure into an empty inbox', async () => {
  const view = render(<StudentTodayScreen />);
  await view.findByText('繳交期末報告');
  jest.mocked(loadStudentHome).mockRejectedValueOnce(new Error('permission-denied'));
  fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
  await view.findByText('無法讀取校務課程。請確認登入狀態與網路連線後重試。');
  expect(view.queryByText('繳交期末報告')).toBeNull();
  expect(view.queryByText(/目前沒有校務待辦/)).toBeNull();
  fireEvent.press(view.getByText('重新讀取'));
  await view.findByText('繳交期末報告');
});

test.each(['account', 'school'])(
  'changing the %s immediately masks old records and ignores late responses',
  async (change) => {
    const old = deferred<ReturnType<typeof result>>();
    const next = deferred<ReturnType<typeof result>>();
    const view = render(<StudentTodayScreen />);
    await view.findByText('繳交期末報告');
    jest.mocked(loadStudentHome).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
    mockAuth =
      change === 'account'
        ? { ...mockAuth, user: { uid: 'student-b' } }
        : { ...mockAuth, profile: { ...mockAuth.profile, schoolId: 'school-b' } };
    view.rerender(<StudentTodayScreen />);
    expect(view.queryByText('繳交期末報告')).toBeNull();
    await act(async () => old.resolve(result('過期課程')));
    expect(view.queryByText('過期課程')).toBeNull();
    await act(async () => next.resolve({ ...result('新課程'), tasks: [] }));
    expect(view.getByText('新課程')).toBeTruthy();
    expect(view.getByText(/Campus One 作業與測驗請到「課程與作業」查看/)).toBeTruthy();
  },
);
