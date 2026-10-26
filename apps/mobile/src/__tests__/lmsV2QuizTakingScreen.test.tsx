import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import CourseQuizTakingV2Screen from '../screens/lmsV2/CourseQuizTakingV2Screen';
import {
  loadLmsQuizWorkspace, beginLmsQuizAttempt, storeLmsQuizAnswer, finishLmsQuizAttempt,
} from '../services/lmsV2QuizDelivery';

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({
    params: {
      courseId: '22222222-2222-4222-8222-222222222222',
      quizId: '33333333-3333-4333-8333-333333333333',
      courseName: '資料庫系統',
    },
  }),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../services/lmsV2QuizDelivery', () => ({
  loadLmsQuizWorkspace: jest.fn(),
  beginLmsQuizAttempt: jest.fn(),
  storeLmsQuizAnswer: jest.fn(),
  finishLmsQuizAttempt: jest.fn(),
}));

const quizId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const questionId = '55555555-5555-4555-8555-555555555555';
const quiz = {
  id: quizId, course_id: '22222222-2222-4222-8222-222222222222',
  title: '小考', description: '基本觀念', max_attempts: 2,
  time_limit_seconds: 900, enforce_time_limit: true, pool_pick_count: null,
};
const attempt = {
  id: attemptId, quiz_id: quizId,
  student_id: '11111111-1111-4111-8111-111111111111',
  attempt_no: 1, started_at: '2026-10-26T12:00:00Z',
  submitted_at: null, score: null, drawn_question_ids: null,
};
const question = {
  id: questionId, quiz_id: quizId, question_type: 'short',
  prompt: '什麼是資料庫？', choices: null, points: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(beginLmsQuizAttempt).mockResolvedValue({
    success: true, summary: '已開始作答', data: { attemptId },
  });
  jest.mocked(storeLmsQuizAnswer).mockResolvedValue({ success: true, summary: '答案已儲存' });
  jest.mocked(finishLmsQuizAttempt).mockResolvedValue({
    success: true, summary: '伺服器已確認交卷',
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('opening the quiz never consumes a new attempt before an explicit start press', async () => {
  jest.mocked(loadLmsQuizWorkspace).mockResolvedValue({
    quiz, attempt: null, attemptCount: 0, questions: [], answers: {},
  });
  const view = render(<CourseQuizTakingV2Screen />);
  await view.findByText('開始作答');
  expect(beginLmsQuizAttempt).not.toHaveBeenCalled();
  expect(finishLmsQuizAttempt).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('開始作答'));
  await waitFor(() => expect(beginLmsQuizAttempt).toHaveBeenCalledTimes(1));
});

test('editing and saving one answer confirms it without silently submitting the quiz', async () => {
  jest.mocked(loadLmsQuizWorkspace).mockResolvedValue({
    quiz, attempt, attemptCount: 1, questions: [question], answers: { [questionId]: '原本答案' },
  });
  const view = render(<CourseQuizTakingV2Screen />);
  const input = await view.findByPlaceholderText('輸入簡答');
  expect(input.props.value).toBe('原本答案');
  fireEvent.changeText(input, '我的新答案');
  fireEvent.press(view.getByText('儲存變更（1 題）'));
  await waitFor(() => expect(storeLmsQuizAnswer).toHaveBeenCalledWith({
    attemptId, questionId, answer: '我的新答案',
  }));
  await view.findByText(/所有變更已由伺服器確認儲存/);
  expect(finishLmsQuizAttempt).not.toHaveBeenCalled();
});

test('server save failure preserves unsaved input and prevents a false success message', async () => {
  jest.mocked(loadLmsQuizWorkspace).mockResolvedValue({
    quiz, attempt, attemptCount: 1, questions: [question], answers: {},
  });
  jest.mocked(storeLmsQuizAnswer).mockResolvedValue({ success: false, summary: '網路失敗', errorCode: 'supabase_error' });
  const view = render(<CourseQuizTakingV2Screen />);
  const input = await view.findByPlaceholderText('輸入簡答');
  fireEvent.changeText(input, '要保留的作答');
  fireEvent.press(view.getByText('儲存變更（1 題）'));
  await view.findByText(/網路失敗/);
  expect(view.getByPlaceholderText('輸入簡答').props.value).toBe('要保留的作答');
  expect(finishLmsQuizAttempt).not.toHaveBeenCalled();
});

test('the student must explicitly confirm a final submission', async () => {
  jest.mocked(loadLmsQuizWorkspace).mockResolvedValue({
    quiz, attempt, attemptCount: 1, questions: [question], answers: {},
  });
  const view = render(<CourseQuizTakingV2Screen />);
  await view.findByText('確認交卷');
  fireEvent.press(view.getByText('確認交卷'));
  expect(finishLmsQuizAttempt).not.toHaveBeenCalled();
  const alert = jest.mocked(Alert.alert).mock.calls.find(([title]) => title === '確認交卷');
  expect(alert).toBeTruthy();
  const confirm = alert?.[2]?.find((item) => item.text === '確認交卷');
  await act(async () => { confirm?.onPress?.(); });
  await waitFor(() => expect(finishLmsQuizAttempt).toHaveBeenCalledWith({ attemptId }));
});

test('a submitted record shows its server receipt without allowing another accidental edit', async () => {
  jest.mocked(loadLmsQuizWorkspace).mockResolvedValue({
    quiz: { ...quiz, max_attempts: 1 },
    attempt: { ...attempt, submitted_at: '2026-10-26T12:05:00Z', score: 0 },
    attemptCount: 1, questions: [], answers: {},
  });
  const view = render(<CourseQuizTakingV2Screen />);
  await view.findByText('本次測驗已交卷');
  expect(view.getByText('目前登記分數：0')).toBeTruthy();
  expect(view.queryByText('確認交卷')).toBeNull();
  expect(beginLmsQuizAttempt).not.toHaveBeenCalled();
});
