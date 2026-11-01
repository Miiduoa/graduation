/**
 * Ownership transfer confirmation / retry / identity fence for GroupMembersScreen.
 * Synthetic local evidence — not production acceptance.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor, type RenderAPI } from '@testing-library/react-native';
import { getDoc, getDocs } from 'firebase/firestore';
import { GroupMembersScreen } from '../screens/GroupMembersScreen';

const authState = {
  user: { uid: 'alice' } as { uid: string } | null,
  loading: false,
  profileLoading: false,
};
const schoolState = { school: { id: 'pu', name: '測試校', code: 'PU' } };
const membershipState = {
  aliceRole: 'owner' as string,
  aliceStatus: 'active' as string,
  bobRole: 'member' as string,
};

const mockTransfer = jest.fn();
let mockGroupType = 'study';
const mockRoster = jest.fn();
jest.mock('../services/clubRoster', () => ({
  loadClubRoster: (...args: unknown[]) => mockRoster(...args),
}));
const alertSpy = jest.spyOn(Alert, 'alert');

jest.mock('../state/auth', () => ({ useAuth: () => authState }));
jest.mock('../state/school', () => ({ useSchool: () => schoolState }));
jest.mock('../firebase', () => ({
  getDb: () => ({}),
  isFirebaseMockMode: () => false,
  getFunctionsInstance: () => ({}),
  getAuthInstance: () => ({ currentUser: authState.user }),
}));
jest.mock('../services/groupOwnership', () => {
  const actual = jest.requireActual('../services/groupOwnership');
  return {
    ...actual,
    transferGroupOwnership: (...args: unknown[]) => mockTransfer(...args),
  };
});
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn(async (_school: string, uids: string[]) =>
    uids.map((uid: string) => ({
      uid,
      displayName: uid === 'bob' ? '王小明' : uid.slice(0, 8),
    })),
  ),
}));
jest.mock('../hooks/useAsyncList', () => ({
  useAsyncList: (loader: () => Promise<unknown[]>, deps: unknown[]) => {
    const React = require('react') as typeof import('react');
    const [items, setItems] = React.useState<unknown[]>([]);
    const key = JSON.stringify(deps);
    const reload = () => {
      void Promise.resolve()
        .then(loader)
        .then((next) => setItems(next))
        .catch(() => setItems([]));
    };
    React.useEffect(() => {
      reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return { items, loading: false, error: null, reload };
  },
}));
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: jest.fn(async (ref: { path: string }) => {
    if (ref.path === 'groups/g1') {
      return {
        exists: () => true,
        id: 'g1',
        data: () => ({ name: '讀書會', type: mockGroupType, createdBy: 'alice' }),
      };
    }
    if (ref.path === 'groups/g1/members/alice') {
      return {
        exists: () => true,
        data: () => ({
          role: membershipState.aliceRole,
          status: membershipState.aliceStatus,
        }),
      };
    }
    return { exists: () => false, data: () => ({}) };
  }),
  getDocs: jest.fn(async () => ({
    docs: [
      {
        id: 'alice',
        data: () => ({ role: membershipState.aliceRole, status: membershipState.aliceStatus }),
      },
      {
        id: 'bob',
        data: () => ({ role: membershipState.bobRole, status: 'active' }),
      },
    ],
  })),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  serverTimestamp: () => 'ts',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function openManageBob(view: RenderAPI) {
  await waitFor(() => expect(view.getByText('王小明')).toBeTruthy());
  fireEvent.press(view.getByText('王小明'));
  await waitFor(() => expect(view.getByText('轉讓擁有權')).toBeTruthy());
}

function confirmTransfer() {
  const confirm = alertSpy.mock.calls.find((call) => call[0] === '確認轉讓擁有權');
  const buttons = confirm?.[2] as Array<{ text: string; onPress?: () => void }>;
  return buttons.find((b) => b.text === '確認轉讓')?.onPress;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGroupType = 'study';
  authState.user = { uid: 'alice' };
  authState.loading = false;
  authState.profileLoading = false;
  schoolState.school = { id: 'pu', name: '測試校', code: 'PU' };
  membershipState.aliceRole = 'owner';
  membershipState.aliceStatus = 'active';
  membershipState.bobRole = 'member';
  mockTransfer.mockImplementation(async () => {
    membershipState.aliceRole = 'member';
    membershipState.bobRole = 'owner';
    return {
      success: true,
      reused: false,
      groupId: 'g1',
      schoolId: 'pu',
      fromUid: 'alice',
      toUid: 'bob',
      actorNewRole: 'member',
      operationId: 'op-1',
    };
  });
});

test('confirmation names recipient and routes transfer through the callable', async () => {
  const view = render(<GroupMembersScreen route={{ params: { groupId: 'g1' } }} navigation={{}} />);
  await openManageBob(view);
  fireEvent.press(view.getByText('轉讓擁有權'));
  expect(mockTransfer).not.toHaveBeenCalled();
  const confirm = alertSpy.mock.calls.find((call) => call[0] === '確認轉讓擁有權');
  expect(confirm?.[1]).toMatch(/王小明/);
  expect(confirm?.[1]).toMatch(/一般成員/);
  await act(async () => {
    confirmTransfer()?.();
  });
  await waitFor(() => expect(mockTransfer).toHaveBeenCalledTimes(1));
  expect(mockTransfer.mock.calls[0][0]).toMatchObject({
    groupId: 'g1',
    targetUid: 'bob',
    expectedCurrentOwnerUid: 'alice',
  });
  await waitFor(() =>
    expect(alertSpy.mock.calls.some((call) => call[0] === '已轉讓擁有權')).toBe(true),
  );
  expect(getDoc).toHaveBeenCalled();
});

test('failure keeps target and retries with the same operationId', async () => {
  mockTransfer
    .mockRejectedValueOnce(Object.assign(new Error('暫時失敗'), { code: 'functions/unavailable' }))
    .mockImplementationOnce(async () => {
      membershipState.aliceRole = 'member';
      membershipState.bobRole = 'owner';
      return {
        success: true,
        reused: true,
        groupId: 'g1',
        schoolId: 'pu',
        fromUid: 'alice',
        toUid: 'bob',
        actorNewRole: 'member',
        operationId: 'op-retry',
      };
    });
  const view = render(<GroupMembersScreen route={{ params: { groupId: 'g1' } }} navigation={{}} />);
  await openManageBob(view);
  fireEvent.press(view.getByText('轉讓擁有權'));
  await act(async () => {
    confirmTransfer()?.();
  });
  await waitFor(() =>
    expect(alertSpy.mock.calls.some((call) => call[0] === '轉讓失敗')).toBe(true),
  );
  const firstId = mockTransfer.mock.calls[0][0].operationId;
  const fail = alertSpy.mock.calls.find((call) => call[0] === '轉讓失敗');
  const failButtons = fail?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => {
    failButtons.find((b) => b.text === '用同一操作重試')?.onPress?.();
  });
  await waitFor(() => expect(mockTransfer).toHaveBeenCalledTimes(2));
  expect(mockTransfer.mock.calls[1][0].operationId).toBe(firstId);
  expect(mockTransfer.mock.calls[1][0].targetUid).toBe('bob');
});

test('stale confirm callback after identity switch does not dispatch transfer', async () => {
  const view = render(<GroupMembersScreen route={{ params: { groupId: 'g1' } }} navigation={{}} />);
  await openManageBob(view);
  fireEvent.press(view.getByText('轉讓擁有權'));
  const stalePress = confirmTransfer();
  authState.user = { uid: 'carol' };
  view.rerender(<GroupMembersScreen route={{ params: { groupId: 'g1' } }} navigation={{}} />);
  await act(async () => {
    stalePress?.();
  });
  expect(mockTransfer).not.toHaveBeenCalled();
});

test('late success after unmount does not show success alert for new screen', async () => {
  const pending = deferred<Record<string, unknown>>();
  mockTransfer.mockReturnValueOnce(pending.promise);
  const view = render(<GroupMembersScreen route={{ params: { groupId: 'g1' } }} navigation={{}} />);
  await openManageBob(view);
  fireEvent.press(view.getByText('轉讓擁有權'));
  await act(async () => {
    confirmTransfer()?.();
  });
  view.unmount();
  alertSpy.mockClear();
  await act(async () => {
    membershipState.aliceRole = 'member';
    membershipState.bobRole = 'owner';
    pending.resolve({
      success: true,
      reused: false,
      groupId: 'g1',
      schoolId: 'pu',
      fromUid: 'alice',
      toUid: 'bob',
      actorNewRole: 'member',
      operationId: 'op-late',
    });
  });
  expect(alertSpy.mock.calls.some((call) => call[0] === '已轉讓擁有權')).toBe(false);
});

test('reloads actor membership and drops owner controls after confirmed transfer', async () => {
  const navigation = { navigate: jest.fn() };
  const view = render(
    <GroupMembersScreen route={{ params: { groupId: 'g1' } }} navigation={navigation} />,
  );
  await openManageBob(view);
  expect(view.getByText('轉讓擁有權')).toBeTruthy();
  fireEvent.press(view.getByText('轉讓擁有權'));
  await act(async () => {
    confirmTransfer()?.();
  });
  await waitFor(() =>
    expect(alertSpy.mock.calls.some((call) => call[0] === '已轉讓擁有權')).toBe(true),
  );
  await waitFor(() => expect(view.queryByText('轉讓擁有權')).toBeNull());
  await waitFor(() => expect(view.queryByText('你擁有管理成員的權限')).toBeNull());
  fireEvent.press(view.getByText('王小明'));
  expect(navigation.navigate).toHaveBeenCalledWith('Chat', { kind: 'dm', peerId: 'bob' });
  expect(view.queryByText('轉讓擁有權')).toBeNull();
  expect(membershipState.aliceRole).toBe('member');
});

test('scope switch during pending transfer re-enables actions for the new scope', async () => {
  const pending = deferred<Record<string, unknown>>();
  mockTransfer.mockReturnValueOnce(pending.promise);
  const view = render(<GroupMembersScreen route={{ params: { groupId: 'g1' } }} navigation={{}} />);
  await openManageBob(view);
  fireEvent.press(view.getByText('轉讓擁有權'));
  const stalePress = confirmTransfer();
  await act(async () => {
    stalePress?.();
  });
  await waitFor(() => expect(mockTransfer).toHaveBeenCalledTimes(1));
  authState.user = { uid: 'alice' };
  schoolState.school = { id: 'nthu', name: '新校', code: 'NTHU' };
  view.rerender(<GroupMembersScreen route={{ params: { groupId: 'g1' } }} navigation={{}} />);
  await openManageBob(view);
  const transferButton = view.getByText('轉讓擁有權');
  expect(transferButton).toBeTruthy();
  // New scope must not stay stuck in transferringOwnership from the old finally fence.
  alertSpy.mockClear();
  fireEvent.press(transferButton);
  expect(alertSpy.mock.calls.filter((call) => call[0] === '確認轉讓擁有權')).toHaveLength(1);
  await act(async () => {
    pending.resolve({
      success: true,
      reused: false,
      groupId: 'g1',
      schoolId: 'pu',
      fromUid: 'alice',
      toUid: 'bob',
      actorNewRole: 'member',
      operationId: 'op-stale-scope',
    });
  });
  expect(alertSpy.mock.calls.some((call) => call[0] === '已轉讓擁有權')).toBe(false);
});

test('既有非試辦社團在開關關閉時從安全 API 顯示名單，不查私人集合或開啟私訊', async () => {
  process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED = 'false';
  mockGroupType = 'club';
  membershipState.aliceRole = 'member';
  mockRoster.mockResolvedValue([{ name: '公開姓名', role: 'member' }]);
  const navigate = jest.fn();
  const view = render(
    <GroupMembersScreen route={{ params: { groupId: 'g1' } }} navigation={{ navigate }} />,
  );
  await waitFor(() => expect(view.getByText('公開姓名')).toBeTruthy());
  expect(mockRoster).toHaveBeenCalledWith('alice', 'pu', 'g1');
  expect(getDocs).not.toHaveBeenCalled();
  expect(view.queryByText('public-0')).toBeNull();
  fireEvent.press(view.getByText('公開姓名'));
  expect(navigate).not.toHaveBeenCalled();
  expect(view.queryByText('私訊')).toBeNull();
});

test.each(['functions/not-found', 'functions/unavailable', 'functions/permission-denied'])(
  'callable %s 時沿用既有查詢顯示社員名單',
  async (code) => {
    mockGroupType = 'club';
    membershipState.aliceRole = 'member';
    mockRoster.mockRejectedValue(Object.assign(new Error(code), { code }));
    const view = render(<GroupMembersScreen route={{ params: { groupId: 'g1' } }} />);
    await waitFor(() => expect(view.getByText('王小明')).toBeTruthy());
    expect(getDocs).toHaveBeenCalled();
  },
);
