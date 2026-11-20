import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { QRCodeScreen } from '../screens/QRCodeScreen';
import { safeNavigate } from '../utils/safeNavigate';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';

let mockUser: { uid: string } | null = { uid: 'user-a' };
let mockSchool = { id: 'pu' };
let mockGranted = true;
const mockRequestPermission = jest.fn();
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').getCurrentTheme() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-qrcode-svg', () => ({
  __esModule: true,
  default: (props: unknown) => require('react').createElement('QRCode', props),
}));
jest.mock('expo-camera', () => ({
  CameraView: (props: unknown) => require('react').createElement('CameraView', props),
  useCameraPermissions: () => [{ granted: mockGranted }, mockRequestPermission],
}));
jest.mock('../firebase', () => ({
  getFunctionsInstance: () => 'functions',
  isFirebaseMockMode: () => false,
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../services/tronClassWebUiGate', () => ({ linkingOpenWithPuTronClassGate: jest.fn() }));
const call = jest.fn();
const confirmed = {
  success: true,
  ownerUid: 'user-a',
  groupId: 'group-a',
  groupName: '課程群組',
  status: 'active',
};
const scanRoute = { params: { openScanMode: true } };
function enter(view: ReturnType<typeof render>, value: string) {
  fireEvent.changeText(view.getByLabelText('QR 碼內容'), value);
  fireEvent.press(view.getByText('查看內容'));
}
function deferred<T>() {
  let resolve!: (data: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'user-a' };
  mockSchool = { id: 'pu' };
  mockGranted = true;
  mockRequestPermission.mockResolvedValue({ granted: false });
  jest.mocked(httpsCallable).mockReturnValue(call as never);
  call.mockResolvedValue({ data: confirmed });
  jest.mocked(linkingOpenWithPuTronClassGate).mockResolvedValue(true);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});
afterEach(() => jest.restoreAllMocks());

test('generates and shares only the actual friend link, not an attendance or group credential', async () => {
  const view = render(<QRCodeScreen />);
  expect(view.queryByText('活動簽到')).toBeNull();
  expect(view.queryByText('加入群組')).toBeNull();
  expect(view.getByText(/這不是簽到憑證/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('分享連結或內容')));
  expect(Share.share).toHaveBeenCalledWith({ message: 'campus://add-friend?uid=user-a' });
  expect(call).not.toHaveBeenCalled();
});

test('requires confirmation and a valid backend result before showing joined', async () => {
  const pending = deferred<{ data: typeof confirmed }>();
  call.mockReturnValueOnce(pending.promise);
  const navigation = { navigate: jest.fn() };
  const view = render(<QRCodeScreen navigation={navigation} route={scanRoute} />);
  enter(view, 'campus://group/join/abcd1234');
  expect(call).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('加入這個群組'));
  fireEvent.press(view.getByText('正在確認加入結果…'));
  expect(call).toHaveBeenCalledTimes(1);
  expect(view.queryByText('已加入群組：課程群組')).toBeNull();
  await act(async () => pending.resolve({ data: confirmed }));
  expect(view.getByText('已加入群組：課程群組')).toBeTruthy();
  fireEvent.press(view.getByText('開啟群組'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'GroupDetail', { groupId: 'group-a' });
});

test('a denied or unconfirmed join stays recoverable without a success claim', async () => {
  call
    .mockRejectedValueOnce(new Error('permission-denied'))
    .mockResolvedValueOnce({ data: { ...confirmed, ownerUid: 'another' } });
  const view = render(<QRCodeScreen route={scanRoute} />);
  enter(view, 'campus://group/join/ABCDEFGH');
  await act(async () => fireEvent.press(view.getByText('加入這個群組')));
  expect(view.getByRole('alert')).toHaveTextContent(/尚未確認已加入群組/);
  await act(async () => fireEvent.press(view.getByText('加入這個群組')));
  expect(view.queryByText('已加入群組：課程群組')).toBeNull();
  expect(view.queryByText('開啟群組')).toBeNull();
});

test('legacy or expired attendance and group payloads cannot claim success or invoke a write', () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<QRCodeScreen navigation={navigation} route={scanRoute} />);
  enter(
    view,
    `campus://checkin?data=${btoa(JSON.stringify({ ts: 0, t: 'checkin', sig: 'legacy' }))}`,
  );
  expect(view.getByText(/尚未完成簽到/)).toBeTruthy();
  expect(view.queryByText('簽到成功')).toBeNull();
  enter(view, 'campus://group/join?data=legacy');
  expect(view.getByText(/尚未加入群組/)).toBeTruthy();
  expect(view.queryByText('加入這個群組')).toBeNull();
  expect(call).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('開啟課程簽到'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'Attendance', undefined);
  fireEvent.press(view.getByText('開啟群組與加入碼'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'Groups', undefined);
});

test.each(['account', 'school'])(
  'a changed %s clears the old scan and ignores a pending result',
  async (kind) => {
    const pending = deferred<{ data: typeof confirmed }>();
    call.mockReturnValueOnce(pending.promise);
    const view = render(<QRCodeScreen route={scanRoute} />);
    enter(view, 'campus://group/join/ABCDEFGH');
    fireEvent.press(view.getByText('加入這個群組'));
    if (kind === 'account') mockUser = { uid: 'user-b' };
    else mockSchool = { id: 'another-school' };
    view.rerender(<QRCodeScreen route={scanRoute} />);
    expect(view.queryByText('掃描結果')).toBeNull();
    await act(async () => pending.resolve({ data: confirmed }));
    expect(view.queryByText('已加入群組：課程群組')).toBeNull();
    expect(safeNavigate).not.toHaveBeenCalled();
  },
);

test('signed-out users cannot send a group membership mutation', async () => {
  mockUser = null;
  const view = render(<QRCodeScreen route={scanRoute} />);
  enter(view, 'campus://group/join/ABCDEFGH');
  await act(async () => fireEvent.press(view.getByText('加入這個群組')));
  expect(view.getByRole('alert')).toHaveTextContent(/請先登入/);
  expect(call).not.toHaveBeenCalled();
});

test('camera permission denial is honest and a scan never autojoins', async () => {
  mockGranted = false;
  const view = render(<QRCodeScreen route={scanRoute} />);
  await act(async () => fireEvent.press(view.getByText('開啟相機掃描')));
  expect(view.queryByTestId('qr-camera')).toBeNull();
  expect(view.getByRole('alert')).toHaveTextContent(/尚未取得相機權限/);
  mockRequestPermission.mockResolvedValueOnce({ granted: true });
  await act(async () => fireEvent.press(view.getByText('開啟相機掃描')));
  fireEvent(view.getByTestId('qr-camera'), 'barcodeScanned', {
    data: 'campus://group/join/ABCDEFGH',
  });
  expect(view.queryByTestId('qr-camera')).toBeNull();
  expect(view.getByText('加入這個群組')).toBeTruthy();
  expect(call).not.toHaveBeenCalled();
});

test('friend links only open the confirmation page and failed web links report the actual failure', async () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<QRCodeScreen navigation={navigation} route={scanRoute} />);
  enter(view, 'campus://add-friend?uid=another-user');
  fireEvent.press(view.getByText('查看對方資料'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'FriendSearch', {
    presetUid: 'another-user',
  });
  enter(view, 'https://school.example/');
  jest.mocked(linkingOpenWithPuTronClassGate).mockResolvedValueOnce(false);
  await act(async () => fireEvent.press(view.getByText('開啟這個網址')));
  expect(view.getByRole('alert')).toHaveTextContent(/未開啟連結/);
  expect(call).not.toHaveBeenCalled();
});
