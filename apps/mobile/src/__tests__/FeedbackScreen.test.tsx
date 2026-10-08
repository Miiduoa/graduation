import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { StyleSheet } from 'react-native';
import { applyTheme } from '../ui/theme';
import { aiTokens } from '../ui/aiFirst';
import { FeedbackScreen } from '../screens/FeedbackScreen';
import { submitGeneralFeedback } from '../services/generalFeedback';
let mockUser: { uid: string; email: string } | null;
let mockSchool: string;
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../services/generalFeedback', () => ({ submitGeneralFeedback: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const submit = submitGeneralFeedback as jest.Mock;
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fill(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByLabelText('回饋標題'), '課表未更新');
  fireEvent.changeText(view.getByLabelText('回饋詳細內容'), '重新整理後仍顯示昨天的課表。');
}
beforeEach(() => {
  jest.clearAllMocks();
  applyTheme('light');
  mockUser = { uid: 'u1', email: 'a@example.edu' };
  mockSchool = 's1';
  let next = 0;
  (randomUUID as jest.Mock).mockImplementation(() => `request-${++next}`);
  submit.mockResolvedValue({ ok: true, feedbackId: 'saved-123', reused: false });
});
test('failed submission preserves draft and retries the same id until server receipt confirms success', async () => {
  submit.mockRejectedValueOnce(new Error('unavailable'));
  const view = render(<FeedbackScreen />);
  fill(view);
  await act(async () => fireEvent.press(view.getByText('提交回饋')));
  expect(view.queryByText('回饋已送出')).toBeNull();
  expect(view.getByLabelText('回饋標題').props.value).toBe('課表未更新');
  expect(view.getByText(/內容已保留/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('重試提交')));
  expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
  expect(submit.mock.calls[1][0]).toMatchObject({
    requestId: 'request-1',
    kind: 'general',
    schoolId: 's1',
    contactEmail: 'a@example.edu',
  });
  expect(view.getByText('回饋已送出')).toBeTruthy();
  expect(view.getByText('回饋編號：saved-123')).toBeTruthy();
});
test('editing a failed draft creates a new id and duplicate presses do not send twice', async () => {
  submit.mockRejectedValueOnce(new Error('offline'));
  const view = render(<FeedbackScreen />);
  fill(view);
  await act(async () => fireEvent.press(view.getByText('提交回饋')));
  fireEvent.changeText(view.getByLabelText('回饋標題'), '更新後課表仍不正確');
  const pending = deferred();
  submit.mockReturnValue(pending.promise);
  act(() => {
    fireEvent.press(view.getByText('提交回饋'));
    fireEvent.press(view.getByText('提交回饋'));
  });
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[1][0].requestId).toBe('request-2');
  expect(view.getByLabelText('回饋詳細內容').props.editable).toBe(false);
  await act(async () => pending.resolve({ ok: true, feedbackId: 'done' }));
});
test.each(['account', 'school'])(
  'changing %s clears the draft and rejects late success from the previous context',
  async (change) => {
    const pending = deferred();
    submit.mockReturnValueOnce(pending.promise);
    const view = render(<FeedbackScreen />);
    fill(view);
    fireEvent.press(view.getByText('提交回饋'));
    const guard = submit.mock.calls[0][2];
    if (change === 'account') mockUser = { uid: 'u2', email: 'b@example.edu' };
    else mockSchool = 's2';
    view.rerender(<FeedbackScreen />);
    expect(guard()).toBe(false);
    expect(view.getByLabelText('回饋標題').props.value).toBe('');
    await act(async () => pending.resolve({ ok: true, feedbackId: 'old-receipt' }));
    expect(view.queryByText('回饋已送出')).toBeNull();
    fill(view);
    await act(async () => fireEvent.press(view.getByText('提交回饋')));
    expect(submit.mock.calls[1][0].requestId).toBe('request-2');
    expect(submit.mock.calls[1][1]).toBe(change === 'account' ? 'u2' : 'u1');
    expect(submit.mock.calls[1][0].schoolId).toBe(change === 'school' ? 's2' : 's1');
  },
);
test('invalid email blocks submission and guests cannot submit', async () => {
  const view = render(<FeedbackScreen />);
  fill(view);
  fireEvent.changeText(view.getByLabelText('聯絡電子郵件'), 'invalid');
  await act(async () => fireEvent.press(view.getByText('提交回饋')));
  expect(submit).not.toHaveBeenCalled();
  expect(view.getByText('請填寫有效的聯絡電子郵件，或留空。')).toBeTruthy();
  mockUser = null;
  view.rerender(<FeedbackScreen />);
  expect(view.queryByText('提交回饋')).toBeNull();
});

test('feedback keeps its detail back action and updates form colors while mounted', () => {
  const goBack = jest.fn();
  const view = render(<FeedbackScreen navigation={{ goBack }} />);
  fireEvent.press(view.getByLabelText('返回'));
  expect(goBack).toHaveBeenCalledTimes(1);
  const before = StyleSheet.flatten(view.getByLabelText('回饋標題').props.style).color;
  act(() => applyTheme('dark'));
  expect(StyleSheet.flatten(view.getByLabelText('回饋標題').props.style).color).toBe(aiTokens.text);
  expect(aiTokens.text).not.toBe(before);
});

test('selecting the same type or adding whitespace does not change the retry identity of identical feedback', async () => {
  submit.mockRejectedValueOnce(new Error('acknowledgment lost'));
  const view = render(<FeedbackScreen />);
  fill(view);
  await act(async () => fireEvent.press(view.getByText('提交回饋')));
  fireEvent.press(view.getByText('功能建議'));
  fireEvent.changeText(view.getByLabelText('回饋標題'), ' 課表未更新 ');
  await act(async () => fireEvent.press(view.getByText('提交回饋')));
  expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
  expect(randomUUID).toHaveBeenCalledTimes(1);
});
