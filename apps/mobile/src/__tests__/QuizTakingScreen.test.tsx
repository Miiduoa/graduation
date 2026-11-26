import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { NavigationAction } from '@react-navigation/native';
import { Alert } from 'react-native';
import { QuizTakingScreen } from '../screens/QuizTakingScreen';

const mockNavigation = { goBack: jest.fn(), isFocused: () => true, dispatch: jest.fn() };
let mockUid = 'alice';
let mockSchool = 'pu';
let mockBlocked = false;
let mockAttemptExit: (event: { data: { action: NavigationAction } }) => void;
let mockRefocus: () => void;
const back = { type: 'GO_BACK', source: 'quiz' };
const mockSource = {
  getQuiz: jest.fn(),
  getSubmission: jest.fn(),
  submitQuiz: jest.fn(),
};

jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: mockUid }, profile: { schoolId: 'pu' } }),
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../hooks/useDataSource', () => ({
  useDataSource: () => mockSource,
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useIsFocused: () => true,
  usePreventRemove: (blocked: boolean, callback: typeof mockAttemptExit) => {
    mockBlocked = blocked;
    mockAttemptExit = callback;
  },
  useFocusEffect: (callback: () => () => void) => require('react').useEffect(() => {
    let blur = callback();
    mockRefocus = () => { blur(); blur = callback(); };
    return () => blur();
  }, [callback]),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'alice';
  mockSchool = 'pu';
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
  mockSource.submitQuiz.mockResolvedValue({ id: 'alice', submittedAt: '2026-11-24T01:00:00Z' });
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

function lastButton(label: string) {
  const options = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const action = options?.find((button) => button.text === label)?.onPress;
  if (!action) throw new Error('Missing alert action ' + label);
  return action;
}

const route = { params: { groupId: 'course', quizId: 'quiz-1' } };

test('back prompts once and cancellation keeps the local choice across refocus', async () => {
  const view = render(<QuizTakingScreen route={route} />);
  const choice = await view.findByLabelText('4');
  expect(mockBlocked).toBe(false);
  fireEvent.press(choice);
  expect(mockBlocked).toBe(true);
  act(() => {
    mockAttemptExit({ data: { action: back } });
    mockAttemptExit({ data: { action: back } });
  });
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  act(() => lastButton('繼續作答')());
  await act(async () => mockRefocus());
  expect(view.getByLabelText('4').props.accessibilityState.selected).toBe(true);
  act(() => mockAttemptExit({ data: { action: back } }));
  const leave = lastButton('捨棄並離開');
  act(() => { leave(); leave(); });
  expect(mockNavigation.dispatch).toHaveBeenCalledTimes(1);
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(back);
  expect(mockSource.submitQuiz).not.toHaveBeenCalled();
});

test('restoring a saved answer clears the guard and invalidates the earlier prompt', async () => {
  mockSource.getSubmission.mockResolvedValue({ answers: { q1: '3' } });
  const view = render(<QuizTakingScreen route={route} />);
  fireEvent.press(await view.findByLabelText('4'));
  act(() => mockAttemptExit({ data: { action: back } }));
  const leave = lastButton('捨棄並離開');
  fireEvent.press(view.getByLabelText('3'));
  expect(mockBlocked).toBe(false);
  act(() => leave());
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
});

test.each(['account', 'school', 'quiz'])('isolates changes and open confirmations across %s switches', async (changed) => {
  const view = render(<QuizTakingScreen route={route} />);
  fireEvent.press(await view.findByLabelText('4'));
  act(() => mockAttemptExit({ data: { action: back } }));
  const leave = lastButton('捨棄並離開');
  if (changed === 'account') mockUid = 'bob';
  if (changed === 'school') mockSchool = 'ncku';
  const next = changed === 'quiz' ? { params: { ...route.params, quizId: 'quiz-2' } } : route;
  view.rerender(<QuizTakingScreen route={next} />);
  expect((await view.findByLabelText('4')).props.accessibilityState.selected).toBe(false);
  expect(mockBlocked).toBe(false);
  act(() => leave());
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
});

test('a pending submit locks the answer, a failure keeps the draft, and a successful retry releases the guard', async () => {
  let reject!: (error: Error) => void;
  mockSource.submitQuiz.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const view = render(<QuizTakingScreen route={route} />);
  fireEvent.press(await view.findByLabelText('4'));
  const submit = view.getByLabelText('繳交評量');
  fireEvent.press(submit);
  act(() => mockAttemptExit({ data: { action: back } }));
  expect(Alert.alert).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('3'));
  expect(view.getByLabelText('4').props.accessibilityState.selected).toBe(true);
  await act(async () => reject(new Error('斷線')));
  expect(mockBlocked).toBe(true);
  await act(async () => fireEvent.press(submit));
  expect(await view.findByText('已繳交')).toBeTruthy();
  expect(mockBlocked).toBe(false);
});

test('refocusing after a question is replaced cannot submit the hidden answer', async () => {
  const view = render(<QuizTakingScreen route={route} />);
  fireEvent.press(await view.findByLabelText('4'));
  mockSource.getQuiz.mockResolvedValue({
    id: 'quiz-1', title: '小考一',
    questions: [{ id: 'q2', prompt: '補充說明', type: 'essay' }],
  });
  await act(async () => mockRefocus());
  expect(mockBlocked).toBe(false);
  await act(async () => fireEvent.press(view.getByLabelText('繳交評量')));
  expect(mockSource.submitQuiz).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('補充說明'), '新的答案');
  await act(async () => fireEvent.press(view.getByLabelText('繳交評量')));
  expect(mockSource.submitQuiz).toHaveBeenCalledWith(expect.objectContaining({ answers: { q2: '新的答案' } }));
});
