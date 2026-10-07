import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import GradesAiFirstScreen from '../screens/GradesAiFirstScreen';
import AcademicOverviewAiFirstScreen from '../screens/AcademicOverviewAiFirstScreen';
import AchievementsAiFirstScreen from '../screens/AchievementsAiFirstScreen';
import { firebaseSource } from '../data/firebaseSource';
import { loadStudentHome } from '../data/studentHome';
import { safeNavigate } from '../utils/safeNavigate';
import type { CourseSpace, Grade, InboxTask, UserAchievement } from '../data/types';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };
let mockAuth = {
  user: { uid: 'user-a' },
  profile: { uid: 'user-a', schoolId: 'school-a', role: 'student' },
};
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ isStudent: true }) }));
jest.mock('../data/studentHome', () => ({ loadStudentHome: jest.fn() }));
jest.mock('../data/firebaseSource', () => ({
  firebaseSource: {
    listGrades: jest.fn(),
    getUserAchievements: jest.fn(),
    listAchievements: jest.fn(),
  },
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

function grade(patch: Partial<Grade> = {}): Grade {
  return {
    id: 'grade-1',
    userId: 'user-a',
    schoolId: 'school-a',
    courseId: 'course-1',
    courseName: '已發布的課程',
    credits: 2,
    semester: '2026 秋季',
    score: 87,
    publishedAt: '2000-01-01T00:00:00Z',
    ...patch,
  };
}
function home(name = '已加入的課程') {
  const course: CourseSpace = {
    id: 'course-1',
    groupId: 'group-1',
    name,
    unreadCount: 0,
    assignmentCount: 0,
    dueSoonCount: 0,
    quizCount: 0,
    moduleCount: 0,
    activeSessionId: null,
    latestDueAt: null,
  };
  return { courses: [course], tasks: [] as InboxTask[] };
}
function achievement(patch: Partial<UserAchievement> = {}): UserAchievement {
  return {
    id: 'earned-1',
    userId: 'user-a',
    schoolId: 'school-a',
    name: '已記錄的成就',
    progress: 1,
    unlockedAt: '2000-01-01T00:00:00Z',
    ...patch,
  };
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
  mockAuth = {
    user: { uid: 'user-a' },
    profile: { uid: 'user-a', schoolId: 'school-a', role: 'student' },
  };
  jest.mocked(firebaseSource.listGrades).mockResolvedValue([grade()]);
  jest.mocked(firebaseSource.getUserAchievements).mockResolvedValue([achievement()]);
  jest.mocked(firebaseSource.listAchievements).mockResolvedValue([]);
  jest.mocked(loadStudentHome).mockResolvedValue(home());
});

test('signed-out direct routes remain readable and never fetch private records', async () => {
  mockAuth = { user: null, profile: null };
  const grades = render(<GradesAiFirstScreen />);
  await grades.findByText('無法讀取成績，請確認登入狀態與網路後重試。');
  grades.unmount();
  const overview = render(<AcademicOverviewAiFirstScreen />);
  await overview.findByText('無法讀取學業資料，請確認登入狀態與網路後重試。');
  overview.unmount();
  const achievements = render(<AchievementsAiFirstScreen />);
  await achievements.findByText('無法讀取成就紀錄，請確認登入狀態與網路後重試。');
  expect(firebaseSource.listGrades).not.toHaveBeenCalled();
  expect(firebaseSource.getUserAchievements).not.toHaveBeenCalled();
  expect(loadStudentHome).not.toHaveBeenCalled();
});

test('grades show source scores and exclude other accounts, schools and unpublished records', async () => {
  jest
    .mocked(firebaseSource.listGrades)
    .mockResolvedValue([
      grade(),
      grade({ id: 'other-user', userId: 'user-b', courseName: '其他人的成績' }),
      grade({ id: 'other-school', schoolId: 'school-b', courseName: '其他學校成績' }),
      grade({ id: 'unscoped', schoolId: undefined, courseName: '學校不明的成績' }),
      grade({ id: 'unpublished', publishedAt: undefined, courseName: '尚未發布的成績' }),
      grade({ id: 'scheduled', publishedAt: '2999-01-01T00:00:00Z', courseName: '未來發布成績' }),
    ]);
  const view = render(<GradesAiFirstScreen />);
  await view.findByText('已發布的課程');
  expect(view.getByText('87 分')).toBeTruthy();
  expect(
    view.queryByText(/其他人的成績|其他學校成績|學校不明的成績|尚未發布的成績|未來發布成績/),
  ).toBeNull();
  expect(view.queryByText(/GPA|3\.63|61%|15 \/ 89|預測/)).toBeNull();
  expect(firebaseSource.listGrades).toHaveBeenCalledWith('user-a', undefined, 'school-a');
  fireEvent.press(view.getByText('查看課內成績'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'LearnHome');
});

test('grades ignore an old account response after switching to a new identity', async () => {
  const pending = deferred<Grade[]>();
  jest.mocked(firebaseSource.listGrades).mockReturnValueOnce(pending.promise);
  const view = render(<GradesAiFirstScreen />);
  mockAuth = {
    user: { uid: 'user-b' },
    profile: { uid: 'user-b', schoolId: 'school-b', role: 'student' },
  };
  jest
    .mocked(firebaseSource.listGrades)
    .mockResolvedValueOnce([
      grade({ userId: 'user-b', schoolId: 'school-b', courseName: '新帳號成績' }),
    ]);
  view.rerender(<GradesAiFirstScreen />);
  await view.findByText('新帳號成績');
  await act(async () => pending.resolve([grade({ courseName: '過期成績' })]));
  expect(view.queryByText('過期成績')).toBeNull();
});

test('academic overview uses real memberships and correct actionable destinations without invented metrics', async () => {
  const data = home();
  data.tasks = [
    {
      id: 'live',
      kind: 'live',
      groupId: 'group-1',
      groupName: '已加入的課程',
      title: '正在點名',
      subtitle: '',
      priority: 0,
      sessionId: 'session-1',
    },
    {
      id: 'foreign',
      kind: 'assignment',
      groupId: 'foreign',
      groupName: '其他課程',
      title: '不屬於我的任務',
      subtitle: '',
      priority: 0,
    },
  ];
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<AcademicOverviewAiFirstScreen />);
  await view.findByText('正在點名');
  expect(view.queryByText(/96%|88\.4|18 學分|預估|不屬於我的任務/)).toBeNull();
  fireEvent.press(view.getByText('學分試算'));
  expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'CreditAuditStack');
  fireEvent.press(view.getByText('正在點名'));
  expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'Classroom', {
    groupId: 'group-1',
    groupName: '已加入的課程',
    sessionId: 'session-1',
  });
});

