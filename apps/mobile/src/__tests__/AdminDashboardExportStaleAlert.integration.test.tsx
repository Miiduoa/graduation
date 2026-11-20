/**
 * Integration regression: native Alert callbacks outlive render/unmount.
 * Must exercise AdminDashboardScreen, not only AdminExportSession.
 * Synthetic local evidence — not production acceptance.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor, type RenderAPI } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { getDocs } from 'firebase/firestore';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';

const mockDb = {};
const mockFileWrite = jest.fn();
const consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => {});

const authState = {
  user: { uid: 'admin-old', email: 'old@example.test' } as { uid: string; email: string } | null,
  isAdmin: true,
  isEditor: true,
  loading: false,
  profileLoading: false,
};

const schoolState = {
  school: { id: 'school-old', name: '舊校', code: 'OLD' },
};

jest.mock('../state/auth', () => ({
  useAuth: () => authState,
}));
jest.mock('../state/school', () => ({
  useSchool: () => schoolState,
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
  fetchSchoolDirectoryProfiles: jest.fn(async () => []),
}));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('../components/AIMissionControl', () => ({ AIMissionControl: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: '/tmp' },
  File: class {
    uri = '/tmp/mock.csv';
    write(...args: unknown[]) {
      mockFileWrite(...args);
    }
  },
}));

const doc = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  data: () => data,
});

function mockOldSchoolLogs() {
  (getDocs as jest.Mock).mockImplementation(async () => ({
    docs: [
      doc('secret-log', {
        action: 'update_member',
        details: 'prior-school-secret',
        actorEmail: 'old-actor@example.test',
        createdAt: { seconds: 1700000000 },
      }),
    ],
  }));
}

function resetIdentity() {
  authState.user = { uid: 'admin-old', email: 'old@example.test' };
  authState.isAdmin = true;
  authState.isEditor = true;
  authState.loading = false;
  authState.profileLoading = false;
  schoolState.school = { id: 'school-old', name: '舊校', code: 'OLD' };
}

async function openSettingsAndCaptureLoadedExport(view: RenderAPI): Promise<() => void> {
  fireEvent.press(view.getByText('設定'));
  await waitFor(() => expect(view.getByText('匯出操作紀錄 CSV（可選範圍）')).toBeTruthy());

  await view.findByText('prior-school-secret');
  const alertSpy = jest.spyOn(Alert, 'alert');
  fireEvent.press(view.getByText('匯出操作紀錄 CSV（可選範圍）'));
  await waitFor(() => expect(alertSpy).toHaveBeenCalled());

  const chooser = alertSpy.mock.calls.find((call) => call[0] === '匯出操作紀錄');
  expect(chooser).toBeTruthy();
  const buttons = chooser![2] as Array<{ text?: string; onPress?: () => void }>;
  const loaded = buttons.find((button) => button.text?.includes('已載入且符合篩選'));
  expect(typeof loaded?.onPress).toBe('function');
  alertSpy.mockRestore();
  return () => loaded!.onPress!();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFileWrite.mockClear();
  consoleInfo.mockClear();
  resetIdentity();
  Object.assign(Constants.expoConfig!, { extra: { appEnv: 'development' } });
  mockOldSchoolLogs();
});

afterAll(() => {
  consoleInfo.mockRestore();
});

test('stale loaded-export Alert callback does not write/share/log after school+account change', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(view.getByText('管理後台')).toBeTruthy());
  const runLoadedExport = await openSettingsAndCaptureLoadedExport(view);

  schoolState.school = { id: 'school-new', name: '新校', code: 'NEW' };
  authState.user = { uid: 'admin-new', email: 'new@example.test' };
  view.rerender(<AdminDashboardScreen />);

  const alertSpy = jest.spyOn(Alert, 'alert');
  await act(async () => {
    runLoadedExport();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockFileWrite).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
  expect(consoleInfo).not.toHaveBeenCalledWith(
    '[AdminDashboard] Local-only admin action:',
    expect.objectContaining({ action: 'export_admin_logs_csv' }),
  );
  expect(alertSpy.mock.calls.some((call) => call[0] === '匯出完成')).toBe(false);
  expect(String(mockFileWrite.mock.calls[0]?.[0] ?? '')).not.toContain('prior-school-secret');
  alertSpy.mockRestore();
});

test('stale loaded-export Alert callback rejects while profileLoading after uid swap', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(view.getByText('管理後台')).toBeTruthy());
  const runLoadedExport = await openSettingsAndCaptureLoadedExport(view);

  authState.user = { uid: 'admin-new', email: 'new@example.test' };
  authState.profileLoading = true;
  authState.isAdmin = true; // stale privileged flags must not authorize export
  view.rerender(<AdminDashboardScreen />);

  await act(async () => {
    runLoadedExport();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockFileWrite).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
  expect(consoleInfo).not.toHaveBeenCalledWith(
    '[AdminDashboard] Local-only admin action:',
    expect.anything(),
  );
});

test('stale loaded-export Alert callback after unmount does not share old school actors', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(view.getByText('管理後台')).toBeTruthy());
  const runLoadedExport = await openSettingsAndCaptureLoadedExport(view);

  view.unmount();

  await act(async () => {
    runLoadedExport();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockFileWrite).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
});

test('same-scope loaded export still writes, shares, and logs under captured origin', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(view.getByText('管理後台')).toBeTruthy());
  const runLoadedExport = await openSettingsAndCaptureLoadedExport(view);
  const alertSpy = jest.spyOn(Alert, 'alert');

  await act(async () => {
    runLoadedExport();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockFileWrite).toHaveBeenCalled();
  expect(String(mockFileWrite.mock.calls[0]?.[0] ?? '')).toContain('old-actor@example.test');
  expect(isAvailableAsync).toHaveBeenCalled();
  expect(shareAsync).toHaveBeenCalled();
  expect(consoleInfo).toHaveBeenCalledWith(
    '[AdminDashboard] Local-only admin action:',
    expect.objectContaining({
      action: 'export_admin_logs_csv',
      details: expect.stringContaining('school=school-old'),
    }),
  );
  expect(alertSpy.mock.calls.some((call) => call[0] === '匯出完成')).toBe(true);
  alertSpy.mockRestore();
});

test('full-export cancel then retry under same scope remains usable', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(view.getByText('管理後台')).toBeTruthy());
  fireEvent.press(view.getByText('設定'));
  await waitFor(() => expect(view.getByText('匯出操作紀錄 CSV（可選範圍）')).toBeTruthy());

  let resolvePage!: (value: unknown) => void;
  (getDocs as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
  );

  const alertSpy = jest.spyOn(Alert, 'alert');
  fireEvent.press(view.getByText('匯出操作紀錄 CSV（可選範圍）'));
  await waitFor(() => expect(alertSpy).toHaveBeenCalled());
  const chooser = alertSpy.mock.calls.find((call) => call[0] === '匯出操作紀錄')!;
  const buttons = chooser[2] as Array<{ text?: string; onPress?: () => void }>;
  const full = buttons.find((button) => button.text?.includes('分頁匯出完整歷史'))!;

  await act(async () => {
    full.onPress!();
  });
  await waitFor(() => expect(view.getByText('取消完整匯出')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('取消完整匯出'));
  });
  expect(alertSpy.mock.calls.some((call) => call[0] === '已取消')).toBe(true);

  mockOldSchoolLogs();
  fireEvent.press(view.getByText('匯出操作紀錄 CSV（可選範圍）'));
  await waitFor(() =>
    expect(alertSpy.mock.calls.filter((call) => call[0] === '匯出操作紀錄').length).toBeGreaterThan(
      1,
    ),
  );
  const retryChooser = [...alertSpy.mock.calls]
    .reverse()
    .find((call) => call[0] === '匯出操作紀錄')!;
  const retryButtons = retryChooser[2] as Array<{ text?: string; onPress?: () => void }>;
  const retryLoaded = retryButtons.find((button) => button.text?.includes('已載入且符合篩選'))!;

  await act(async () => {
    retryLoaded.onPress!();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockFileWrite).toHaveBeenCalled();
  expect(shareAsync).toHaveBeenCalled();

  await act(async () => {
    resolvePage?.({ docs: [] });
    await Promise.resolve();
  });

  alertSpy.mockRestore();
});

test('demotion to editor invalidates an already-open private audit export chooser', async () => {
  const view = render(<AdminDashboardScreen />);
  const runLoadedExport = await openSettingsAndCaptureLoadedExport(view);
  authState.isAdmin = false;
  authState.isEditor = true;
  view.rerender(<AdminDashboardScreen />);
  await act(async () => {
    runLoadedExport();
    await Promise.resolve();
  });
  expect(mockFileWrite).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
});
