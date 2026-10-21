import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import HomeworkSubmitScreen from '../screens/HomeworkSubmitScreen';

const mockNavigate = { goBack: jest.fn() };
const mockSource = {
  getAssignment: jest.fn(),
  getSubmission: jest.fn(),
  submitAssignment: jest.fn(),
};

jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: 'alice' } }),
}));
jest.mock('../hooks/useDataSource', () => ({
  useDataSource: () => mockSource,
}));
jest.mock('../services/companionHooks', () => ({
  onAssignmentSubmitted: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigate,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSource.getAssignment.mockResolvedValue({
    id: 'work',
    groupId: 'course',
    title: '期末報告',
    description: '請寫摘要',
    dueAt: '2099-12-31T16:00:00Z',
    type: 'homework',
    createdBy: 'teacher',
    createdAt: '2026-10-01T00:00:00Z',
  });
  mockSource.getSubmission.mockResolvedValue(null);
  mockSource.submitAssignment.mockResolvedValue({
    id: 'alice',
    assignmentId: 'work',
    userId: 'alice',
    content: '我的答案',
    status: 'submitted',
    submittedAt: '2026-10-19T00:00:00Z',
  });
});

test('loads the assignment from Firestore and submits the same text path as web', async () => {
  const view = render(
    <HomeworkSubmitScreen route={{ params: { courseId: 'course', hwId: 'work' } }} />,
  );
  expect(await view.findByText('期末報告')).toBeTruthy();
  expect(view.getByText('請寫摘要')).toBeTruthy();
  expect(view.getByText(/無法從 App 傳檔/)).toBeTruthy();
  expect(view.getByText(/目前只支援文字繳交/)).toBeTruthy();
  expect(view.queryByText('+ 加檔案')).toBeNull();
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '  我的答案  ');
  await act(async () => fireEvent.press(view.getByLabelText('繳交作業')));
  expect(mockSource.submitAssignment).toHaveBeenCalledWith({
    assignmentId: 'work',
    userId: 'alice',
    groupId: 'course',
    content: '我的答案',
  });
});

test('hides the text-only copy when the Expo file-submit flag is on', async () => {
  const previous = process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED;
  process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED = 'true';
  try {
    const view = render(
      <HomeworkSubmitScreen route={{ params: { courseId: 'course', hwId: 'work' } }} />,
    );
    expect(await view.findByText('期末報告')).toBeTruthy();
    expect(view.queryByText(/無法從 App 傳檔/)).toBeNull();
    expect(view.queryByText(/目前只支援文字繳交/)).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED;
    else process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED = previous;
  }
});

test('maps assignment deep-link params onto the same submit screen', async () => {
  const view = render(
    <HomeworkSubmitScreen
      route={{ params: { groupId: 'course', assignmentId: 'work', title: '深連結作業' } }}
    />,
  );
  await waitFor(() => expect(mockSource.getAssignment).toHaveBeenCalledWith('work', 'course'));
  expect(mockSource.getSubmission).toHaveBeenCalledWith('work', 'alice', 'course');
  expect(await view.findByText('期末報告')).toBeTruthy();
});

test('shows existing submitted text instead of a second write', async () => {
  mockSource.getSubmission.mockResolvedValue({
    id: 'alice',
    assignmentId: 'work',
    userId: 'alice',
    content: '先前繳交的內容',
    status: 'submitted',
    submittedAt: '2026-10-18T00:00:00Z',
  });
  const view = render(
    <HomeworkSubmitScreen route={{ params: { courseId: 'course', hwId: 'work' } }} />,
  );
  expect(await view.findByText('先前繳交的內容')).toBeTruthy();
  expect(view.getByText('你已繳交此作業')).toBeTruthy();
  expect(view.queryByLabelText('繳交作業')).toBeNull();
  expect(mockSource.submitAssignment).not.toHaveBeenCalled();
});

test('shows published gradeScore and gradeFeedback on the assignment page', async () => {
  mockSource.getAssignment.mockResolvedValue({
    id: 'work',
    groupId: 'course',
    title: '期末報告',
    description: '請寫摘要',
    dueAt: '2099-12-31T16:00:00Z',
    type: 'homework',
    points: 100,
    createdBy: 'teacher',
    createdAt: '2026-10-01T00:00:00Z',
  });
  mockSource.getSubmission.mockResolvedValue({
    id: 'alice',
    assignmentId: 'work',
    userId: 'alice',
    content: '先前繳交的內容',
    status: 'submitted',
    submittedAt: '2026-10-18T00:00:00Z',
    gradePublished: true,
    gradeScore: 86,
    gradeFeedback: '結構清楚',
    gradePublishedAt: '2026-10-19T02:00:00.000Z',
  });
  const view = render(
    <HomeworkSubmitScreen route={{ params: { courseId: 'course', hwId: 'work' } }} />,
  );
  expect(await view.findByLabelText('作業評分')).toBeTruthy();
  expect(view.getByText('教師已評分：86 / 100 分')).toBeTruthy();
  expect(view.getByText('結構清楚')).toBeTruthy();
  expect(view.queryByText('課內成績')).toBeNull();
});

test('hides unpublished teacher drafts and old grade fields', async () => {
  mockSource.getSubmission.mockResolvedValue({
    id: 'alice',
    assignmentId: 'work',
    userId: 'alice',
    content: '先前繳交的內容',
    status: 'graded',
    submittedAt: '2026-10-18T00:00:00Z',
    grade: 100,
    feedback: '舊欄位不該出現',
    gradeScore: 72,
    gradeFeedback: '尚未發布',
    gradePublished: false,
  });
  const view = render(
    <HomeworkSubmitScreen route={{ params: { courseId: 'course', hwId: 'work' } }} />,
  );
  expect(await view.findByText('先前繳交的內容')).toBeTruthy();
  expect(view.queryByLabelText('作業評分')).toBeNull();
  expect(view.queryByText('尚未發布')).toBeNull();
  expect(view.queryByText('舊欄位不該出現')).toBeNull();
});

test('does not offer text submit for a quiz assignment', async () => {
  mockSource.getAssignment.mockResolvedValue({
    id: 'quiz-1',
    groupId: 'course',
    title: '小考',
    description: '',
    dueAt: '2099-12-31T16:00:00Z',
    type: 'quiz',
    createdBy: 'teacher',
    createdAt: '2026-10-01T00:00:00Z',
  });
  const view = render(
    <HomeworkSubmitScreen route={{ params: { courseId: 'course', hwId: 'quiz-1' } }} />,
  );
  expect(await view.findByText('請透過評量頁面作答。')).toBeTruthy();
  expect(view.queryByLabelText('繳交作業')).toBeNull();
});
