import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { getDocs } from 'firebase/firestore';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';
import {
  updateSchoolMemberRole,
  upsertSchoolAnnouncement,
  upsertSchoolEvent,
} from '../services/admin';
import { ADMIN_PAGE_SIZES } from '../screens/admin/adminWorkbenchStyles';

const mockDb = {};
let mockUid = 'demo_admin_sys';
let mockSchool = 'pu';
let mockIsAdmin = true;
let mockIsEditor = false;

jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { uid: mockUid, email: 'admin@example.test' },
    isAdmin: mockIsAdmin,
    isEditor: mockIsEditor,
  }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: mockSchool, name: '靜宜大學', code: 'PU' } }),
}));
jest.mock('../firebase', () => ({ getDb: () => mockDb, getFunctionsInstance: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  query: (path: string, ..._rest: unknown[]) => path,
  documentId: () => '__name__',
  startAfter: jest.fn((cursor: unknown) => ({ type: 'startAfter', cursor })),
  orderBy: jest.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  limit: jest.fn((n: number) => ({ type: 'limit', n })),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
}));
jest.mock('../features/engagement', () => ({ useAmbientCues: () => ({ cue: null }) }));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn(async (_school: string, uids: string[]) =>
    uids.map((uid) => ({
      uid,
      displayName: uid === 'member-page2' ? '第二頁成員' : `名稱-${uid}`,
      department: null,
      avatarUrl: null,
    })),
  ),
}));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('../components/AIMissionControl', () => ({
  AIMissionControl: () => {
    throw new Error('Demo missions must not render on admin workbench');
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/admin', () => ({
  upsertSchoolEvent: jest.fn(),
  upsertSchoolAnnouncement: jest.fn(),
  deleteSchoolAnnouncement: jest.fn(),
  deleteSchoolEvent: jest.fn(),
  bulkUpdateSchoolAnnouncements: jest.fn(),
  bulkDeleteSchoolEvents: jest.fn(),
  updateSchoolMemberRole: jest.fn(),
  upsertSchoolCafeteriaConfig: jest.fn(),
  upsertCafeteriaOperatorAssignment: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: jest.fn(() => ({ uri: 'cache/file.csv', write: jest.fn() })),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  shareAsync: jest.fn(),
}));

function memberDocs(ids: string[]) {
  return ids.map((id) => ({
    id,
    data: () => ({ role: 'member', joinedAt: null }),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'demo_admin_sys';
  mockSchool = 'pu';
  mockIsAdmin = true;
  mockIsEditor = false;
  Object.assign(Constants.expoConfig!, { extra: { appEnv: 'production' } });
  (getDocs as jest.Mock).mockResolvedValue({ docs: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

test('loading does not present a verified zero count for announcements', async () => {
  let resolveAnn!: (value: { docs: unknown[] }) => void;
  (getDocs as jest.Mock).mockImplementation((path: string) => {
    if (String(path).includes('/announcements')) {
      return new Promise((resolve) => {
        resolveAnn = resolve;
      });
    }
    return Promise.resolve({ docs: [] });
  });

  const view = render(<AdminDashboardScreen />);
  expect(view.getByText('管理後台')).toBeTruthy();
  expect(view.getByLabelText(/公告 載入中/)).toBeTruthy();
  expect(view.queryByLabelText(/公告 目前已載入 0$/)).toBeNull();

  await act(async () => {
    resolveAnn({ docs: [] });
  });
  await waitFor(() => expect(view.getByLabelText(/公告 目前已載入 0$/)).toBeTruthy());
});

test('announcement failure is distinct from empty and offers retry', async () => {
  (getDocs as jest.Mock).mockImplementation((path: string) => {
    if (String(path).includes('/announcements')) {
      return Promise.reject(new Error('announcements offline'));
    }
    return Promise.resolve({ docs: [] });
  });

  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(view.getByText(/載入失敗：announcements offline/)).toBeTruthy());
  expect(view.queryByText('尚無公告')).toBeNull();
  fireEvent.press(view.getByText('重試'));
  await waitFor(() => expect(getDocs).toHaveBeenCalled());
});

test('primary actions and honest loaded scope copy are present', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(getDocs).toHaveBeenCalled());
  expect(view.getByText('發布公告')).toBeTruthy();
  expect(view.getByText('建立新活動')).toBeTruthy();
  expect(view.getByText('靜宜大學（PU）')).toBeTruthy();
  expect(view.getByText('學校管理員')).toBeTruthy();
  expect(view.queryByText('學習 · 管理員模式')).toBeNull();
  expect(view.queryByText('清空所有測試資料')).toBeNull();
});

test('member screen reaches a second-page record after 載入更多成員', async () => {
  const page1Ids = Array.from({ length: ADMIN_PAGE_SIZES.members }, (_, i) => `member-${i}`);
  let memberCalls = 0;
  (getDocs as jest.Mock).mockImplementation((path: string) => {
    if (String(path).includes('/members')) {
      memberCalls += 1;
      if (memberCalls === 1) {
        return Promise.resolve({ docs: memberDocs(page1Ids) });
      }
      return Promise.resolve({ docs: memberDocs(['member-page2']) });
    }
    return Promise.resolve({ docs: [] });
  });

  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(getDocs).toHaveBeenCalled());
  fireEvent.press(view.getByRole('tab', { name: '成員' }));
  await waitFor(() => expect(view.getByText('載入更多成員')).toBeTruthy());
  expect(view.queryByText('第二頁成員')).toBeNull();

  fireEvent.press(view.getByText('載入更多成員'));
  await waitFor(() => expect(view.getByText('第二頁成員')).toBeTruthy());
});

test('member role change requires confirmation naming old and new roles', async () => {
  (updateSchoolMemberRole as jest.Mock).mockResolvedValue({ success: true });
  (getDocs as jest.Mock).mockImplementation((path: string) => {
    if (String(path).includes('/members')) {
      return Promise.resolve({
        docs: [
          {
            id: 'target-user',
            data: () => ({ role: 'member' }),
          },
        ],
      });
    }
    return Promise.resolve({ docs: [] });
  });

  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(getDocs).toHaveBeenCalled());
  fireEvent.press(view.getByRole('tab', { name: '成員' }));
  await waitFor(() => expect(view.getByText('設為編輯者')).toBeTruthy());
  fireEvent.press(view.getByText('設為編輯者'));

  expect(Alert.alert).toHaveBeenCalledWith(
    '確認變更權限',
    expect.stringContaining('一般成員'),
    expect.any(Array),
  );
  expect(Alert.alert).toHaveBeenCalledWith(
    '確認變更權限',
    expect.stringContaining('編輯者'),
    expect.any(Array),
  );
  expect(updateSchoolMemberRole).not.toHaveBeenCalled();

  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
    text: string;
    onPress?: () => void;
  }>;
  const confirm = buttons.find((b) => b.text === '確認變更');
  await act(async () => {
    confirm?.onPress?.();
  });
  await waitFor(() =>
    expect(updateSchoolMemberRole).toHaveBeenCalledWith({
      schoolId: 'pu',
      targetUid: 'target-user',
      role: 'editor',
    }),
  );
});

test('canceled role confirmation does not mutate', async () => {
  (getDocs as jest.Mock).mockImplementation((path: string) => {
    if (String(path).includes('/members')) {
      return Promise.resolve({
        docs: [{ id: 'target-user', data: () => ({ role: 'member' }) }],
      });
    }
    return Promise.resolve({ docs: [] });
  });

  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(getDocs).toHaveBeenCalled());
  fireEvent.press(view.getByRole('tab', { name: '成員' }));
  await waitFor(() => expect(view.getByText('設為管理員')).toBeTruthy());
  fireEvent.press(view.getByText('設為管理員'));
  expect(updateSchoolMemberRole).not.toHaveBeenCalled();
});

