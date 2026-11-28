import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import CourseQuizTakingV2Screen from '../screens/lmsV2/CourseQuizTakingV2Screen';
import {
  loadLmsQuizWorkspace, beginLmsQuizAttempt, storeLmsQuizAnswer, finishLmsQuizAttempt,
} from '../services/lmsV2QuizDelivery';
import { useUnsavedQuizExit } from '../hooks/useUnsavedQuizExit';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '66666666-6666-4666-8666-666666666666';
let mockUid = userA;
let mockBlur: () => void;
let mockRefocus: () => void;

jest.mock('../hooks/useUnsavedQuizExit', () => ({ useUnsavedQuizExit: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => () => void) => {
    require('react').useEffect(() => {
      let cleanup = effect();
      mockBlur = () => cleanup();
      mockRefocus = () => { cleanup = effect(); };
      return () => cleanup();
    }, [effect]);
  },
  useRoute: () => ({
    params: {
      courseId: '22222222-2222-4222-8222-222222222222',
      quizId: '33333333-3333-4333-8333-333333333333',
      courseName: '資料庫系統',
    },
  }),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: mockUid } }),
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const lastGuard = () => jest.mocked(useUnsavedQuizExit).mock.calls.at(-1)?.slice(0, 2);
const secondQuestion = { ...question, id: '77777777-7777-4777-8777-777777777777', prompt: '什麼是交易？' };
// Workspace A has an active two-question attempt; workspace B belongs to another account.
const loadByAccount = () => jest.mocked(loadLmsQuizWorkspace).mockImplementation(async () => (
  mockUid === userA
    ? { quiz, attempt, attemptCount: 1, questions: [question, secondQuestion], answers: {} }
    : { quiz, attempt, attemptCount: 1, questions: [question], answers: { [questionId]: 'B 的答案' } }
));

