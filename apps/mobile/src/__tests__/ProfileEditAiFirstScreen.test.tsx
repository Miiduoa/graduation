import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ProfileEditAiFirstScreen from '../screens/ProfileEditAiFirstScreen';
import { firebaseSource } from '../data/firebaseSource';
import type { User } from '../data/types';
import type { UserProfile } from '../state/auth';

const mockNavigation = { goBack: jest.fn() };
let mockAuth: {
  user: { uid: string; email: string } | null;
  profile: UserProfile | null;
  profileLoading: boolean;
  refreshProfile: jest.Mock;
};
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../data/firebaseSource', () => ({ firebaseSource: { updateUser: jest.fn() } }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));

function saved(patch: Partial<User> = {}): User {
  return {
    id: 'user-a',
    email: 'a@example.edu',
    role: 'student',
    schoolId: 'school-a',
    createdAt: '2026-10-08T00:00:00Z',
    displayName: '新的名字',
    bio: '新的簡介',
    phone: '0900000000',
    ...patch,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fill(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByLabelText('顯示名稱'), '  新的名字  ');
  fireEvent.changeText(view.getByLabelText('個人簡介'), '新的簡介');
  fireEvent.changeText(view.getByLabelText('電話'), '0900000000');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    user: { uid: 'user-a', email: 'a@example.edu' },
    profile: {
      uid: 'user-a',
      schoolId: 'school-a',
      role: 'student',
      displayName: '原本名字',
      bio: '原本簡介',
      phone: '0911111111',
      department: '真實系所',
      studentId: 'S123',
    },
    profileLoading: false,
    refreshProfile: jest.fn().mockResolvedValue(undefined),
  };
  jest.mocked(firebaseSource.updateUser).mockResolvedValue(saved());
  jest.spyOn(Alert, 'alert');
});
afterEach(() => jest.restoreAllMocks());

test('profile fields come from the current account and a save sends only editable fields to the real source', async () => {
  const view = render(<ProfileEditAiFirstScreen />);
  expect(view.getByDisplayValue('原本名字')).toBeTruthy();
  expect(view.getByText('真實系所')).toBeTruthy();
  expect(view.getByText('a@example.edu')).toBeTruthy();
  expect(view.queryByText(/王小明|1099502|GPA 衝|用 AI 生成/)).toBeNull();
  fill(view);
  fireEvent.press(view.getByText('儲存'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('已儲存', '個人資料已更新。'));
  expect(firebaseSource.updateUser).toHaveBeenCalledWith('user-a', {
    displayName: '新的名字',
    bio: '新的簡介',
    phone: '0900000000',
  });
  expect(mockAuth.refreshProfile).toHaveBeenCalledTimes(1);
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
});

test('a failed write keeps the edits available and never displays a saved result', async () => {
  jest.mocked(firebaseSource.updateUser).mockRejectedValueOnce(new Error('permission-denied'));
  const view = render(<ProfileEditAiFirstScreen />);
  fill(view);
  fireEvent.press(view.getByText('儲存'));
  await waitFor(() =>
    expect(Alert.alert).toHaveBeenCalledWith(
      '無法確認儲存結果',
      '未收到資料更新的確認，請檢查網路後重試。',
    ),
  );
  expect(view.getByDisplayValue('  新的名字  ')).toBeTruthy();
  expect(Alert.alert).not.toHaveBeenCalledWith('已儲存', expect.anything());
  expect(mockAuth.refreshProfile).not.toHaveBeenCalled();
});

test('the pending save prevents double writes and waits for the server response', async () => {
  const pending = deferred<User>();
  jest.mocked(firebaseSource.updateUser).mockReturnValueOnce(pending.promise);
  const view = render(<ProfileEditAiFirstScreen />);
  fill(view);
  fireEvent.press(view.getByText('儲存'));
  fireEvent.press(view.getByText('儲存中…'));
  expect(firebaseSource.updateUser).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
  await act(async () => pending.resolve(saved()));
  expect(Alert.alert).toHaveBeenCalledWith('已儲存', '個人資料已更新。');
});

test('a late save response for the previous account cannot refresh or announce success in the new account', async () => {
  const pending = deferred<User>();
  jest.mocked(firebaseSource.updateUser).mockReturnValueOnce(pending.promise);
  const view = render(<ProfileEditAiFirstScreen />);
  fill(view);
  fireEvent.press(view.getByText('儲存'));
  mockAuth.user = { uid: 'user-b', email: 'b@example.edu' };
  mockAuth.profile = {
    uid: 'user-b',
    schoolId: 'school-b',
    role: 'student',
    displayName: '另一位同學',
  };
  view.rerender(<ProfileEditAiFirstScreen />);
  expect(view.queryByDisplayValue('  新的名字  ')).toBeNull();
  expect(view.getByDisplayValue('另一位同學')).toBeTruthy();
  await act(async () => pending.resolve(saved()));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockAuth.refreshProfile).not.toHaveBeenCalled();
});

test('a stale profile is hidden until it matches the currently signed-in user', () => {
  const view = render(<ProfileEditAiFirstScreen />);
  mockAuth.user = { uid: 'user-b', email: 'b@example.edu' };
  view.rerender(<ProfileEditAiFirstScreen />);
  expect(view.queryByDisplayValue('原本名字')).toBeNull();
  expect(view.queryByText('真實系所')).toBeNull();
  expect(view.queryByText('儲存')).toBeNull();
  expect(view.getByText('目前無法讀取個人資料，請確認登入狀態後重新開啟。')).toBeTruthy();
});

test('a mismatched server readback never becomes a saved claim', async () => {
  jest.mocked(firebaseSource.updateUser).mockResolvedValueOnce(saved({ displayName: '舊名稱' }));
  const view = render(<ProfileEditAiFirstScreen />);
  fill(view);
  fireEvent.press(view.getByText('儲存'));
  await waitFor(() =>
    expect(Alert.alert).toHaveBeenCalledWith('無法確認儲存結果', expect.any(String)),
  );
  expect(Alert.alert).not.toHaveBeenCalledWith('已儲存', expect.anything());
});

test('demo accounts have a truthful read-only state rather than a simulated save action', () => {
  mockAuth.user = { uid: 'demo_student', email: 'demo@example.edu' };
  mockAuth.profile = { ...mockAuth.profile!, uid: 'demo_student' };
  const view = render(<ProfileEditAiFirstScreen />);
  expect(view.getByText('目前帳號僅能查看個人資料，未提供儲存服務。')).toBeTruthy();
  expect(view.queryByText('儲存')).toBeNull();
  expect(view.getByLabelText('顯示名稱').props.editable).toBe(false);
  expect(firebaseSource.updateUser).not.toHaveBeenCalled();
});
