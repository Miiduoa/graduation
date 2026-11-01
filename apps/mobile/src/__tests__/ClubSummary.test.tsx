import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { ClubSummary } from '../screens/ClubSummary';
const mockCall = jest.fn();
let mockUser: { uid: string } = { uid: 'one' };
const mockDoc = jest.fn();
const mockDocs = jest.fn();
jest.mock('firebase/firestore', () => ({
  doc: (...parts: unknown[]) => parts.slice(1).join('/'),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocFromServer: (...args: unknown[]) => mockDoc(...args),
  getDocsFromServer: (...args: unknown[]) => mockDocs(...args),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCall }));
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUser }),
  getFunctionsInstance: () => ({}),
  getDb: () => ({}),
}));
jest.mock('../ui/components', () => {
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: ({ children, title }: { children: React.ReactNode; title: string }) => (
      <View>
        <Text>{title}</Text>
        {children}
      </View>
    ),
    Button: ({ text, onPress }: { text: string; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});
beforeEach(() => {
  jest.resetAllMocks();
  mockUser = { uid: 'one' };
  mockDoc.mockImplementation(async (path: string) => ({
    data: () =>
      path === 'groups/club'
        ? { type: 'club', schoolId: 'school' }
        : path.includes('/directory/')
          ? { displayName: '備援社員' }
          : { status: 'active' },
  }));
  mockDocs.mockResolvedValue({
    docs: [{ id: 'one', data: () => ({ role: 'owner', phone: '0900000000' }) }],
  });
  process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED = 'true';
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED;
});
test('預設關閉不讀取資料', () => {
  delete process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED;
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(mockCall).not.toHaveBeenCalled();
  expect(screen.queryByText('社團後台')).toBeNull();
});
test('唯讀呈現伺服器名單與統計', async () => {
  mockCall.mockResolvedValue({
    data: { members: [{ id: 'one', name: '測試社員', role: '社員' }], events: [] },
  });
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('社員 1 位 · 活動 0 場')).toBeTruthy();
  expect(mockCall).toHaveBeenCalledWith({ schoolId: 'school', groupId: 'club', action: 'read' });
  expect(screen.queryByText('學號')).toBeNull();
});
test('拒絕讀取顯示錯誤', async () => {
  mockCall.mockRejectedValue(new Error('denied'));
  mockDoc.mockResolvedValue({ data: () => ({ status: 'inactive' }) });
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('無法確認社團資料，請重試')).toBeTruthy();
});

test.each(['functions/not-found', 'functions/unavailable', 'network-request-failed'])(
  '%s 時備援僅呈現姓名與中文角色',
  async (code) => {
    mockCall.mockRejectedValue(Object.assign(new Error(code), { code }));
    render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
    expect(await screen.findByText('備援社員 · 會長')).toBeTruthy();
    expect(screen.getByText('活動資料暫時無法取得')).toBeTruthy();
    expect(screen.queryByText(/活動 0 場|尚無活動|0900000000/)).toBeNull();
  },
);
test('備援讀取途中切帳號不回傳舊名單', async () => {
  mockCall.mockRejectedValue(new Error('network'));
  mockDocs.mockImplementation(async () => {
    mockUser = { uid: 'two' };
    return { docs: [{ id: 'one', data: () => ({ displayName: '舊社員', role: 'member' }) }] };
  });
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('無法確認社團資料，請重試')).toBeTruthy();
  expect(screen.queryByText(/舊社員|備援社員/)).toBeNull();
});
test('切帳號後忽略尚未完成的舊請求', async () => {
  let finish!: (value: unknown) => void;
  mockCall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  mockUser = { uid: 'two' };
  mockCall.mockResolvedValue({
    data: { members: [{ id: 'two', name: '新社員', role: 'admin' }], events: [] },
  });
  view.rerender(<ClubSummary uid="two" schoolId="school" groupId="club" />);
  expect(await screen.findByText('新社員 · 幹部')).toBeTruthy();
  await act(async () => {
    finish({ data: { members: [{ id: 'one', name: '舊社員', role: 'owner' }], events: [] } });
  });
  expect(screen.queryByText(/舊社員/)).toBeNull();
  expect(screen.getByText('新社員 · 幹部')).toBeTruthy();
});

test('備援查詢失去讀權時拒絕回傳名單', async () => {
  mockCall.mockRejectedValue(new Error('missing'));
  mockDoc.mockRejectedValue(new Error('permission-denied'));
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('無法確認社團資料，請重試')).toBeTruthy();
  expect(mockDocs).not.toHaveBeenCalled();
});
test('登入帳號與參數不符時不讀取資料', async () => {
  render(<ClubSummary uid="other" schoolId="school" groupId="club" />);
  expect(await screen.findByText('無法確認社團資料，請重試')).toBeTruthy();
  expect(mockCall).not.toHaveBeenCalled();
  expect(mockDoc).not.toHaveBeenCalled();
});
