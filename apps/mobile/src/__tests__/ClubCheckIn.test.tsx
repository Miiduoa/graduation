import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';
import { ClubCheckIn } from '../screens/ClubCheckIn';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callClubPortal } from '../services/clubPortal';
const mockStorage = new Map<string, string>();
let mockOnline = false,
  mockNetworkListener: (value: { isConnected: boolean }) => void;
jest.mock('../services/clubPortal', () => ({ callClubPortal: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockStorage.get(key) || null,
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
}));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: mockOnline }),
  addEventListener: (listener: typeof mockNetworkListener) => {
    mockNetworkListener = listener;
    return jest.fn();
  },
}));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false }, jest.fn()],
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('../ui/components', () => {
  const { Text, Pressable } = require('react-native');
  return {
    Button: ({ text, onPress, disabled }: any) => (
      <Pressable onPress={onPress} disabled={disabled}>
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  mockOnline = false;
  jest
    .mocked(callClubPortal)
    .mockResolvedValue({ success: true, office: false, message: '社員 已簽到' });
});
test('手機離線輸入先暫存；恢復連線後確認成功才移除', async () => {
  const confirmed = jest.fn();
  render(
    <ClubCheckIn
      uid="one"
      schoolId="pu"
      groupId="club"
      eventId="event"
      officer
      onConfirmed={confirmed}
    />,
  );
  fireEvent.press(screen.getByText('開始簽到'));
  await screen.findByText('0 筆待送出');
  fireEvent.changeText(screen.getByLabelText('學號後四碼或簽到碼'), '1234');
  fireEvent.press(screen.getByText('確認簽到碼'));
  await screen.findByText('1 筆待送出');
  expect(callClubPortal).not.toHaveBeenCalled();
  await act(async () => {
    mockOnline = true;
    mockNetworkListener({ isConnected: true });
  });
  await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
  expect(screen.getByText('0 筆待送出')).toBeTruthy();
  expect(screen.getByText('社員 已簽到')).toBeTruthy();
});
test('伺服器拒絕時保留待送出，其他帳號不讀取該佇列', async () => {
  mockStorage.set(
    JSON.stringify(['club-check-in', 'one', 'pu', 'club', 'event']),
    JSON.stringify(['1234']),
  );
  jest.mocked(callClubPortal).mockRejectedValue(new Error('沒有社團管理權限'));
  const confirmed = jest.fn();
  const view = render(
    <ClubCheckIn
      uid="one"
      schoolId="pu"
      groupId="club"
      eventId="event"
      officer
      onConfirmed={confirmed}
    />,
  );
  fireEvent.press(screen.getByText('開始簽到'));
  await screen.findByText('1 筆待送出');
  fireEvent.press(screen.getByText('重送待送出簽到'));
  await screen.findByText(/沒有社團管理權限/);
  expect(confirmed).not.toHaveBeenCalled();
  view.unmount();
  render(
    <ClubCheckIn
      uid="two"
      schoolId="pu"
      groupId="club"
      eventId="event"
      officer
      onConfirmed={confirmed}
    />,
  );
  fireEvent.press(screen.getByText('開始簽到'));
  await screen.findByText('0 筆待送出');
  expect(mockStorage.get(JSON.stringify(['club-check-in', 'one', 'pu', 'club', 'event']))).toBe(
    '["1234"]',
  );
});

test('連續輸入在暫存尚未完成時依序保留所有簽到碼', async () => {
  let finish!: () => void;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(
    (key, value) =>
      new Promise<void>((resolve) => {
        finish = () => {
          mockStorage.set(key, value);
          resolve();
        };
      }),
  );
  render(
    <ClubCheckIn
      uid="one"
      schoolId="pu"
      groupId="club"
      eventId="event"
      officer
      onConfirmed={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByText('開始簽到'));
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('學號後四碼或簽到碼'), '1234');
  fireEvent.press(screen.getByText('確認簽到碼'));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.changeText(screen.getByLabelText('學號後四碼或簽到碼'), '5678');
  fireEvent.press(screen.getByText('確認簽到碼'));
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await screen.findByText('2 筆待送出');
  expect(mockStorage.get(JSON.stringify(['club-check-in', 'one', 'pu', 'club', 'event']))).toBe(
    '["1234","5678"]',
  );
  await act(async () => {
    mockOnline = true;
    mockNetworkListener({ isConnected: true });
  });
  await screen.findByText('0 筆待送出');
  expect(jest.mocked(callClubPortal).mock.calls.map((args) => args[2]?.checkInCode)).toEqual([
    '1234',
    '5678',
  ]);
});

test.each(['簽到碼無效', '網路暫時中斷'])(
  '%s 保留失敗項目，後續仍送出並可個別刪除',
  async (message) => {
    const key = JSON.stringify(['club-check-in', 'one', 'pu', 'club', 'event']);
    mockStorage.set(key, JSON.stringify(['bad', 'good']));
    jest.mocked(callClubPortal).mockRejectedValueOnce(new Error(message));
    const confirmed = jest.fn();
    render(
      <ClubCheckIn
        uid="one"
        schoolId="pu"
        groupId="club"
        eventId="event"
        officer
        onConfirmed={confirmed}
      />,
    );
    fireEvent.press(screen.getByText('開始簽到'));
    await screen.findByText('2 筆待送出');
    fireEvent.press(screen.getByText('重送待送出簽到'));
    await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
    expect(jest.mocked(callClubPortal).mock.calls.map((args) => args[2]?.checkInCode)).toEqual([
      'bad',
      'good',
    ]);
    expect(mockStorage.get(key)).toBe('["bad"]');
    expect(screen.getByText(new RegExp(message))).toBeTruthy();
    fireEvent.press(screen.getByText('刪除第 1 筆失敗簽到'));
    await screen.findByText('0 筆待送出');
    expect(mockStorage.get(key)).toBe('[]');
  },
);

test('暫時失敗紀錄可在重載後重送成功', async () => {
  const key = JSON.stringify(['club-check-in', 'one', 'pu', 'club', 'event']);
  mockStorage.set(key, '["1234"]');
  jest.mocked(callClubPortal).mockRejectedValueOnce(new Error('網路暫時中斷'));
  const props = {
    uid: 'one',
    schoolId: 'pu',
    groupId: 'club',
    eventId: 'event',
    officer: true,
    onConfirmed: jest.fn(),
  };
  const view = render(<ClubCheckIn {...props} />);
  fireEvent.press(screen.getByText('開始簽到'));
  await screen.findByText('1 筆待送出');
  fireEvent.press(screen.getByText('重送待送出簽到'));
  await screen.findByText(/網路暫時中斷/);
  view.unmount();
  render(<ClubCheckIn {...props} />);
  fireEvent.press(screen.getByText('開始簽到'));
  await screen.findByText('1 筆待送出');
  fireEvent.press(screen.getByText('重送待送出簽到'));
  await waitFor(() => expect(props.onConfirmed).toHaveBeenCalledTimes(1));
  expect(mockStorage.get(key)).toBe('[]');
});
