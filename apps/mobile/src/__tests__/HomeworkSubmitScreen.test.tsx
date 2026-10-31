import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import HomeworkSubmitScreen from '../screens/HomeworkSubmitScreen';
import { onAssignmentSubmitted } from '../services/companionHooks';
import { getDataSourceEvidence } from '../data/source';

let mockUid = 'alice';
let mockSchool = 'pu';
let mockFocusCleanup: (() => void) | undefined;
let mockFocusAgain: () => void;

const mockNavigate = { goBack: jest.fn() };
const mockSafeNavigate = jest.fn();
const mockSource = {
  getAssignment: jest.fn(),
  getSubmission: jest.fn(),
  submitAssignment: jest.fn(),
};

jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: mockUid } }),
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../data/source', () => ({ getDataSourceEvidence: jest.fn(() => null) }));
jest.mock('../hooks/useDataSource', () => ({
  useDataSource: () => mockSource,
}));
jest.mock('../services/companionHooks', () => ({
  onAssignmentSubmitted: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigate,
  useFocusEffect: (callback: () => (() => void) | undefined) => require('react').useEffect(() => {
    mockFocusAgain = () => { mockFocusCleanup = callback(); };
    mockFocusAgain();
    return () => mockFocusCleanup?.();
  }, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../utils/safeNavigate', () => ({
  safeNavigate: (...args: unknown[]) => mockSafeNavigate(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'alice';
  mockSchool = 'pu';
  jest.mocked(getDataSourceEvidence).mockReturnValue(null);
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
    groupId: 'course',
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

test('opens the class-workspace file submit flow when the Expo flag is on', async () => {
  process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED = 'true';
  const view = render(
    <HomeworkSubmitScreen
      route={{
        params: {
          courseId: 'cw_11111111-1111-4111-8111-111111111111',
          hwId: 'cwa_22222222-2222-4222-8222-222222222222',
        },
      }}
    />,
  );
  expect(await view.findByText('正在前往可傳檔的作業繳交…')).toBeTruthy();
  expect(view.queryByText(/無法從 App 傳檔/)).toBeNull();
  expect(view.queryByLabelText('繳交作業')).toBeNull();
  expect(mockSafeNavigate).toHaveBeenCalledWith(mockNavigate, 'NuniWorkspace', {
    tab: 'courses',
    workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
    assignmentId: 'cwa_22222222-2222-4222-8222-222222222222',
  });
  expect(mockSource.getAssignment).not.toHaveBeenCalled();
});

test.each([
  { courseId: 'course', hwId: 'work' },
  { courseId: 'cw_11111111-1111-4111-8111-111111111111', hwId: 'work' },
  { courseId: 'course', hwId: 'cwa_22222222-2222-4222-8222-222222222222' },
])(
  'keeps Firestore/TronClass text submit when the Expo flag is on %j',
  async (params) => {
    process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED = 'true';
    mockSource.getAssignment.mockResolvedValue({
      id: params.hwId, groupId: params.courseId, title: '期末報告', type: 'homework', dueAt: null,
    });
    const view = render(<HomeworkSubmitScreen route={{ params }} />);
    expect(await view.findByText('期末報告')).toBeTruthy();
    expect(view.getByText(/目前只支援文字繳交/)).toBeTruthy();
    expect(view.getByText(/無法從 App 傳檔/)).toBeTruthy();
    expect(view.getByLabelText('文字作業內容')).toBeTruthy();
    expect(view.queryByText('正在前往可傳檔的作業繳交…')).toBeNull();
    expect(mockSafeNavigate).not.toHaveBeenCalled();
    expect(mockSource.getAssignment).toHaveBeenCalledWith(params.hwId, params.courseId);
  },
);

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
    groupId: 'course',
    userId: 'alice',
    content: '先前繳交的內容',
    status: 'submitted',
    submittedAt: '2026-10-18T00:00:00Z',
  });
  const view = render(
    <HomeworkSubmitScreen route={{ params: { courseId: 'course', hwId: 'work' } }} />,
  );
  expect(await view.findByText('先前繳交的內容')).toBeTruthy();
  expect(view.getByText('已繳交 · 等待老師評分')).toBeTruthy();
  expect(view.getByText('作業已收到；老師公布評分後，會顯示在這裡。')).toBeTruthy();
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
    groupId: 'course',
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
  expect(view.getByText('已繳交 · 教師已發布評分')).toBeTruthy();
  expect(view.queryByText('課內成績')).toBeNull();
});

test('hides unpublished teacher drafts and old grade fields', async () => {
  mockSource.getSubmission.mockResolvedValue({
    id: 'alice',
    assignmentId: 'work',
    groupId: 'course',
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
  expect(view.getByText('已繳交 · 等待老師評分')).toBeTruthy();
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


function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const params = { courseId: 'course', hwId: 'work' };
const receipt = {
  id: 'alice', assignmentId: 'work', groupId: 'course', userId: 'alice',
  content: '我的答案', status: 'submitted', submittedAt: '2026-10-19T00:00:00Z',
};

test('uses the acknowledged timestamp and trimmed content in the receipt', async () => {
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '  我的答案  ');
  await act(async () => fireEvent.press(view.getByLabelText('繳交作業')));
  expect(view.getByText('繳交時間：2026/10/19 上午8:00:00')).toBeTruthy();
  expect(view.getByText('我的答案')).toBeTruthy();
  expect(Alert.alert).toHaveBeenCalledWith('已繳交', expect.any(String), expect.any(Array));
  expect(onAssignmentSubmitted).toHaveBeenCalledTimes(1);
});

test.each([
  null,
  { ...receipt, submittedAt: 'invalid' },
  { ...receipt, userId: 'bob' },
  { ...receipt, assignmentId: 'other' },
  { ...receipt, groupId: 'other-course' },
  { ...receipt, content: 'older version' },
  { ...receipt, status: 'draft' },
])('does not claim success for an unverifiable receipt %j and keeps the answer for rechecking', async (result) => {
  mockSource.submitAssignment.mockResolvedValue(result);
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  await act(async () => fireEvent.press(view.getByLabelText('繳交作業')));
  expect(onAssignmentSubmitted).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalledWith('已繳交', expect.anything(), expect.anything());
  expect(view.getByText('我的答案')).toBeTruthy();
  expect(view.queryByLabelText('繳交作業')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('重新核對繳交紀錄')));
  expect(view.getByLabelText('文字作業內容').props.value).toBe('我的答案');
});

test('an uncertain write can be recovered by reading the server receipt without another write', async () => {
  mockSource.submitAssignment.mockRejectedValue(new Error('connection lost'));
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  await act(async () => fireEvent.press(view.getByLabelText('繳交作業')));
  mockSource.getSubmission.mockResolvedValue(receipt);
  await act(async () => fireEvent.press(view.getByText('重新核對繳交紀錄')));
  expect(view.getByText('已繳交 · 等待老師評分')).toBeTruthy();
  expect(mockSource.submitAssignment).toHaveBeenCalledTimes(1);
});

test('only starts one submission while the first acknowledgement is pending', async () => {
  const write = deferred<typeof receipt>();
  mockSource.submitAssignment.mockReturnValue(write.promise);
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  const button = view.getByLabelText('繳交作業');
  act(() => { fireEvent.press(button); fireEvent.press(button); });
  expect(mockSource.submitAssignment).toHaveBeenCalledTimes(1);
  await act(async () => write.resolve(receipt));
});

test.each(['account', 'school', 'assignment'])('discards a late grade read after changing %s', async (change) => {
  const oldRead = deferred<typeof receipt>();
  mockSource.getSubmission.mockReturnValueOnce(oldRead.promise).mockResolvedValue(null);
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  let nextParams = params;
  if (change === 'account') mockUid = 'bob';
  if (change === 'school') mockSchool = 'other-school';
  if (change === 'assignment') {
    nextParams = { ...params, hwId: 'new-work' };
    mockSource.getAssignment.mockResolvedValue({ id: 'new-work', groupId: 'course', title: '新作業', dueAt: null });
  }
  view.rerender(<HomeworkSubmitScreen route={{ params: nextParams }} />);
  await view.findByLabelText('文字作業內容');
  await act(async () => oldRead.resolve({ ...receipt, content: '舊帳號的答案',
    gradePublished: true, gradeScore: 99, gradeFeedback: '私人教師回饋',
  } as typeof receipt));
  expect(view.queryByText('舊帳號的答案')).toBeNull();
  expect(view.queryByText('私人教師回饋')).toBeNull();
  expect(view.getByLabelText('文字作業內容').props.value).toBe('');
});

test.each(['account', 'unmount'])('suppresses alerts and hooks after %s while submitting', async (change) => {
  const write = deferred<typeof receipt>();
  mockSource.submitAssignment.mockReturnValue(write.promise);
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  fireEvent.press(view.getByLabelText('繳交作業'));
  if (change === 'account') {
    mockUid = 'bob';
    view.rerender(<HomeworkSubmitScreen route={{ params }} />);
  } else view.unmount();
  await act(async () => write.resolve(receipt));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(onAssignmentSubmitted).not.toHaveBeenCalled();
});

test('does not label a malformed prior receipt as submitted or allow a duplicate write', async () => {
  mockSource.getSubmission.mockResolvedValue({ ...receipt, submittedAt: 'invalid' });
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  expect(await view.findByText('繳交狀態尚未確認，請先核對紀錄，避免重複送出。')).toBeTruthy();
  expect(view.queryByText('已繳交 · 等待老師評分')).toBeNull();
  expect(view.queryByLabelText('繳交作業')).toBeNull();
});

test('blocks a malformed deadline and never treats it as unrestricted', async () => {
  mockSource.getAssignment.mockResolvedValue({ id: 'work', groupId: 'course', title: '作業', dueAt: 'invalid' });
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  expect(await view.findByText('截止時間無法確認')).toBeTruthy();
  expect(view.queryByText('未設截止時間')).toBeNull();
  expect(view.queryByLabelText('繳交作業')).toBeNull();
});

test('uses the server deadline policy instead of a stale deadline carried in navigation', async () => {
  mockSource.getAssignment.mockResolvedValue({ id: 'work', groupId: 'course', title: '作業', dueAt: null });
  const view = render(<HomeworkSubmitScreen route={{ params: { ...params, dueAt: '2000-01-01T00:00:00Z' } }} />);
  expect(await view.findByLabelText('文字作業內容')).toBeTruthy();
  expect(view.getByText('未設截止時間')).toBeTruthy();
});

test('checks the deadline again when submitting after the page remained open', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-26T08:00:00Z'));
  mockSource.getAssignment.mockResolvedValue({ id: 'work', groupId: 'course', title: '作業', dueAt: '2026-10-26T16:01:00' });
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  now.mockReturnValue(Date.parse('2026-10-26T08:02:00Z'));
  await act(async () => fireEvent.press(view.getByLabelText('繳交作業')));
  expect(mockSource.submitAssignment).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('作業已截止', expect.any(String));
  now.mockRestore();
});


test('a pending write does not race a refocus read or announce success after blur', async () => {
  const write = deferred<typeof receipt>();
  mockSource.submitAssignment.mockReturnValue(write.promise);
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  fireEvent.press(view.getByLabelText('繳交作業'));
  act(() => { mockFocusCleanup?.(); mockFocusAgain(); });
  expect(mockSource.getSubmission).toHaveBeenCalledTimes(1);
  await act(async () => write.resolve(receipt));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(onAssignmentSubmitted).not.toHaveBeenCalled();
  expect(view.getByText('繳交狀態尚未確認，請先核對紀錄，避免重複送出。')).toBeTruthy();
  mockSource.getSubmission.mockResolvedValue(receipt);
  await act(async () => fireEvent.press(view.getByText('重新核對繳交紀錄')));
  expect(view.getByText('已繳交 · 等待老師評分')).toBeTruthy();
  expect(mockSource.submitAssignment).toHaveBeenCalledTimes(1);
});

test('a late read before blur cannot replace the receipt loaded on returning', async () => {
  const read = deferred<typeof receipt>();
  mockSource.getSubmission.mockReturnValueOnce(read.promise).mockResolvedValue({ ...receipt, content: '目前的繳交內容' });
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  act(() => { mockFocusCleanup?.(); mockFocusAgain(); });
  expect(await view.findByText('目前的繳交內容')).toBeTruthy();
  await act(async () => read.resolve({ ...receipt, content: '舊繳交內容' }));
  expect(view.queryByText('舊繳交內容')).toBeNull();
  expect(view.getByText('目前的繳交內容')).toBeTruthy();
});


test('opens a real server draft for editing and confirms its first submission', async () => {
  mockSource.getSubmission.mockResolvedValue({ ...receipt, status: 'draft', submittedAt: null, content: '尚未完成的草稿' });
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  expect((await view.findByLabelText('文字作業內容')).props.value).toBe('尚未完成的草稿');
  expect(view.queryByText('已繳交 · 等待老師評分')).toBeNull();
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  await act(async () => fireEvent.press(view.getByLabelText('繳交作業')));
  expect(mockSource.submitAssignment).toHaveBeenCalledWith({
    assignmentId: 'work', userId: 'alice', groupId: 'course', content: '我的答案',
  });
  expect(view.getByText('已繳交 · 等待老師評分')).toBeTruthy();
});

test('returning to an edited server draft preserves an intentionally cleared answer', async () => {
  mockSource.getSubmission.mockResolvedValue({ ...receipt, status: 'draft', submittedAt: null, content: '原本草稿' });
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '');
  await act(async () => { mockFocusCleanup?.(); mockFocusAgain(); });
  expect(view.getByLabelText('文字作業內容').props.value).toBe('');
});


test.each([
  { mode: 'mock' as const, sourceLabel: 'mock' as const },
  { mode: 'hybrid' as const, sourceLabel: 'mock' as const },
])('never reads or submits formal coursework in a demonstration data source %j', async (evidence) => {
  jest.mocked(getDataSourceEvidence).mockReturnValue(evidence);
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  expect(await view.findByText(/目前使用示範資料/)).toBeTruthy();
  expect(mockSource.getAssignment).not.toHaveBeenCalled();
  expect(mockSource.getSubmission).not.toHaveBeenCalled();
  expect(mockSource.submitAssignment).not.toHaveBeenCalled();
  expect(view.queryByLabelText('繳交作業')).toBeNull();
});

test('checks the data source again before starting a write', async () => {
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  jest.mocked(getDataSourceEvidence).mockReturnValue({ mode: 'mock', sourceLabel: 'mock' });
  await act(async () => fireEvent.press(view.getByLabelText('繳交作業')));
  expect(view.getByText(/目前使用示範資料/)).toBeTruthy();
  expect(mockSource.submitAssignment).not.toHaveBeenCalled();
});

test('never accepts a pending acknowledgement after the source switches to demonstration data', async () => {
  const write = deferred<typeof receipt>();
  mockSource.submitAssignment.mockReturnValue(write.promise);
  const view = render(<HomeworkSubmitScreen route={{ params }} />);
  await view.findByLabelText('文字作業內容');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  fireEvent.press(view.getByLabelText('繳交作業'));
  jest.mocked(getDataSourceEvidence).mockReturnValue({ mode: 'mock', sourceLabel: 'mock' });
  await act(async () => write.resolve(receipt));
  expect(onAssignmentSubmitted).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalledWith('已繳交', expect.anything(), expect.anything());
  expect(view.queryByText('已繳交 · 等待老師評分')).toBeNull();
  expect(view.getByText('我的答案')).toBeTruthy();
});

test.each(['removed', 'denied'])('通知中的作業已無法存取時友善返回課程：%s', async (failure) => {
  if (failure === 'removed') mockSource.getAssignment.mockResolvedValue(null);
  else mockSource.getAssignment.mockRejectedValue(new Error('permission-denied'));
  render(<HomeworkSubmitScreen route={{ params: {
    groupId: 'course', assignmentId: 'work', fromReminder: true,
  } }} />);
  await waitFor(() => expect(mockSafeNavigate).toHaveBeenCalledWith(mockNavigate, 'LearnHome'));
  expect(Alert.alert).toHaveBeenCalledWith('無法開啟作業', expect.stringMatching(/權限|移除/));
});

test('從提醒開啟但離線時保留重試入口，不把網路錯誤說成作業已移除', async () => {
  mockSource.getAssignment.mockRejectedValue(new Error('網路連線中斷'));
  const view = render(<HomeworkSubmitScreen route={{ params: {
    groupId: 'course', assignmentId: 'work', fromReminder: true,
  } }} />);
  expect(await view.findByText('網路連線中斷')).toBeTruthy();
  expect(view.getByText('重新讀取')).toBeTruthy();
  expect(mockSafeNavigate).not.toHaveBeenCalled();
});


test('提醒警告不影響繳交成功，並提供管理及稍後重試入口', async () => {
  mockSource.submitAssignment.mockResolvedValueOnce({
    id: 'alice', assignmentId: 'work', groupId: 'course', userId: 'alice',
    content: '我的答案', status: 'submitted', submittedAt: '2026-10-19T00:00:00Z',
    reminderWarning: '未知舊提醒仍可能響鈴，請稍後重試',
  });
  const view = render(<HomeworkSubmitScreen route={{ params: { courseId: 'course', hwId: 'work' } }} />);
  await view.findByText('期末報告');
  fireEvent.changeText(view.getByLabelText('文字作業內容'), '我的答案');
  await act(async () => fireEvent.press(view.getByLabelText('繳交作業')));
  const call = jest.mocked(Alert.alert).mock.calls.find(([title]) => title === '已繳交');
  expect(call?.[1]).toContain('仍可能響鈴');
  const manage = call?.[2]?.find((button) => button.text === '管理提醒／稍後重試');
  expect(manage).toBeDefined();
  act(() => manage?.onPress?.());
  expect(mockSafeNavigate).toHaveBeenCalledWith(mockNavigate, 'CampusAssistant');
  expect(onAssignmentSubmitted).toHaveBeenCalled();
});
