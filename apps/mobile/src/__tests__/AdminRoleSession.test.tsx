import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { getDocs } from 'firebase/firestore';
import { updateSchoolMemberRole } from '../services/admin';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';

const mockDb = {};
let mockSchoolId = 'school-a';
jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: 'admin', email: 'admin@example.test' }, isAdmin: true, isEditor: false }),
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
  fetchSchoolDirectoryProfiles: jest.fn().mockResolvedValue([{ uid: 'member', displayName: '陳怡君' }]),
}));
jest.mock('../services/admin', () => ({ updateSchoolMemberRole: jest.fn() }));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolId = 'school-a';
  (getDocs as jest.Mock).mockImplementation(async (path: string) => ({
    docs: path.endsWith('/members') ? [{ id: 'member', data: () => ({ role: 'member' }) }] : [],
  }));
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

async function openMemberConfirmation(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByRole('tab', { name: '成員' }));
  await view.findByText('陳怡君');
  fireEvent.press(view.getByRole('button', { name: '設為管理員' }));
  const call = (Alert.alert as jest.Mock).mock.calls.find(([title]) => title === '確認變更權限');
  expect(call).toBeTruthy();
  expect(call[1]).toContain('陳怡君');
  return call[2].find((button: { text: string }) => button.text === '確認變更').onPress as () => void;
}

test('a role confirmation cannot dispatch after its admin screen unmounts', async () => {
  const view = render(<AdminDashboardScreen />);
  const confirm = await openMemberConfirmation(view);
  view.unmount();
  await act(async () => confirm());
  expect(updateSchoolMemberRole).not.toHaveBeenCalled();
});

test('returning to a school does not revive a confirmation from its previous session', async () => {
  const view = render(<AdminDashboardScreen />);
  const confirm = await openMemberConfirmation(view);
  mockSchoolId = 'school-b';
  view.rerender(<AdminDashboardScreen />);
  await waitFor(() => expect(getDocs).toHaveBeenCalledWith('schools/school-b/members'));
  mockSchoolId = 'school-a';
  view.rerender(<AdminDashboardScreen />);
  await view.findByText('陳怡君');
  await act(async () => confirm());
  expect(updateSchoolMemberRole).not.toHaveBeenCalled();
});

test('a pending role change from a previous school cannot disable the new school controls', async () => {
  (updateSchoolMemberRole as jest.Mock).mockReturnValue(new Promise(() => undefined));
  const view = render(<AdminDashboardScreen />);
  const confirm = await openMemberConfirmation(view);
  await act(async () => confirm());
  expect(updateSchoolMemberRole).toHaveBeenCalledWith({ schoolId: 'school-a', targetUid: 'member', role: 'admin' });
  mockSchoolId = 'school-b';
  view.rerender(<AdminDashboardScreen />);
  await view.findByText('陳怡君');
  expect(view.getByRole('button', { name: '設為管理員' }).props.accessibilityState.disabled).toBe(false);
});
