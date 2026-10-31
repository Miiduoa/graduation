import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { ClassroomScreen } from '../screens/ClassroomScreen';
import { joinClassroomAttendance } from '../services/liveAttendance';
import type { AttendanceReceipt } from '@campus/shared/src/attendanceReliability';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

const mockUser = { uid: 'student' };
const mockRequestCamera = jest.fn();
const mockSession = {
  session: { active: true, teacherId: 'teacher', attendeeCount: 0, reactions: { understood: 0, partial: 0, confused: 0 } },
  loading: false, isTeacher: false, canAttend: true, qrToken: null, qrExpiresAt: null,
  joined: false, receipt: null as AttendanceReceipt | null, error: null, refresh: jest.fn(),
};
const mockDb = {};
const mockFunctions = {};
jest.mock('../firebase', () => ({ getDb: () => mockDb, getFunctionsInstance: () => mockFunctions, isFirebaseMockMode: () => true }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser, profile: { schoolId: 'school' } }) }));
jest.mock('../hooks/useClassroomSession', () => ({ useClassroomSession: () => mockSession }));
jest.mock('../services/liveAttendance', () => ({
  ...jest.requireActual('../services/liveAttendance'), joinClassroomAttendance: jest.fn(),
}));
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: false, canAskAgain: false }, mockRequestCamera],
}));
jest.mock('react-native-qrcode-svg', () => 'QRCode');
jest.mock('../ui/components', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  const Container = ({ children, title, subtitle }) => React.createElement(View, null,
    React.createElement(Text, null, title), React.createElement(Text, null, subtitle), children);
  return { Screen: Container, Card: Container, AnimatedCard: Container,
    Pill: ({ text }) => React.createElement(Text, null, text),
    Button: ({ text, onPress, disabled }) => React.createElement(Pressable,
      { onPress, disabled, accessibilityRole: 'button' }, React.createElement(Text, null, text)),
    ErrorState: Container, LoadingState: Container };
});
const props = { route: { params: { groupId: 'course', sessionId: 'session' } } };
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.joined = false;
  mockSession.receipt = null;
  mockRequestCamera.mockResolvedValue({ granted: false });
});

test('相機拒絕可開設定或改用簽到碼，沒有送出點名', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const view = render(<ClassroomScreen {...props} />);
  await act(async () => fireEvent.press(view.getByText('掃描 QR Code')));
  expect(alert).toHaveBeenCalledWith('相機還沒開放', expect.stringContaining('簽到碼'), expect.any(Array));
  const buttons = alert.mock.calls[0][2]!;
  buttons.find((button) => button.text === '開啟設定')!.onPress!();
  expect(settings).toHaveBeenCalled();
  expect(view.getByLabelText('簽到碼')).toBeTruthy();
  expect(joinClassroomAttendance).not.toHaveBeenCalled();
  alert.mockRestore(); settings.mockRestore();
});

test('弱網保留掃碼待送，重送仍用同一憑證，回應前不顯示成功', async () => {
  jest.mocked(joinClassroomAttendance).mockRejectedValueOnce({ code: 'functions/unavailable' })
    .mockResolvedValueOnce({ success: true, alreadyJoined: true, checkedInAt: '2026-10-23T10:00:00Z' });
  const view = render(<ClassroomScreen {...props} />);
  fireEvent.changeText(view.getByLabelText('簽到碼'), 'same-proof');
  await act(async () => fireEvent.press(view.getByText('確認簽到')));
  expect(view.getByLabelText('簽到碼').props.value).toBe('same-proof');
  expect(view.queryByText('已完成簽到')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('再確認簽到')));
  const calls = jest.mocked(joinClassroomAttendance).mock.calls;
  expect(calls[0]).toEqual(calls[1]);
  // 畫面以伺服器訂閱的收據為準。
  mockSession.joined = true;
  mockSession.receipt = { status: 'present', source: 'qr', checkedInAt: '2026-10-23T10:00:00Z', correctedAt: null };
  view.rerender(<ClassroomScreen {...props} />);
  expect(view.getByText('已完成簽到')).toBeTruthy();
  expect(view.getByText(/簽到收據/)).toBeTruthy();
  mockSession.joined = false;
  mockSession.receipt = { status: 'absent', source: 'manual', checkedInAt: null, correctedAt: '2026-10-23T10:01:00Z' };
  view.rerender(<ClassroomScreen {...props} />);
  expect(view.queryByText('已完成簽到')).toBeNull();
  expect(view.getByText(/教師已核定.*缺席/)).toBeTruthy();
});

test.each(['deadline-exceeded', 'permission-denied'])('伺服器拒絕 %s 後清除舊碼並可重掃', async (code) => {
  jest.mocked(joinClassroomAttendance).mockRejectedValueOnce({ code: `functions/${code}` });
  const view = render(<ClassroomScreen {...props} />);
  fireEvent.changeText(view.getByLabelText('簽到碼'), 'old-proof');
  await act(async () => fireEvent.press(view.getByText('確認簽到')));
  expect(view.getByLabelText('簽到碼').props.value).toBe('');
  expect(view.queryByText('已完成簽到')).toBeNull();
  expect(view.getByText('掃描 QR Code')).toBeTruthy();
});