test('reload all does not claim immediate success', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(getDocs).toHaveBeenCalled());
  fireEvent.press(view.getByRole('tab', { name: '設定' }));
  fireEvent.press(view.getByText('重新載入所有資料'));
  expect(Alert.alert).not.toHaveBeenCalledWith('成功', '資料已重新載入');
});

test('content editors publish announcements and events without querying school administration', async () => {
  mockIsAdmin = false;
  mockIsEditor = true;
  (upsertSchoolAnnouncement as jest.Mock).mockResolvedValue({ success: true });
  (upsertSchoolEvent as jest.Mock).mockResolvedValue({ success: true, eventId: 'content-event' });
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(getDocs).toHaveBeenCalledWith('schools/pu/announcements'));
  expect(getDocs).toHaveBeenCalledWith('schools/pu/clubEvents');
  expect(view.getByText('校園內容編輯')).toBeTruthy();
  expect(view.getAllByRole('tab')).toHaveLength(3);
  expect(view.queryByRole('tab', { name: '成員' })).toBeNull();
  expect(view.queryByRole('tab', { name: '設定' })).toBeNull();
  expect(view.queryByText('前往成員')).toBeNull();
  expect(view.queryByText('前往設定')).toBeNull();
  expect(view.queryByText('課程認證')).toBeNull();
  expect(view.queryByLabelText(/^成員 /)).toBeNull();

  fireEvent.press(view.getByRole('tab', { name: '公告' }));
  fireEvent.press(view.getByRole('button', { name: '發布公告' }));
  fireEvent.changeText(view.getByPlaceholderText('輸入公告標題'), '內容編輯發布的公告');
  fireEvent.changeText(view.getByPlaceholderText('輸入公告內容'), '已確認的校內消息');
  await act(async () => fireEvent.press(view.getByText('儲存')));
  expect(upsertSchoolAnnouncement).toHaveBeenCalledWith(
    expect.objectContaining({ schoolId: 'pu', title: '內容編輯發布的公告' }),
  );

  fireEvent.press(view.getByRole('tab', { name: '活動' }));
  fireEvent.press(view.getByRole('button', { name: '建立新活動' }));
  fireEvent.changeText(view.getByPlaceholderText('輸入活動名稱'), '內容編輯發布的活動');
  await act(async () => fireEvent.press(view.getByText('儲存')));
  expect(upsertSchoolEvent).toHaveBeenCalledWith(
    expect.objectContaining({ schoolId: 'pu', title: '內容編輯發布的活動' }),
  );
  expect(
    (getDocs as jest.Mock).mock.calls.every(([path]) => /\/(announcements|clubEvents)$/.test(path)),
  ).toBe(true);
  expect(updateSchoolMemberRole).not.toHaveBeenCalled();
});

test('losing school administration immediately leaves the settings view and stops admin reads', async () => {
  const view = render(<AdminDashboardScreen />);
  await waitFor(() => expect(getDocs).toHaveBeenCalledWith('schools/pu/adminLogs'));
  fireEvent.press(view.getByRole('tab', { name: '設定' }));
  expect(view.getByText('基本資訊')).toBeTruthy();
  (getDocs as jest.Mock).mockClear();
  mockIsAdmin = false;
  mockIsEditor = true;
  view.rerender(<AdminDashboardScreen />);
  expect(view.queryByText('基本資訊')).toBeNull();
  expect(view.queryByRole('tab', { name: '設定' })).toBeNull();
  expect(view.getByText('今日工作')).toBeTruthy();
  await waitFor(() => expect(getDocs).toHaveBeenCalledWith('schools/pu/announcements'));
  expect(
    (getDocs as jest.Mock).mock.calls.every(([path]) => /\/(announcements|clubEvents)$/.test(path)),
  ).toBe(true);
});
