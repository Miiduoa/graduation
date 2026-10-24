/**
 * Local UI fixture evidence (synthetic): verifies admin scope copy and load-more controls.
 * Not a production / real-device acceptance test.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { getDocs } from 'firebase/firestore';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';

const mockDb = {};
const authState = {
  user: { uid: 'admin_uid', email: 'admin@example.test' },
  isAdmin: true,
  isEditor: false,
};

jest.mock('../state/auth', () => ({
  useAuth: () => authState,
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', name: '靜宜大學', code: 'PU' } }),
}));
jest.mock('../firebase', () => ({ getDb: () => mockDb, getFunctionsInstance: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  query: (...args: unknown[]) => args,
  documentId: () => '__name__',
  startAfter: jest.fn((docSnap) => ({ after: docSnap })),
  orderBy: jest.fn((field, direction) => ({ order: field, direction })),
  limit: (size: number) => ({ limit: size }),
  getDocs: jest.fn(),
}));
jest.mock('../features/engagement', () => ({ useAmbientCues: () => ({ cue: null }) }));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn(async (_school: string, uids: string[]) =>
    uids.map((uid) => ({
      uid,
      displayName: uid,
      department: null,
      avatarUrl: null,
    })),
  ),
}));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('../components/AIMissionControl', () => ({ AIMissionControl: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: '/tmp' },
  File: class {
    uri = '/tmp/mock.csv';
    write() {}
  },
}));

const doc = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  data: () => data,
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(Constants.expoConfig!, { extra: { appEnv: 'development' } });
  (getDocs as jest.Mock).mockImplementation(async (qy: unknown) => {
    const path = Array.isArray(qy) ? String(qy[0]) : String(qy);
    if (path.includes('members')) {
      return {
        docs: Array.from({ length: 50 }, (_, index) =>
          doc(`member-${String(index).padStart(2, '0')}`, { role: 'member' }),
        ),
      };
    }
    if (path.includes('adminLogs')) {
      return {
        docs: Array.from({ length: 50 }, (_, index) =>
          doc(`log-${index}`, { action: `action_${index}`, createdAt: { seconds: 1000 - index } }),
        ),
      };
    }
    if (path.includes('announcements')) {
      return {
        docs: Array.from({ length: 50 }, (_, index) =>
          doc(`ann-${index}`, {
            title: `公告 ${index}`,
            body: '內容',
            publishedAt: { seconds: 1000 - index },
          }),
        ),
      };
    }
    if (path.includes('clubEvents')) {
      return { docs: Array.from({ length: 50 }, (_, index) => doc(`evt-${index}`, { title: `活動 ${index}` })) };
    }
    return { docs: [] };
  });
});

test('members tab shows loaded-scope search copy and a reachable load-more control', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(view.getByText('管理後台')).toBeTruthy());
  fireEvent.press(view.getByText('成員'));
  await waitFor(() => expect(view.getByText('載入更多成員')).toBeTruthy());
  expect(view.getByText(/搜尋只比對已載入列|沒有全校伺服器搜尋/)).toBeTruthy();
  expect(view.getByPlaceholderText(/搜尋已載入成員/)).toBeTruthy();
});

test('settings audit section does not present the first page as full history', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(view.getByText('管理後台')).toBeTruthy());
  fireEvent.press(view.getByText('設定'));
  await waitFor(() => expect(view.getByText('載入更多操作紀錄')).toBeTruthy());
  expect(view.getByText(/不是全校全部|尚有未載入資料/)).toBeTruthy();
  expect(view.getByText('匯出操作紀錄 CSV（可選範圍）')).toBeTruthy();
});