test('academic role or school changes clear earlier course data before the replacement request resolves', async () => {
  const view = render(<AcademicOverviewAiFirstScreen />);
  await view.findByText('已加入的課程');
  const pending = deferred<ReturnType<typeof home>>();
  jest.mocked(loadStudentHome).mockReturnValueOnce(pending.promise);
  mockAuth.profile = { ...mockAuth.profile, schoolId: 'school-b' };
  view.rerender(<AcademicOverviewAiFirstScreen />);
  expect(view.queryByText('已加入的課程')).toBeNull();
  await act(async () => pending.resolve(home('新學校課程')));
  expect(view.getByText('新學校課程')).toBeTruthy();
});

test('achievements require actual personal records and never grant catalog-only badges or fictional XP', async () => {
  jest
    .mocked(firebaseSource.getUserAchievements)
    .mockResolvedValue([
      achievement({ name: undefined, achievementId: 'catalog-1' }),
      achievement({ id: 'other-user', userId: 'user-b', name: '別人成就' }),
      achievement({ id: 'other-school', schoolId: 'school-b', name: '其他學校成就' }),
      achievement({ id: 'unscoped', schoolId: undefined, name: '學校不明成就' }),
    ]);
  jest.mocked(firebaseSource.listAchievements).mockResolvedValue([
    { id: 'catalog-1', name: '真正的徽章名稱', progress: 0 },
    { id: 'unearned', name: '未取得的徽章', progress: 0 },
  ]);
  const view = render(<AchievementsAiFirstScreen />);
  await view.findByText('真正的徽章名稱');
  expect(view.getByText('已完成')).toBeTruthy();
  expect(
    view.queryByText(/別人成就|其他學校成就|學校不明成就|未取得的徽章|XP|73%|Level|10\/12/),
  ).toBeNull();
  expect(firebaseSource.getUserAchievements).toHaveBeenCalledWith('user-a', 'school-a');
});

