import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { getDocs } from 'firebase/firestore';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';

const mockDb = {};
const mockWrite = jest.fn();
const mockDelete = jest.fn();
let mockSchoolId = 'school-a';
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { uid: 'admin', email: 'admin@example.test' },
    isAdmin: true,
    isEditor: false,
  }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: mockSchoolId, name: '測試大學', code: 'LOCAL' } }),
}));
jest.mock('../firebase', () => ({ getDb: () => mockDb, getFunctionsInstance: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...parts: string[]) => parts.join('/'),
  query: (path: string) => path,
  documentId: () => '__name__',
  startAfter: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn(),
}));
jest.mock('../services/release', () => ({ isDevelopmentDemoSession: () => false }));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn().mockResolvedValue([]),
}));
jest.mock('../services/admin', () => ({}));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: jest.fn(() => ({
    uri: 'cache/private-admin.csv',
    exists: true,
    write: mockWrite,
    delete: mockDelete,
  })),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolId = 'school-a';
  (getDocs as jest.Mock).mockImplementation(async (path: string) => ({
    docs: path.endsWith('/adminLogs')
      ? [
          {
            id: 'private-log',
            data: () => ({ action: 'member.role.update', details: 'private school audit' }),
          },
        ]
      : [],
  }));
});

test.each(['school-change', 'unmount'])(
  'audit export cannot share a previous admin scope after %s',
  async (reason) => {
    let resolveAvailability!: (available: boolean) => void;
    (isAvailableAsync as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveAvailability = resolve;
      }),
    );
    const view = render(<AdminDashboardScreen />);
    fireEvent.press(view.getByRole('tab', { name: '設定' }));
    await view.findByText('private school audit');
    const alertSpy = jest.spyOn(Alert, 'alert');
    fireEvent.press(view.getByRole('button', { name: '匯出操作紀錄 CSV（可選範圍）' }));
    const chooser = alertSpy.mock.calls.find((call) => call[0] === '匯出操作紀錄');
    const choices = chooser?.[2] ?? [];
    const loaded = choices.find((choice) => choice.text?.includes('已載入且符合篩選'));
    expect(loaded?.onPress).toBeDefined();
    await act(async () => loaded?.onPress?.());
    alertSpy.mockRestore();
    await waitFor(() => expect(isAvailableAsync).toHaveBeenCalled());
    if (reason === 'school-change') {
      mockSchoolId = 'school-b';
      view.rerender(<AdminDashboardScreen />);
    } else view.unmount();
    await act(async () => resolveAvailability(true));
    expect(shareAsync).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  },
);