beforeEach(() => {
  jest.resetAllMocks();
  mockUid = userA;
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

test('exit guard follows dirty answers on an active attempt, busy writes, and failed saves', async () => {
  jest.mocked(loadLmsQuizWorkspace).mockResolvedValue({
    quiz, attempt, attemptCount: 1, questions: [question], answers: { [questionId]: '原本答案' },
  });
  const pending = deferred<Awaited<ReturnType<typeof storeLmsQuizAnswer>>>();
  jest.mocked(storeLmsQuizAnswer)
    .mockResolvedValueOnce({ success: false, summary: '網路失敗', errorCode: 'supabase_error' })
    .mockReturnValueOnce(pending.promise);
  const view = render(<CourseQuizTakingV2Screen />);
  const input = await view.findByPlaceholderText('輸入簡答');
  expect(lastGuard()).toEqual([false, false]);
  fireEvent.changeText(input, '新答案');
  expect(lastGuard()).toEqual([true, false]);
  fireEvent.press(view.getByText('儲存變更（1 題）'));
  await view.findByText(/網路失敗/);
  expect(lastGuard()).toEqual([true, false]);
  fireEvent.press(view.getByText('儲存變更（1 題）'));
  await waitFor(() => expect(lastGuard()).toEqual([true, true]));
  await act(async () => { pending.resolve({ success: true, summary: '答案已儲存' }); });
  await view.findByText('答案已儲存');
  expect(lastGuard()).toEqual([false, false]);
});

test('starting an attempt keeps the exit guard busy but clean until the new attempt loads', async () => {
  const started = deferred<Awaited<ReturnType<typeof beginLmsQuizAttempt>>>();
  jest.mocked(loadLmsQuizWorkspace)
    .mockResolvedValueOnce({ quiz, attempt: null, attemptCount: 0, questions: [], answers: {} })
    .mockResolvedValue({ quiz, attempt, attemptCount: 1, questions: [question], answers: {} });
  jest.mocked(beginLmsQuizAttempt).mockReturnValueOnce(started.promise);
  const view = render(<CourseQuizTakingV2Screen />);
  fireEvent.press(await view.findByText('開始作答'));
  await waitFor(() => expect(lastGuard()).toEqual([false, true]));
  await act(async () => { started.resolve({ success: true, summary: '已開始作答', data: { attemptId } }); });
  await view.findByPlaceholderText('輸入簡答');
  await view.findByText('已開始作答');
  await waitFor(() => expect(lastGuard()).toEqual([false, false]));
});

test('an account switch drops a pending save chain before it can write more answers or refresh', async () => {
  loadByAccount();
  const pending = deferred<Awaited<ReturnType<typeof storeLmsQuizAnswer>>>();
  jest.mocked(storeLmsQuizAnswer).mockReturnValueOnce(pending.promise);
  const view = render(<CourseQuizTakingV2Screen />);
  const inputs = await view.findAllByPlaceholderText('輸入簡答');
  fireEvent.changeText(inputs[0], 'A 的草稿一');
  fireEvent.changeText(inputs[1], 'A 的草稿二');
  fireEvent.press(view.getByText('儲存變更（2 題）'));
  await waitFor(() => expect(storeLmsQuizAnswer).toHaveBeenCalledTimes(1));

  mockUid = userB;
  view.rerender(<CourseQuizTakingV2Screen />);
  await waitFor(() => expect(view.getByPlaceholderText('輸入簡答').props.value).toBe('B 的答案'));
  expect(lastGuard()).toEqual([false, false]);
  await act(async () => { pending.resolve({ success: true, summary: '答案已儲存' }); });

  expect(storeLmsQuizAnswer).toHaveBeenCalledTimes(1);
  expect(loadLmsQuizWorkspace).toHaveBeenCalledTimes(2);
  expect(view.queryByText(/所有變更已由伺服器確認儲存/)).toBeNull();
  expect(view.getByPlaceholderText('輸入簡答').props.value).toBe('B 的答案');
  expect(lastGuard()).toEqual([false, false]);
});

test.each(['save', 'submit'])('an account switch during a pending %s never submits or alerts for the old chain', async (stage) => {
  loadByAccount();
  const pendingSave = deferred<Awaited<ReturnType<typeof storeLmsQuizAnswer>>>();
  const pendingFinish = deferred<Awaited<ReturnType<typeof finishLmsQuizAttempt>>>();
  jest.mocked(storeLmsQuizAnswer).mockReturnValueOnce(
    stage === 'save' ? pendingSave.promise : Promise.resolve({ success: true, summary: '答案已儲存' }),
  );
  jest.mocked(finishLmsQuizAttempt).mockReturnValueOnce(pendingFinish.promise);
  const view = render(<CourseQuizTakingV2Screen />);
  fireEvent.changeText((await view.findAllByPlaceholderText('輸入簡答'))[0], 'A 的草稿');
  fireEvent.press(view.getByText('確認交卷'));
  const confirm = jest.mocked(Alert.alert).mock.calls
    .find(([title]) => title === '確認交卷')?.[2]?.find((item) => item.text === '確認交卷');
  await act(async () => { confirm?.onPress?.(); });
  if (stage === 'submit') await waitFor(() => expect(finishLmsQuizAttempt).toHaveBeenCalledTimes(1));
  else expect(finishLmsQuizAttempt).not.toHaveBeenCalled();

  mockUid = userB;
  view.rerender(<CourseQuizTakingV2Screen />);
  await waitFor(() => expect(view.getByPlaceholderText('輸入簡答').props.value).toBe('B 的答案'));
  await act(async () => {
    pendingSave.resolve({ success: true, summary: '答案已儲存' });
    pendingFinish.resolve({ success: true, summary: '伺服器已確認交卷' });
  });

  expect(finishLmsQuizAttempt).toHaveBeenCalledTimes(stage === 'submit' ? 1 : 0);
  expect(loadLmsQuizWorkspace).toHaveBeenCalledTimes(2);
  expect(Alert.alert).not.toHaveBeenCalledWith('交卷已確認', expect.anything());
  expect(view.queryByText('伺服器已確認交卷')).toBeNull();
  expect(view.getByPlaceholderText('輸入簡答').props.value).toBe('B 的答案');
});

test('undoing a text or multiple-choice edit returns to the confirmed answer without a leave prompt', async () => {
  const choice = { ...secondQuestion, question_type: 'multiple', choices: ['A', 'B'] };
  jest.mocked(loadLmsQuizWorkspace).mockResolvedValue({
    quiz, attempt, attemptCount: 1, questions: [question, choice], answers: { [choice.id]: ['A', 'B'] },
  });
  const view = render(<CourseQuizTakingV2Screen />);
  const input = await view.findByPlaceholderText('輸入簡答');
  fireEvent.changeText(input, '打算回答');
  expect(lastGuard()).toEqual([true, false]);
  fireEvent.changeText(input, '');
  expect(lastGuard()).toEqual([false, false]);
  const option = view.getByRole('checkbox', { name: 'A' });
  fireEvent.press(option);
  expect(lastGuard()).toEqual([true, false]);
  fireEvent.press(option);
  expect(lastGuard()).toEqual([false, false]);
  expect(storeLmsQuizAnswer).not.toHaveBeenCalled();
});

test('an open submit confirmation cannot submit an answer edited after the prompt', async () => {
  loadByAccount();
  const view = render(<CourseQuizTakingV2Screen />);
  const [input] = await view.findAllByPlaceholderText('輸入簡答');
  fireEvent.changeText(input, '第一版');
  fireEvent.press(view.getByText('確認交卷'));
  const confirm = jest.mocked(Alert.alert).mock.lastCall?.[2]?.find(item => item.text === '確認交卷');
  expect(confirm).toBeDefined();
  fireEvent.changeText(input, '第二版');
  await act(async () => { confirm!.onPress?.(); });
  expect(storeLmsQuizAnswer).not.toHaveBeenCalled();
  expect(finishLmsQuizAttempt).not.toHaveBeenCalled();
  expect(lastGuard()).toEqual([true, false]);
});

test('returning to the same quiz requires a new submit confirmation', async () => {
  loadByAccount();
  const view = render(<CourseQuizTakingV2Screen />);
  fireEvent.press(await view.findByText('確認交卷'));
  const confirm = jest.mocked(Alert.alert).mock.lastCall?.[2]?.find(item => item.text === '確認交卷');
  expect(confirm).toBeDefined();
  act(() => { mockBlur(); mockRefocus(); });
  await act(async () => { confirm!.onPress?.(); });
  expect(finishLmsQuizAttempt).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('確認交卷'));
  const newConfirm = jest.mocked(Alert.alert).mock.lastCall?.[2]?.find(item => item.text === '確認交卷');
  await act(async () => { newConfirm!.onPress?.(); });
  expect(finishLmsQuizAttempt).toHaveBeenCalledTimes(1);
});

test('a submission confirmed after leaving the quiz does not interrupt another screen', async () => {
  loadByAccount();
  const pending = deferred<Awaited<ReturnType<typeof finishLmsQuizAttempt>>>();
  jest.mocked(finishLmsQuizAttempt).mockReturnValueOnce(pending.promise);
  const view = render(<CourseQuizTakingV2Screen />);
  fireEvent.press(await view.findByText('確認交卷'));
  const confirm = jest.mocked(Alert.alert).mock.lastCall?.[2]?.find(item => item.text === '確認交卷');
  await act(async () => { confirm!.onPress?.(); });
  expect(finishLmsQuizAttempt).toHaveBeenCalledTimes(1);
  act(() => mockBlur());
  await act(async () => { pending.resolve({ success: true, summary: '已交卷' }); });
  expect(Alert.alert).not.toHaveBeenCalledWith('交卷已確認', expect.anything());
});
