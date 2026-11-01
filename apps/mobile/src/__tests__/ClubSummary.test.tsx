import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ClubSummary } from '../screens/ClubSummary';
const mockCall = jest.fn();
const mockUser = { uid: 'one' };
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCall }));
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUser }),
  getFunctionsInstance: () => ({}),
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
  jest.clearAllMocks();
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
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('無法確認社團資料，請重試')).toBeTruthy();
});