test('achievement progress alone never becomes a completed badge', async () => {
  jest
    .mocked(firebaseSource.getUserAchievements)
    .mockResolvedValue([achievement({ progress: 9999, completed: false, unlockedAt: undefined })]);
  const view = render(<AchievementsAiFirstScreen />);
  await view.findByText('已記錄的成就');
  expect(view.getByText('已記錄')).toBeTruthy();
  expect(view.queryByText('已完成')).toBeNull();
  expect(view.queryByText(/9999|XP/)).toBeNull();
});

test('an empty achievement account stays empty and keeps a real course task entry', async () => {
  jest.mocked(firebaseSource.getUserAchievements).mockResolvedValue([]);
  const view = render(<AchievementsAiFirstScreen />);
  await view.findByText('目前沒有可顯示的成就紀錄。課程與待辦仍可正常使用。');
  expect(view.queryByText(/初登入|七日連登|已解鎖/)).toBeNull();
  fireEvent.press(view.getByText('課程與待辦'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'LearnHome');
});

test('achievement data disappears on school change and old pending responses cannot replace it', async () => {
  const pending = deferred<UserAchievement[]>();
  jest.mocked(firebaseSource.getUserAchievements).mockReturnValueOnce(pending.promise);
  const view = render(<AchievementsAiFirstScreen />);
  mockAuth.profile = { ...mockAuth.profile, schoolId: 'school-b' };
  jest
    .mocked(firebaseSource.getUserAchievements)
    .mockResolvedValueOnce([achievement({ schoolId: 'school-b', name: '新學校成就' })]);
  view.rerender(<AchievementsAiFirstScreen />);
  await view.findByText('新學校成就');
  await act(async () => pending.resolve([achievement({ name: '舊學校成就' })]));
  expect(view.queryByText('舊學校成就')).toBeNull();
});

test.each([
  {
    name: 'grades',
    Screen: GradesAiFirstScreen,
    reject: () =>
      jest.mocked(firebaseSource.listGrades).mockRejectedValueOnce(new Error('permission-denied')),
    message: '無法讀取成績，請確認登入狀態與網路後重試。',
    restored: '已發布的課程',
  },
  {
    name: 'overview',
    Screen: AcademicOverviewAiFirstScreen,
    reject: () =>
      jest.mocked(loadStudentHome).mockRejectedValueOnce(new Error('permission-denied')),
    message: '無法讀取學業資料，請確認登入狀態與網路後重試。',
    restored: '已加入的課程',
  },
  {
    name: 'achievements',
    Screen: AchievementsAiFirstScreen,
    reject: () =>
      jest
        .mocked(firebaseSource.getUserAchievements)
        .mockRejectedValueOnce(new Error('permission-denied')),
    message: '無法讀取成就紀錄，請確認登入狀態與網路後重試。',
    restored: '已記錄的成就',
  },
])(
  '$name exposes load errors and only restores content after a successful retry',
  async ({ Screen, reject, message, restored }) => {
    reject();
    const view = render(<Screen />);
    await view.findByText(message);
    expect(view.queryByText(/目前沒有可顯示|目前沒有已加入|尚無可確認/)).toBeNull();
    fireEvent.press(view.getByText('重新讀取'));
    await view.findByText(restored);
  },
);
