import { Alert } from 'react-native';
import { upsertSchoolEvent } from '../services/admin';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { getDocs } from 'firebase/firestore';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';
const mockDb = {};
let mockUid = 'admin';
let mockSchool = 'pu';
const mockWrite = jest.fn();
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { uid: mockUid, email: 'admin@example.test' },
    isAdmin: true,
    isEditor: false,
  }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: mockSchool, name: '靜宜大學', code: 'PU' } }),
}));
jest.mock('../firebase', () => ({ getDb: () => mockDb, getFunctionsInstance: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  query: (path: string) => path,
  documentId: () => '__name__',
  startAfter: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
}));
jest.mock('../features/engagement', () => ({ useAmbientCues: () => ({ cue: null }) }));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn().mockResolvedValue([]),
}));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('../components/AIMissionControl', () => ({
  AIMissionControl: () => {
    throw new Error('Demo missions must not render in production');
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('../services/admin', () => ({ upsertSchoolEvent: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: jest.fn(() => ({ uri: 'cache/file.csv', write: mockWrite })),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  shareAsync: jest.fn(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'admin';
  mockSchool = 'pu';
  (getDocs as jest.Mock).mockResolvedValue({ docs: [] });
  Object.assign(Constants.expoConfig!, { extra: { appEnv: 'production' } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
async function open(view: ReturnType<typeof render>) {
  await waitFor(() => expect(getDocs).toHaveBeenCalled());
  fireEvent.press(view.getByText('建立新活動'));
  fireEvent.changeText(view.getByPlaceholderText('輸入活動名稱'), '真實講座');
}
test('the publication form passes only explicitly enabled and completed policy to the producer', async () => {
  (upsertSchoolEvent as jest.Mock).mockResolvedValue({ success: true, eventId: 'one' });
  const view = render(<AdminDashboardScreen />);
  await open(view);
  fireEvent(view.getByLabelText('受理 App 報名'), 'valueChange', true);
  fireEvent(view.getByLabelText('確認本活動免費'), 'valueChange', true);
  fireEvent.changeText(view.getByLabelText('開始受理時間'), '2030-01-01 08:00');
  fireEvent.changeText(view.getByLabelText('報名截止時間'), '2030-01-02 08:00');
  await act(async () => fireEvent.press(view.getByText('儲存')));
  expect(upsertSchoolEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      schoolId: 'pu',
      registrationPolicy: {
        enabled: true,
        free: true,
        eligibility: 'active-school-members',
        opensAt: '2030-01-01T00:00:00.000Z',
        closesAt: '2030-01-02T00:00:00.000Z',
        allowCancellation: false,
        cancellationClosesAt: null,
      },
    }),
  );
});
test.each(['school', 'account', 'form'])(
  'late save after %s changes neither closes the new form nor reports success',
  async (kind) => {
    let resolve!: (value: unknown) => void;
    (upsertSchoolEvent as jest.Mock).mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    const view = render(<AdminDashboardScreen />);
    await open(view);
    fireEvent.press(view.getByText('儲存'));
    if (kind === 'school') mockSchool = 'other';
    else if (kind === 'account') mockUid = 'next';
    if (kind === 'form') fireEvent.press(view.getByText('取消'));
    else view.rerender(<AdminDashboardScreen />);
    fireEvent.press(view.getByText('建立新活動'));
    fireEvent.changeText(view.getByPlaceholderText('輸入活動名稱'), '新草稿');
    await act(async () => resolve({ success: true, eventId: 'old' }));
    expect(view.getByPlaceholderText('輸入活動名稱').props.value).toBe('新草稿');
    expect(Alert.alert).not.toHaveBeenCalledWith('成功', expect.anything());
  },
);
test('admin list and CSV use the controlled count while unknown legacy numbers stay unknown', async () => {
  (getDocs as jest.Mock).mockImplementation(async (path) => ({
    docs: path.endsWith('/clubEvents')
      ? [
          {
            id: 'managed',
            data: () => ({
              title: '新受理活動',
              registrationPolicy: { version: 1 },
              appRegistrationCount: 1,
              registeredCount: 0,
              capacity: 1,
            }),
          },
          { id: 'old', data: () => ({ title: '舊活動', capacity: 3 }) },
        ]
      : [],
  }));
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(getDocs).toHaveBeenCalled());
  fireEvent.press(view.getAllByText('活動')[0]);
  await view.findByText('新受理活動');
  expect(view.getByText('👥 1 / 1 人')).toBeTruthy();
  expect(view.getByText('👥 待確認 / 3 人')).toBeTruthy();
  fireEvent.press(view.getByText('匯出目前篩選結果 CSV'));
  await waitFor(() => expect(mockWrite).toHaveBeenCalled());
  const csv = mockWrite.mock.calls[0][0];
  expect(csv).toContain('"managed","新受理活動"');
  expect(csv).toMatch(/"1","1"(?:\r?\n|$)/);
  expect(csv).toContain('待確認');
});
