import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QuizTakingScreen } from '../screens/QuizTakingScreen';

const mockSource = {
  getQuiz: jest.fn(),
  getSubmission: jest.fn(),
  submitQuiz: jest.fn(),
};

jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: 'alice' }, profile: { schoolId: 'pu' } }),
}));
jest.mock('../hooks/useDataSource', () => ({
  useDataSource: () => mockSource,
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSource.getQuiz.mockResolvedValue({
    id: 'quiz-1',
    assignmentId: 'quiz-1',
    groupId: 'course',
    groupName: '資料結構',
    title: '小考一',
    description: '選擇正確答案',
    type: 'quiz',
    source: 'assignment',
    questions: [
      {
        id: 'q1',
        prompt: '2 + 2 = ?',
        type: 'single_choice',
        options: [
          { id: 'a', label: '3', value: '3' },
          { id: 'b', label: '4', value: '4' },
        ],
      },
    ],
  });
  mockSource.getSubmission.mockResolvedValue(null);
  mockSource.submitQuiz.mockResolvedValue({ id: 'alice' });
});

test('submits structured answers through the existing quiz write path', async () => {
  const view = render(
    <QuizTakingScreen route={{ params: { groupId: 'course', quizId: 'quiz-1' } }} />,
  );
  expect(await view.findByText('小考一')).toBeTruthy();
  fireEvent.press(view.getByLabelText('4'));
  await act(async () => fireEvent.press(view.getByLabelText('繳交評量')));
  expect(mockSource.submitQuiz).toHaveBeenCalledWith({
    courseSpaceId: 'course',
    quizId: 'quiz-1',
    userId: 'alice',
    content: '',
    answers: { q1: '4' },
  });
});

test('allows a text attempt when the quiz has no questions', async () => {
  mockSource.getQuiz.mockResolvedValue({
    id: 'quiz-1',
    assignmentId: 'quiz-1',
    groupId: 'course',
    groupName: '資料結構',
    title: '課堂測驗',
    description: '依公告作答',
    type: 'quiz',
    source: 'assignment',
  });
  const view = render(
    <QuizTakingScreen route={{ params: { groupId: 'course', quizId: 'quiz-1' } }} />,
  );
  fireEvent.changeText(await view.findByLabelText('作答內容'), '我的答案');
  await act(async () => fireEvent.press(view.getByLabelText('繳交評量')));
  expect(mockSource.submitQuiz).toHaveBeenCalledWith({
    courseSpaceId: 'course',
    quizId: 'quiz-1',
    userId: 'alice',
    content: '我的答案',
    answers: { response: '我的答案' },
  });
});
