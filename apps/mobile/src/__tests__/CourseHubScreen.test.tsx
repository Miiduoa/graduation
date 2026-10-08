import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import CourseHub from '../screens/CourseHubAiFirstScreen';
import { loadCourseHub, type CourseHubData } from '../features/courseHub';
import { safeNavigate } from '../utils/safeNavigate';
import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
let mockUser: { uid: string } | null = { uid: 'alice' };
let mockSchool = { id: 'pu' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../features/courseHub', () => ({ loadCourseHub: jest.fn() }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../services/tronClassWebUiGate', () => ({
  webBrowserOpenWithPuTronClassGate: jest.fn(),
}));
const data: CourseHubData = {
  name: '資訊倫理',
  description: '課程說明',
  details: [],
  materials: { status: 'ready', items: [] },
  assignments: { status: 'ready', items: [] },
};
const route = { params: { groupId: 'course-a', groupName: '過時的課名' } };
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'alice' };
  mockSchool = { id: 'pu' };
  jest.mocked(loadCourseHub).mockResolvedValue(data);
  jest.mocked(webBrowserOpenWithPuTronClassGate).mockResolvedValue(true);
});
test('uses real course name with scoped useful actions and no invented outcomes', async () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<CourseHub route={route} navigation={navigation} />);
  await view.findByText('資訊倫理');
  expect(
    view.queryByText(/過時的課名|CS302|13\/15|6\/7|88|A-|摘要已開啟|繳交作業|開始測驗/),
  ).toBeNull();
  expect(view.getByText('尚未發布作業。')).toBeTruthy();
  fireEvent.press(view.getByText('測驗通知'));
  expect(safeNavigate).toHaveBeenLastCalledWith(navigation, 'QuizCenter', {
    groupId: 'course-a',
    groupName: '資訊倫理',
  });
  fireEvent.press(view.getByText('課程群組與公告'));
  expect(safeNavigate).toHaveBeenLastCalledWith(navigation, 'GroupDetail', {
    groupId: 'course-a',
    groupName: '資訊倫理',
  });
});
test('unidentified courses and signed-out accounts never acquire default course content', () => {
  const view = render(<CourseHub route={{ params: { courseId: 'CS302' } }} />);
  expect(view.getByText('請先選擇課程')).toBeTruthy();
  expect(loadCourseHub).not.toHaveBeenCalled();
  mockUser = null;
  view.rerender(<CourseHub route={route} />);
  expect(view.getByText('登入後查看課程')).toBeTruthy();
  expect(loadCourseHub).not.toHaveBeenCalled();
});
test('read failures offer retry and are not described as empty coursework', async () => {
  jest.mocked(loadCourseHub).mockRejectedValueOnce(new Error('無法連線'));
  const view = render(<CourseHub route={route} />);
  await view.findByText('目前無法讀取課程');
  expect(view.queryByText('尚未發布作業。')).toBeNull();
  fireEvent.press(view.getByText('重新讀取課程'));
  await view.findByText('資訊倫理');
});
test('partial read failures stay distinct and an attachment opening failure never reports success', async () => {
  jest
    .mocked(loadCourseHub)
    .mockResolvedValue({
      ...data,
      assignments: { status: 'error', items: [] },
      materials: {
        status: 'ready',
        items: [
          {
            id: 'm1',
            title: '課堂閱讀',
            description: '',
            url: 'https://school.test/reading',
            order: 1,
          },
        ],
      },
    });
  jest.mocked(webBrowserOpenWithPuTronClassGate).mockResolvedValue(false);
  const view = render(<CourseHub route={route} />);
  await view.findByText('課堂閱讀');
  expect(view.getByText('作業讀取失敗，請更新課程資料後重試。')).toBeTruthy();
  fireEvent.press(view.getByText('開啟教材：課堂閱讀'));
  await view.findByText('目前無法開啟連結，請稍後再試。');
  expect(webBrowserOpenWithPuTronClassGate).toHaveBeenCalledWith('https://school.test/reading');
});
test('TronClass route opens exactly the selected official course and never Firestore quiz', async () => {
  const view = render(<CourseHub route={{ params: { source: 'tronclass', courseId: 321 } }} />);
  await view.findByText('開啟校方課程');
  expect(view.queryByText('測驗通知')).toBeNull();
  expect(view.queryByText('尚未發布作業。')).toBeNull();
  fireEvent.press(view.getByText('開啟校方課程'));
  await act(async () => {});
  expect(webBrowserOpenWithPuTronClassGate).toHaveBeenCalledWith(
    'https://tronclass.pu.edu.tw/course/321/content',
  );
});
test.each(['account', 'school', 'course'])(
  'changing %s excludes a pending old response and invalidates its request guard',
  async (kind) => {
    let finish!: (value: CourseHubData) => void;
    jest.mocked(loadCourseHub).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<CourseHub route={route} />);
    const oldGuard = jest.mocked(loadCourseHub).mock.calls[0][1]!;
    if (kind === 'account') mockUser = { uid: 'bob' };
    if (kind === 'school') mockSchool = { id: 'school-b' };
    view.rerender(
      <CourseHub route={kind === 'course' ? { params: { groupId: 'course-b' } } : route} />,
    );
    await view.findByText('資訊倫理');
    expect(oldGuard()).toBe(false);
    await act(async () => {
      finish({ ...data, name: '前一個身分的課程' });
    });
    expect(view.queryByText('前一個身分的課程')).toBeNull();
  },
);
