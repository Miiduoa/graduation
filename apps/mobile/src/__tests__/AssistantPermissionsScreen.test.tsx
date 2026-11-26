import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AssistantPermissionsScreen } from '../screens/AssistantPermissionsScreen';
import {
  loadAssistantWritePermissionsState,
  saveAssistantWritePermissions,
} from '../services/assistantPermissions';
import {
  createDefaultAssistantWritePermissions,
  type AssistantWritePermissions,
} from '@campus/shared/src/assistantPermissions';

jest.mock('../state/auth', () => ({
  useAuth: () => mockAuth,
}));
jest.mock('../state/nuniSession', () => ({ useOptionalNuniSession: () => null }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/assistantPermissions', () => ({
  loadAssistantWritePermissionsState: jest.fn(),
  saveAssistantWritePermissions: jest.fn(),
}));

const load = loadAssistantWritePermissionsState as jest.Mock;
const save = saveAssistantWritePermissions as jest.Mock;

let mockAuth: {
  user: { uid: string } | null;
};

const navigation = { goBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: { uid: 'student-a' } };
  load.mockResolvedValue({
    permissions: createDefaultAssistantWritePermissions(),
    source: 'server',
  });
  save.mockResolvedValue(undefined);
});

test('lists write permission toggles defaulting off and saves changes', async () => {
  const view = render(<AssistantPermissionsScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByText('送出請假申請')).toBeTruthy());
  expect(view.getByText(/預設全部關閉/)).toBeTruthy();
  expect(view.getByText(/拆待辦／設提醒/)).toBeTruthy();
  expect(view.getByText('建立個人待辦與提醒')).toBeTruthy();
  expect(view.getByText('存成宿舍報修備忘')).toBeTruthy();
  expect(view.getByText(/確認後只會存成個人備忘，不會送到學校/)).toBeTruthy();
  expect(view.getByLabelText('送出請假申請').props.value).toBe(false);

  await act(async () => {
    fireEvent(view.getByLabelText('預約座位'), 'valueChange', true);
  });
  await act(async () => {
    fireEvent.press(view.getByText('儲存助理權限'));
  });

  await waitFor(() => expect(save).toHaveBeenCalled());
  const saved = save.mock.calls[0][1] as AssistantWritePermissions;
  expect(saved.reserveSeat).toBe(true);
  expect(saved.submitLeaveRequest).toBe(false);
});

test('shows login prompt when signed out', () => {
  mockAuth = { user: null };
  const view = render(<AssistantPermissionsScreen navigation={navigation} />);
  expect(view.getByText('請先登入')).toBeTruthy();
});
