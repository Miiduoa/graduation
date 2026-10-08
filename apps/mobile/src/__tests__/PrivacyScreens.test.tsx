import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { DataExportScreen } from '../screens/DataExportScreen';
import { AccountDeletionScreen } from '../screens/AccountDeletionScreen';
import { exportUserData, deleteUserAccount } from '../services/privacy';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { reauthenticateWithCredential } from 'firebase/auth';
import { File } from 'expo-file-system';

type TestUser = {
  uid: string;
  email: string;
  providerData: { providerId: string }[];
  getIdToken: jest.Mock;
};
let mockUser: TestUser | null;
let mockSdkUser: TestUser | null;
let mockSchool = 's1';
const mockSignOut = jest.fn();
const mockWrite = jest.fn();
const mockDeleteFile = jest.fn();
const mockNewFile = jest.fn();
const mockDirectoryList = jest.fn();
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser, signOut: mockSignOut }) }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: mockSchool, name: '測試大學' } }),
}));
jest.mock('../firebase', () => ({ getAuthInstance: () => ({ currentUser: mockSdkUser }) }));
jest.mock('../services/privacy', () => ({
  exportUserData: jest.fn(),
  deleteUserAccount: jest.fn(),
  isPrivacyAccountCurrent: (uid: string) => mockSdkUser?.uid === uid,
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  Directory: class {
    create() {}
    list = mockDirectoryList;
  },
  File: class {
    uri = 'cache/private-export.json';
    constructor(...args: unknown[]) {
      mockNewFile(...args);
    }
    write = mockWrite;
    delete = mockDeleteFile;
  },
}));
jest.mock('firebase/auth', () => ({
  reauthenticateWithCredential: jest.fn(),
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) },
}));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const exportData = jest.mocked(exportUserData);
const remove = jest.mocked(deleteUserAccount);
const available = jest.mocked(isAvailableAsync);
const share = jest.mocked(shareAsync);
function user(uid = 'u1', provider = 'custom'): TestUser {
  return {
    uid,
    email: `${uid}@example.edu`,
    providerData: provider === 'custom' ? [] : [{ providerId: provider }],
    getIdToken: jest.fn().mockResolvedValue('token'),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function beginDeletion(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByText('繼續刪除帳號'));
  fireEvent.changeText(view.getByLabelText('刪除確認文字'), '刪除我的帳號');
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = user();
  mockSdkUser = mockUser;
  mockSchool = 's1';
  available.mockResolvedValue(true);
  share.mockResolvedValue(undefined);
  mockWrite.mockResolvedValue(undefined);
  mockSignOut.mockResolvedValue(undefined);
  mockDirectoryList.mockReturnValue([]);
  jest.mocked(reauthenticateWithCredential).mockResolvedValue({} as never);
  exportData.mockImplementation(async (request) => ({
    userId: request.expectedUserId,
    schoolId: request.schoolId,
    exportedAt: '2026-10-08T00:00:00Z',
    coverage: {
      truncated: false,
      truncatedSections: [],
      scope: 'selected-categories',
      categories: request.categories,
    },
    conversations: [{ messages: [{ body: '完整訊息'.repeat(100) }] }],
    schoolScoped: { wallet: { balance: 42 } },
  }));
  remove.mockResolvedValue({ success: true, userId: 'u1' });
});

