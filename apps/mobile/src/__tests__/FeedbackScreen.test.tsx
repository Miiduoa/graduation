import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { Alert, StyleSheet, type AlertButton } from 'react-native';
import type { NavigationAction } from '@react-navigation/native';
import { applyTheme } from '../ui/theme';
import { aiTokens } from '../ui/aiFirst';
import { FeedbackScreen } from '../screens/FeedbackScreen';
import { submitGeneralFeedback } from '../services/generalFeedback';
let mockUser: { uid: string; email: string } | null;
let mockSchool: string;
let mockRemoval: {
  blocked: boolean;
  callback: (event: { data: { action: NavigationAction } }) => void;
} | null = null;
const mockStackNavigation = { dispatch: jest.fn(), isFocused: jest.fn(() => true) };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockStackNavigation,
  usePreventRemove: (
    blocked: boolean,
    callback: (event: { data: { action: NavigationAction } }) => void,
  ) => {
    mockRemoval = { blocked, callback };
  },
}));
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
function leave(action: NavigationAction = { type: 'GO_BACK' }) {
  if (!mockRemoval?.blocked) throw new Error('Feedback removal guard is not active');
  mockRemoval.callback({ data: { action } });
}
function confirmation(label: string): NonNullable<AlertButton['onPress']> {
  const call = jest.mocked(Alert.alert).mock.calls.at(-1);
  const onPress = call?.[2]?.find((button) => button.text === label)?.onPress;
  if (!onPress) throw new Error(`Missing leave confirmation: ${label}`);
  return onPress;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRemoval = null;
  mockStackNavigation.isFocused.mockReturnValue(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  applyTheme('light');
  mockUser = { uid: 'u1', email: 'a@example.edu' };
  mockSchool = 's1';
  let next = 0;
  (randomUUID as jest.Mock).mockImplementation(() => `request-${++next}`);
  submit.mockResolvedValue({ ok: true, feedbackId: 'saved-123', reused: false });
});
afterEach(() => jest.restoreAllMocks());
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

test('unchanged prefills can be left without warning and only actual changes activate protection', () => {
  const view = render(
    <FeedbackScreen
      route={{
        params: {
          prefill: {
            title: '由說明頁帶入',
            description: '尚未修改的描述',
            feedbackType: 'bug',
          },
        },
      }}
    />,
  );
  expect(mockRemoval?.blocked).toBe(false);
  fireEvent.press(view.getByText('問題回報'));
  expect(mockRemoval?.blocked).toBe(false);
  fireEvent.changeText(view.getByLabelText('回饋標題'), '修改後的標題');
  expect(mockRemoval?.blocked).toBe(true);
  fireEvent.changeText(view.getByLabelText('回饋標題'), '由說明頁帶入');
  expect(mockRemoval?.blocked).toBe(false);
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('native back preserves the draft when cancelled and dispatches the original confirmed action once', () => {
  const view = render(<FeedbackScreen />);
  fill(view);
  const action: NavigationAction = { type: 'POP', payload: { count: 2 } };
  act(() => {
    leave(action);
    leave(action);
  });
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  act(() => confirmation('繼續編輯')());
  expect(view.getByLabelText('回饋詳細內容').props.value).toBe('重新整理後仍顯示昨天的課表。');
  expect(mockStackNavigation.dispatch).not.toHaveBeenCalled();
  act(() => leave(action));
  const discard = confirmation('捨棄並離開');
  act(() => {
    discard();
    discard();
  });
  expect(mockStackNavigation.dispatch).toHaveBeenCalledTimes(1);
  expect(mockStackNavigation.dispatch).toHaveBeenCalledWith(action);
  expect(submit).not.toHaveBeenCalled();
});

test('dismissing the native alert releases it for the next back action', () => {
  const view = render(<FeedbackScreen />);
  fill(view);
  act(() => leave());
  const dismiss = jest.mocked(Alert.alert).mock.calls.at(-1)?.[3]?.onDismiss;
  act(() => dismiss?.());
  act(() => leave());
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  expect(mockStackNavigation.dispatch).not.toHaveBeenCalled();
});

test.each(['edited', 'edited-back', 'blurred', 'unmounted', 'account', 'school', 'logout'])(
  'an old discard confirmation cannot leave after the editor is %s',
  (change) => {
    const view = render(<FeedbackScreen />);
    fill(view);
    act(() => leave());
    const discard = confirmation('捨棄並離開');
    if (change === 'edited' || change === 'edited-back') {
      fireEvent.changeText(view.getByLabelText('回饋標題'), '新的內容');
      if (change === 'edited-back')
        fireEvent.changeText(view.getByLabelText('回饋標題'), '課表未更新');
    } else if (change === 'blurred') mockStackNavigation.isFocused.mockReturnValue(false);
    else if (change === 'unmounted') view.unmount();
    else {
      if (change === 'account') mockUser = { uid: 'u2', email: 'b@example.edu' };
      if (change === 'school') mockSchool = 's2';
      if (change === 'logout') mockUser = null;
      view.rerender(<FeedbackScreen />);
      // Returning to the previous identity cannot revive its old confirmation.
      mockUser = { uid: 'u1', email: 'a@example.edu' };
      mockSchool = 's1';
      view.rerender(<FeedbackScreen />);
    }
    act(() => discard());
    expect(mockStackNavigation.dispatch).not.toHaveBeenCalled();
  },
);

test('submitting invalidates an old discard, blocks native and visible back, and failure keeps the editable draft', async () => {
  const pending = deferred();
  submit.mockReturnValueOnce(pending.promise);
  const goBack = jest.fn();
  const view = render(<FeedbackScreen navigation={{ goBack }} />);
  fill(view);
  act(() => leave());
  const discard = confirmation('捨棄並離開');
  fireEvent.press(view.getByText('提交回饋'));
  fireEvent.press(view.getByLabelText('返回'));
  act(() => {
    leave();
    discard();
  });
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(mockStackNavigation.dispatch).not.toHaveBeenCalled();
  expect(goBack).not.toHaveBeenCalled();
  await act(async () => pending.reject(new Error('unavailable')));
  expect(mockRemoval?.blocked).toBe(true);
  expect(view.getByLabelText('回饋標題').props.value).toBe('課表未更新');
  expect(view.getByLabelText('回饋標題').props.editable).toBe(true);
  act(() => leave());
  expect(Alert.alert).toHaveBeenCalledTimes(2);
});

test('a confirmed receipt permits return, while another feedback starts with a clean baseline', async () => {
  const goBack = jest.fn();
  const view = render(<FeedbackScreen navigation={{ goBack }} />);
  fill(view);
  fireEvent.changeText(view.getByLabelText('聯絡電子郵件'), 'reply@example.edu');
  await act(async () => fireEvent.press(view.getByText('提交回饋')));
  expect(mockRemoval?.blocked).toBe(false);
  fireEvent.press(view.getByText('返回'));
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('提交另一則回饋'));
  expect(mockRemoval?.blocked).toBe(false);
  expect(view.getByLabelText('回饋標題').props.value).toBe('');
  expect(view.getByLabelText('聯絡電子郵件').props.value).toBe('reply@example.edu');
  fireEvent.press(view.getByText('5 分'));
  expect(mockRemoval?.blocked).toBe(true);
});
