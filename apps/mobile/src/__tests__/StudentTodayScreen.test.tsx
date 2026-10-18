import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import StudentTodayScreen from '../screens/StudentTodayScreen';
import { loadStudentHome } from '../data/studentHome';
import type { CourseSpace, InboxTask } from '../data/types';
import {
  SENSE_EMPTY_TEXT,
  SENSE_HANDLE_PREVIEW,
  SENSE_SECTION_TITLE,
  senseStorageKey,
} from '@campus/shared/src/todaySense';

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
jest.mock('../app/rootNavigation', () => ({ rootNavigateNested: jest.fn() }));
jest.mock('../components/OpenOrderCard', () => ({ OpenOrderCard: () => null }));
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
    dueAt: new Date('2026-10-20T16:00:00.000Z'),
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
  void AsyncStorage.clear();
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
    {
      courseId: 'course-a',
      hwId: 'homework-a',
      hwTitle: '繳交期末報告',
      dueAt: '2026-10-20T16:00:00.000Z',
    },
  ],
  [
    'quiz',
    '去作答',
    'QuizTaking',
    {
      groupId: 'course-a',
      groupName: '資料結構',
      quizId: 'homework-a',
      dueAt: '2026-10-20T16:00:00.000Z',
    },
  ],
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
  expect(view.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(view.queryByText(SENSE_SECTION_TITLE)).toBeNull();
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

test('handles an overdue inbox item locally after preview and undoes it', async () => {
  const data = result();
  data.tasks[0] = {
    ...data.tasks[0],
    dueAt: new Date(Date.now() - 60 * 60 * 1000),
  };
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  expect(await view.findByText(SENSE_SECTION_TITLE)).toBeTruthy();
  expect(view.getByText(/已過截止時間/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '從清單移出' }));
  expect(view.getByText(SENSE_HANDLE_PREVIEW)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '確認移出' }));
  expect(await view.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(await AsyncStorage.getItem(senseStorageKey('student-a', 'school-a'))).toContain(
    '"handle"',
  );
  fireEvent.press(view.getByRole('button', { name: '撤銷上次操作' }));
  expect(await view.findByText(/已過截止時間/)).toBeTruthy();
});

test('opens the live session from a sense card', async () => {
  const data = result();
  data.tasks[0] = { ...data.tasks[0], kind: 'live', sessionId: 'attendance-a', dueAt: null };
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  fireEvent.press(await view.findByRole('button', { name: '前往簽到' }));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'AttendanceMultiMethod',
    params: { courseId: 'course-a', sessionId: 'attendance-a' },
  });
});

test('shows an honest empty sense state when loaded tasks are not due soon', async () => {
  const data = result();
  data.tasks[0] = { ...data.tasks[0], dueAt: new Date('2099-01-02T12:30:00.000Z') };
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  expect(await view.findByText(SENSE_EMPTY_TEXT)).toBeTruthy();
  expect(view.queryByRole('button', { name: '從清單移出' })).toBeNull();
});