test('export uses selected categories and preserves every returned field without claiming saved', async () => {
  const view = render(<DataExportScreen navigation={navigation} />);
  fireEvent.press(view.getByLabelText('校園紀錄'));
  await act(async () => fireEvent.press(view.getByText('匯出 7 項資料')));
  expect(exportData.mock.calls[0][0]).toEqual(
    expect.objectContaining({ expectedUserId: 'u1', schoolId: 's1' }),
  );
  expect(exportData.mock.calls[0][0].categories).not.toContain('schoolRecords');
  expect(exportData.mock.calls[0][0].categories).not.toContain('messages');
  const payload = JSON.parse(mockWrite.mock.calls[0][0]);
  expect(payload.conversations[0].messages[0].body).toBe('完整訊息'.repeat(100));
  expect(payload.schoolScoped.wallet.balance).toBe(42);
  expect(share).toHaveBeenCalledTimes(1);
  expect(mockDeleteFile).not.toHaveBeenCalled();
  expect(view.getByText(/分享選單已關閉/)).toBeTruthy();
  expect(view.queryByText('匯出成功')).toBeNull();
});
test('unsupported sharing does not fetch or create a stranded private file', async () => {
  available.mockResolvedValue(false);
  const view = render(<DataExportScreen />);
  await act(async () => fireEvent.press(view.getByText('匯出 8 項資料')));
  expect(exportData).not.toHaveBeenCalled();
  expect(mockWrite).not.toHaveBeenCalled();
  expect(view.getByText(/無法開啟分享選單/)).toBeTruthy();
});
test.each(['account', 'school', 'sdk'])(
  'export late response cannot create or share a file after %s changes',
  async (change) => {
    const pending = deferred<Awaited<ReturnType<typeof exportUserData>>>();
    exportData.mockReturnValue(pending.promise);
    const view = render(<DataExportScreen />);
    await act(async () => fireEvent.press(view.getByText('匯出 8 項資料')));
    const request = exportData.mock.calls[0][0];
    if (change === 'account') {
      mockUser = user('u2');
      mockSdkUser = mockUser;
    } else if (change === 'school') mockSchool = 's2';
    else mockSdkUser = user('u2');
    view.rerender(<DataExportScreen />);
    await act(async () =>
      pending.resolve({
        userId: 'u1',
        schoolId: 's1',
        exportedAt: '',
        coverage: {
          truncated: false,
          truncatedSections: [],
          scope: 'selected-categories',
          categories: request.categories,
        },
      }),
    );
    expect(mockWrite).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  },
);
test('a different account payload and unconfirmed coverage cannot be shared', async () => {
  exportData.mockResolvedValue({ userId: 'u2', schoolId: 's1', exportedAt: '' } as never);
  const view = render(<DataExportScreen />);
  await act(async () => fireEvent.press(view.getByText('匯出 8 項資料')));
  expect(mockWrite).not.toHaveBeenCalled();
  expect(view.getByText(/無法完成資料匯出/)).toBeTruthy();
});
test('export lock rejects rapid duplicate actions and reports partial records', async () => {
  const pending = deferred<void>();
  share.mockReturnValue(pending.promise);
  exportData.mockImplementation(async (request) => ({
    userId: 'u1',
    schoolId: 's1',
    exportedAt: '',
    coverage: {
      truncated: true,
      truncatedSections: ['groups'],
      scope: 'selected-categories',
      categories: request.categories,
    },
  }));
  const view = render(<DataExportScreen />);
  const button = view.getByText('匯出 8 項資料');
  await act(async () => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(exportData).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  expect(view.getByText(/這次匯出包含部分紀錄/)).toBeTruthy();
});
test('a share-sheet rejection retains a potentially handed-off URI and leaves retry available', async () => {
  share.mockRejectedValue(new Error('unavailable'));
  const view = render(<DataExportScreen />);
  await act(async () => fireEvent.press(view.getByText('匯出 8 項資料')));
  expect(mockDeleteFile).not.toHaveBeenCalled();
  expect(view.getByText(/無法完成資料匯出/)).toBeTruthy();
  expect(view.getByText('匯出 8 項資料')).toBeTruthy();
});

test('a later export expires only own files older than one day and retains recent handoffs', async () => {
  const old = new File('cache/old.json');
  const recent = new File('cache/recent.json');
  const unrelated = new File('cache/unrelated.json');
  const oldDelete = jest.fn();
  const recentDelete = jest.fn();
  const unrelatedDelete = jest.fn();
  Object.assign(old, {
    name: 'campus-one-export-123.json',
    modificationTime: Date.now() - 2 * 86400000,
    delete: oldDelete,
  });
  Object.assign(recent, {
    name: 'campus-one-export-456.json',
    modificationTime: Date.now(),
    delete: recentDelete,
  });
  Object.assign(unrelated, {
    name: 'other-file.json',
    modificationTime: Date.now() - 2 * 86400000,
    delete: unrelatedDelete,
  });
  mockDirectoryList.mockReturnValue([old, recent, unrelated]);
  const view = render(<DataExportScreen />);
  await act(async () => fireEvent.press(view.getByText('匯出 8 項資料')));
  expect(oldDelete).toHaveBeenCalledTimes(1);
  expect(recentDelete).not.toHaveBeenCalled();
  expect(unrelatedDelete).not.toHaveBeenCalled();
  expect(mockDeleteFile).not.toHaveBeenCalled();
});

test('an account change before handoff removes the unshared private file', async () => {
  const pending = deferred<void>();
  mockWrite.mockReturnValue(pending.promise);
  const view = render(<DataExportScreen />);
  await act(async () => fireEvent.press(view.getByText('匯出 8 項資料')));
  mockSdkUser = user('u2');
  await act(async () => pending.resolve());
  expect(share).not.toHaveBeenCalled();
  expect(mockDeleteFile).toHaveBeenCalledTimes(1);
});

test('school login deletion never asks for a Firebase password and success survives signout', async () => {
  const view = render(<AccountDeletionScreen navigation={navigation} />);
  expect(view.getByText(/作業與評閱、訊息與公開貼文/)).toBeTruthy();
  beginDeletion(view);
  expect(view.queryByLabelText('帳號密碼')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('確認刪除帳號')));
  expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith({
    expectedUserId: 'u1',
    schoolId: 's1',
    confirmation: 'DELETE_MY_ACCOUNT',
  });
  expect(mockSignOut).toHaveBeenCalledWith('u1');
  mockUser = null;
  mockSdkUser = null;
  view.rerender(<AccountDeletionScreen navigation={navigation} />);
  expect(view.getByText('Campus One 帳號已刪除')).toBeTruthy();
  expect(view.queryByText('請先登入')).toBeNull();
});
test('password accounts must reauthenticate before deleting', async () => {
  mockUser = user('u1', 'password');
  mockSdkUser = mockUser;
  const view = render(<AccountDeletionScreen />);
  beginDeletion(view);
  fireEvent.press(view.getByText('確認刪除帳號'));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('帳號密碼'), 'test-password');
  await act(async () => fireEvent.press(view.getByText('確認刪除帳號')));
  expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockUser, {
    email: 'u1@example.edu',
    password: 'test-password',
  });
  expect(remove).toHaveBeenCalledTimes(1);
});
test('an account change during password verification blocks deletion', async () => {
  mockUser = user('u1', 'password');
  mockSdkUser = mockUser;
  const pending = deferred<never>();
  jest.mocked(reauthenticateWithCredential).mockReturnValue(pending.promise);
  const view = render(<AccountDeletionScreen />);
  beginDeletion(view);
  fireEvent.changeText(view.getByLabelText('帳號密碼'), 'test-password');
  await act(async () => fireEvent.press(view.getByText('確認刪除帳號')));
  mockSdkUser = user('u2');
  await act(async () => pending.resolve({} as never));
  expect(remove).not.toHaveBeenCalled();
  expect(mockSignOut).not.toHaveBeenCalled();
});
test.each(['account', 'school', 'sdk'])(
  'a late deletion result after %s changes never signs out the new context',
  async (change) => {
    const pending = deferred<{ success: boolean; userId: string }>();
    remove.mockReturnValue(pending.promise);
    const view = render(<AccountDeletionScreen />);
    beginDeletion(view);
    await act(async () => fireEvent.press(view.getByText('確認刪除帳號')));
    if (change === 'account') {
      mockUser = user('u2');
      mockSdkUser = mockUser;
    } else if (change === 'school') mockSchool = 's2';
    else mockSdkUser = user('u2');
    view.rerender(<AccountDeletionScreen />);
    await act(async () => pending.resolve({ success: true, userId: 'u1' }));
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(view.queryByText('Campus One 帳號已刪除')).toBeNull();
  },
);
test('deletion requires affirmative server success and prevents duplicate requests', async () => {
  const pending = deferred<{ success: boolean; userId: string }>();
  remove.mockReturnValue(pending.promise);
  const view = render(<AccountDeletionScreen />);
  beginDeletion(view);
  const button = view.getByText('確認刪除帳號');
  await act(async () => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ success: false, userId: 'u1' }));
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(view.getByText(/尚未確認刪除完成/)).toBeTruthy();
});
test('recent-login rejection clears confirmation and offers a real login route', async () => {
  remove.mockRejectedValue({
    code: 'functions/failed-precondition',
    details: { reason: 'recent-login' },
  });
  const view = render(<AccountDeletionScreen navigation={navigation} />);
  beginDeletion(view);
  await act(async () => fireEvent.press(view.getByText('確認刪除帳號')));
  expect(view.getByLabelText('刪除確認文字').props.value).toBe('');
  fireEvent.press(view.getByText('重新登入'));
  expect(navigation.navigate).toHaveBeenCalledWith('SSOLogin');
  expect(mockSignOut).not.toHaveBeenCalled();
});
test('group ownership rejection asks for transfer without misdirecting to login', async () => {
  remove.mockRejectedValue({
    code: 'functions/failed-precondition',
    details: { reason: 'group-ownership' },
  });
  const view = render(<AccountDeletionScreen navigation={navigation} />);
  beginDeletion(view);
  await act(async () => fireEvent.press(view.getByText('確認刪除帳號')));
  expect(view.getByText(/你仍是群組擁有者/)).toBeTruthy();
  expect(view.queryByText('重新登入')).toBeNull();
});
test('signed-out privacy routes offer login and no destructive controls', () => {
  mockUser = null;
  mockSdkUser = null;
  const deletion = render(<AccountDeletionScreen />);
  expect(deletion.queryByText('繼續刪除帳號')).toBeNull();
  deletion.unmount();
  const exportView = render(<DataExportScreen />);
  expect(exportView.queryByText('匯出 8 項資料')).toBeNull();
});

test('a deletion acknowledgment for another account cannot complete or sign out', async () => {
  remove.mockResolvedValue({ success: true, userId: 'u2' });
  const view = render(<AccountDeletionScreen />);
  beginDeletion(view);
  await act(async () => fireEvent.press(view.getByText('確認刪除帳號')));
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(view.getByText(/尚未確認刪除完成/)).toBeTruthy();
});

test.each([
  ['merchant-ownership', /你仍持有店家管理權/],
  ['financial-records', /帳號仍有餘額、未結束的訂單/],
  ['event-registration', /請聯絡活動主辦人或管理員/],
  ['group-membership', /請聯絡群組管理員/],
])(
  'deletion blocker %s shows its own resolution rather than another login',
  async (reason, message) => {
    remove.mockRejectedValue({ code: 'functions/failed-precondition', details: { reason } });
    const view = render(<AccountDeletionScreen />);
    beginDeletion(view);
    await act(async () => fireEvent.press(view.getByText('確認刪除帳號')));
    expect(view.getByText(message)).toBeTruthy();
    expect(view.queryByText('重新登入')).toBeNull();
  },
);
