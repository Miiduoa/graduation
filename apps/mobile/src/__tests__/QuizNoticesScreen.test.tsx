import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import QuizCenterAiFirstScreen from '../screens/QuizCenterAiFirstScreen';
import { QuizTakingScreen } from '../screens/QuizTakingScreen';
import { loadCourseQuizNotices, type CourseQuizNotices } from '../features/courseQuizzes';

let mockUser: { uid: string } | null = { uid: 'alice' };
let mockSchool = { id: 'pu' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').getCurrentTheme() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../features/courseQuizzes', () => ({ loadCourseQuizNotices: jest.fn() }));
const load = jest.mocked(loadCourseQuizNotices);
const result: CourseQuizNotices = {
  groupId: 'course',
  groupName: '正式課程',
  hasMore: false,
  notices: [
    {
      id: 'one',
      title: '教師發布的測驗',
      description: '依課堂公告應試',
      dueAt: null,
      type: 'quiz',
    },
  ],
};
const route = { params: { groupId: 'course' } };
beforeEach(() => {
  jest.resetAllMocks();
  mockUser = { uid: 'alice' };
  mockSchool = { id: 'pu' };
  load.mockResolvedValue(result);
});

test('shows only verified announcements and makes the response boundary clear', async () => {
  const view = render(<QuizCenterAiFirstScreen route={route} />);
  await waitFor(() => expect(view.getByText('教師發布的測驗')).toBeTruthy());
  expect(load).toHaveBeenCalledWith('alice', 'pu', 'course');
  expect(view.getByText(/未提供 App 內作答與成績回傳/)).toBeTruthy();
  expect(view.queryByText(/提交測驗|測驗成績|開始模擬考|本學期錯題|72%|85|92/)).toBeNull();
});

test('a legacy taking link displays only the selected actual notice', async () => {
  load.mockResolvedValue({
    ...result,
    notices: [...result.notices, { ...result.notices[0], id: 'two', title: '另一份測驗' }],
  });
  const view = render(
    <QuizTakingScreen route={{ params: { groupId: 'course', quizId: 'one' } }} />,
  );
  await waitFor(() => expect(view.getByText('教師發布的測驗')).toBeTruthy());
  expect(view.queryByText('另一份測驗')).toBeNull();
  expect(
    view
      .queryAllByRole('button')
      .filter((button) => /提交|作答/.test(String(button.props.accessibilityLabel))),
  ).toHaveLength(0);
});

test('keeps failure retryable and distinct from confirmed emptiness', async () => {
  load.mockRejectedValueOnce(new Error('offline'));
  const view = render(<QuizCenterAiFirstScreen route={route} />);
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(view.queryByText('尚無已發布的測驗通知')).toBeNull();
  load.mockResolvedValueOnce({ ...result, notices: [] });
  fireEvent.press(view.getByText('重新載入'));
  await waitFor(() => expect(view.getByText('尚無已發布的測驗通知')).toBeTruthy());
});

test('never substitutes an invented notice for a missing requested quiz', async () => {
  const view = render(
    <QuizTakingScreen route={{ params: { groupId: 'course', quizId: 'missing' } }} />,
  );
  await waitFor(() => expect(view.getByText('找不到這份測驗通知')).toBeTruthy());
  expect(view.queryByText('教師發布的測驗')).toBeNull();
});

test.each(['account', 'school'])(
  'discards a late response and old route after changing %s',
  async (change) => {
    let resolve!: (data: CourseQuizNotices) => void;
    load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<QuizCenterAiFirstScreen route={route} />);
    if (change === 'account') mockUser = { uid: 'bob' };
    else mockSchool = { id: 'another' };
    view.rerender(<QuizCenterAiFirstScreen route={route} />);
    await act(async () => resolve(result));
    expect(view.queryByText('教師發布的測驗')).toBeNull();
    expect(view.getByText('先選擇課程')).toBeTruthy();
    mockUser = { uid: 'alice' };
    mockSchool = { id: 'pu' };
    view.rerender(<QuizCenterAiFirstScreen route={route} />);
    expect(view.getByText('先選擇課程')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  },
);

test('does not load private notices while signed out or without a course', () => {
  mockUser = null;
  const view = render(<QuizCenterAiFirstScreen route={route} />);
  expect(view.getByText('登入後查看')).toBeTruthy();
  mockUser = { uid: 'alice' };
  view.rerender(<QuizCenterAiFirstScreen />);
  expect(view.getByText('先選擇課程')).toBeTruthy();
  expect(load).not.toHaveBeenCalled();
});
