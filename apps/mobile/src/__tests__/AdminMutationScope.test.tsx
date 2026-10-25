import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { getDocs } from 'firebase/firestore';
import * as admin from '../services/admin';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';

const mockDb = {};
let mockSchool = 'school-a';
let mockIsAdmin = true;
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { uid: 'staff', email: 'staff@example.test' },
    isAdmin: mockIsAdmin,
    isEditor: true,
  }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: mockSchool, name: '測試大學', code: 'LOCAL' } }),
}));
jest.mock('../firebase', () => ({ getDb: () => mockDb, getFunctionsInstance: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...parts: string[]) => parts.join('/'),
  query: (path: string) => path,
  documentId: () => '__name__',
  orderBy: jest.fn(),
  startAfter: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn(),
}));
jest.mock('../services/release', () => ({ isDevelopmentDemoSession: () => false }));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn().mockResolvedValue([]),
}));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/admin', () => ({
  upsertSchoolAnnouncement: jest.fn(),
  upsertSchoolEvent: jest.fn(),
  deleteSchoolAnnouncement: jest.fn(),
  deleteSchoolEvent: jest.fn(),
  bulkUpdateSchoolAnnouncements: jest.fn(),
  bulkDeleteSchoolEvents: jest.fn(),
  updateSchoolMemberRole: jest.fn(),
  upsertSchoolCafeteriaConfig: jest.fn(),
  upsertCafeteriaOperatorAssignment: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = 'school-a';
  mockIsAdmin = true;
  (getDocs as jest.Mock).mockImplementation(async (path: string) => ({
    docs: path.endsWith('/announcements')
      ? [{ id: 'ann', data: () => ({ title: '舊校公告', body: '內容' }) }]
      : path.endsWith('/clubEvents')
        ? [{ id: 'event', data: () => ({ title: '舊校活動' }) }]
        : path.endsWith('/cafeterias')
          ? [{ id: 'cafeteria', data: () => ({ name: '舊校餐廳' }) }]
          : [],
  }));
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

test.each(['公告', '活動'] as const)(
  '%s delete confirmation cannot dispatch after school change',
  async (section) => {
    const view = render(<AdminDashboardScreen />);
    fireEvent.press(view.getByRole('tab', { name: section }));
    await view.findByText(section === '公告' ? '舊校公告' : '舊校活動');
    fireEvent.press(view.getByRole('button', { name: '刪除', exact: true }));
    const buttons = (Alert.alert as jest.Mock).mock.calls.find(
      ([title]) => title === '確認刪除',
    )[2];
    const confirm = buttons.find((button: { text: string }) => button.text === '刪除').onPress;
    mockSchool = 'school-b';
    view.rerender(<AdminDashboardScreen />);
    await act(async () => confirm());
    expect(admin.deleteSchoolAnnouncement).not.toHaveBeenCalled();
    expect(admin.deleteSchoolEvent).not.toHaveBeenCalled();
  },
);

test('a bulk pin confirmation cannot act after unmount', async () => {
  const view = render(<AdminDashboardScreen />);
  fireEvent.press(view.getByRole('tab', { name: '公告' }));
  await view.findByText('舊校公告');
  fireEvent.press(view.getByRole('button', { name: '批次置頂（目前篩選）' }));
  const buttons = (Alert.alert as jest.Mock).mock.calls.find(
    ([title]) => title === '確認批次置頂',
  )[2];
  const confirm = buttons.find((button: { text: string }) => button.text === '確認').onPress;
  view.unmount();
  await act(async () => confirm());
  expect(admin.bulkUpdateSchoolAnnouncements).not.toHaveBeenCalled();
});

test.each(['announcement', 'cafeteria', 'operator'] as const)(
  '%s draft is hidden and cannot submit into another school',
  async (kind) => {
    const view = render(<AdminDashboardScreen />);
    if (kind === 'announcement') fireEvent.press(view.getByRole('button', { name: '發布公告' }));
    else {
      fireEvent.press(view.getByRole('tab', { name: '設定' }));
      await view.findByText('舊校餐廳');
      fireEvent.press(
        view.getByRole('button', { name: kind === 'cafeteria' ? '新增餐廳' : '管理店員' }),
      );
    }
    const placeholder =
      kind === 'announcement'
        ? '輸入公告標題'
        : kind === 'cafeteria'
          ? '輸入餐廳名稱'
          : '輸入 Firebase Auth UID';
    fireEvent.changeText(view.getByPlaceholderText(placeholder), 'school-a-draft');
    let saveNode = view.getByText('儲存');
    while (typeof saveNode.props.onPress !== 'function') saveNode = saveNode.parent!;
    const staleSave = saveNode.props.onPress as () => Promise<void>;
    mockSchool = 'school-b';
    view.rerender(<AdminDashboardScreen />);
    await act(async () => staleSave());
    expect(view.queryByPlaceholderText(placeholder)).toBeNull();
    expect(admin.upsertSchoolAnnouncement).not.toHaveBeenCalled();
    expect(admin.upsertSchoolCafeteriaConfig).not.toHaveBeenCalled();
    expect(admin.upsertCafeteriaOperatorAssignment).not.toHaveBeenCalled();
    if (kind === 'announcement') {
      fireEvent.press(view.getByRole('button', { name: '發布公告' }));
    } else {
      await view.findByText('舊校餐廳');
      fireEvent.press(
        view.getByRole('button', { name: kind === 'cafeteria' ? '新增餐廳' : '管理店員' }),
      );
    }
    fireEvent.changeText(view.getByPlaceholderText(placeholder), 'school-b-draft');
    await act(async () => fireEvent.press(view.getByText('儲存')));
    const operation =
      kind === 'announcement'
        ? admin.upsertSchoolAnnouncement
        : kind === 'cafeteria'
          ? admin.upsertSchoolCafeteriaConfig
          : admin.upsertCafeteriaOperatorAssignment;
    expect(operation).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 'school-b' }));
  },
);

test('a downgraded admin cannot revive a cafeteria draft when privileges return', async () => {
  const view = render(<AdminDashboardScreen />);
  fireEvent.press(view.getByRole('tab', { name: '設定' }));
  await view.findByText('舊校餐廳');
  fireEvent.press(view.getByRole('button', { name: '新增餐廳' }));
  fireEvent.changeText(view.getByPlaceholderText('輸入餐廳名稱'), '舊權限草稿');
  mockIsAdmin = false;
  view.rerender(<AdminDashboardScreen />);
  expect(view.queryByPlaceholderText('輸入餐廳名稱')).toBeNull();
  mockIsAdmin = true;
  view.rerender(<AdminDashboardScreen />);
  expect(view.queryByPlaceholderText('輸入餐廳名稱')).toBeNull();
});

test('a canceled announcement save cannot close a newer draft in the same school', async () => {
  let resolve!: (value: unknown) => void;
  (admin.upsertSchoolAnnouncement as jest.Mock).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const view = render(<AdminDashboardScreen />);
  fireEvent.press(view.getByRole('button', { name: '發布公告' }));
  fireEvent.changeText(view.getByPlaceholderText('輸入公告標題'), '先前草稿');
  fireEvent.press(view.getByText('儲存'));
  fireEvent.press(view.getByText('取消'));
  fireEvent.press(view.getByRole('button', { name: '發布公告' }));
  fireEvent.changeText(view.getByPlaceholderText('輸入公告標題'), '目前草稿');
  await act(async () => resolve({ success: true }));
  expect(view.getByPlaceholderText('輸入公告標題').props.value).toBe('目前草稿');
  expect(Alert.alert).not.toHaveBeenCalledWith('成功', expect.anything());
});
