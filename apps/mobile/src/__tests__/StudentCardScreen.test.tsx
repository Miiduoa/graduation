import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import StudentCardScreen from '../screens/StudentCardScreen';
import { requestStudentCardCode } from '../services/studentCard';
import {
  beginStudentCardNfcPresentation,
  getStudentCardNfcCapabilities,
  StudentCardNfcError,
} from '../services/studentCardNfc';

const mockUser = { uid: 'student-a' };
const student = {
  ...mockUser,
  role: 'student',
  schoolId: 'pu',
  displayName: 'A1234567 同學',
  studentId: 'A1234567',
};
let mockAuth = { user: mockUser as typeof mockUser | null, profile: student };
let mockSchoolId = 'pu';
let mockFocused = true;
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({
  useSchool: () => ({
    selectionReady: true,
    selection: { schoolId: mockSchoolId },
    school: { id: mockSchoolId, name: '目前學校' },
  }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 88 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock(
  'react-native-qrcode-svg',
  () => (props: { value: string }) =>
    require('react').createElement(require('react-native').Text, null, props.value),
);
jest.mock('../services/studentCard', () => ({
  ...jest.requireActual('../services/studentCard'),
  requestStudentCardCode: jest.fn(),
}));
jest.mock('../services/studentCardNfc', () => ({
  ...jest.requireActual('../services/studentCardNfc'),
  getStudentCardNfcCapabilities: jest.fn(),
  beginStudentCardNfcPresentation: jest.fn(),
}));

beforeEach(() => {
  mockAuth = { user: mockUser, profile: student };
  mockSchoolId = 'pu';
  mockFocused = true;
  jest.clearAllMocks();
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue({
    moduleAvailable: false,
    canRead: false,
    canPresent: false,
    enabled: false,
  });
  jest.mocked(beginStudentCardNfcPresentation).mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('only exposes the complete profile number on demand, including when the fallback name contains it', () => {
  let changed: ((value: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'change') changed = handler as (value: AppStateStatus) => void;
    return { remove: jest.fn() };
  });
  const v = render(<StudentCardScreen />);
  expect(v.queryByText(/A1234567/)).toBeNull();
  fireEvent.press(v.getByText('出示學號'));
  expect(v.getByText('A1234567')).toBeTruthy();
  expect(requestStudentCardCode).not.toHaveBeenCalled();
  act(() => changed!('background'));
  expect(v.queryByText(/A1234567/)).toBeNull();
});

test('the QR uses only the issued token and the server number, and closes on expiry', async () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  try {
    const token = 'x'.repeat(32);
    jest
      .mocked(requestStudentCardCode)
      .mockResolvedValue({ token, studentId: 'S0003141', expiresAt: Date.now() + 5000 });
    const v = render(<StudentCardScreen />);
    await act(async () => fireEvent.press(v.getByText('取得驗證碼')));
    expect(v.getByText(`https://nuni.tw/student-card/verify#${token}`)).toBeTruthy();
    expect(v.getByText('S0003141')).toBeTruthy();
    expect(v.queryByText(/A1234567/)).toBeNull();
    act(() => jest.advanceTimersByTime(5100));
    expect(v.queryByText('S0003141')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('changing school while the code is loading clears the request and previous card', async () => {
  let finish!: (value: Awaited<ReturnType<typeof requestStudentCardCode>>) => void;
  jest.mocked(requestStudentCardCode).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const v = render(<StudentCardScreen />);
  fireEvent.press(v.getByText('取得驗證碼'));
  const signal = jest.mocked(requestStudentCardCode).mock.calls[0][2];
  mockSchoolId = 'fcu';
  v.rerender(<StudentCardScreen />);
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish({ token: 'x'.repeat(32), studentId: 'S0003141', expiresAt: Date.now() + 5000 }),
  );
  expect(v.queryByText('S0003141')).toBeNull();
  expect(v.getByText('行動逢甲')).toBeTruthy();
  expect(v.queryByText('取得驗證碼')).toBeNull();
});

test('a guest can open a school service without seeing any account details', () => {
  mockAuth.user = null;
  const v = render(<StudentCardScreen />);
  expect(v.queryByText(/A1234567/)).toBeNull();
  expect(v.getByText('靜宜大學 App')).toBeTruthy();
  expect(v.queryByText('出示學號')).toBeNull();
});

test('announces a missing profile number accurately to assistive technology', () => {
  mockAuth.profile = { ...student, displayName: '同學', studentId: '' };
  const v = render(<StudentCardScreen />);
  expect(v.getByLabelText('未提供學號')).toBeTruthy();
  expect(v.queryByLabelText('學號已隱藏')).toBeNull();
  expect(v.queryByText('出示學號')).toBeNull();
});

test('NFC and QR share the issued credential and switching to QR stops native presentation', async () => {
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue({
    moduleAvailable: true,
    canRead: true,
    canPresent: true,
    enabled: true,
  });
  const code = {
    token: 'n'.repeat(32),
    studentId: 'S1234567890123456789012345678901',
    expiresAt: Date.now() + 55_000,
  };
  jest.mocked(requestStudentCardCode).mockResolvedValue(code);
  const v = render(<StudentCardScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應出示')));
  await act(async () => fireEvent(v.getByTestId('student-card-presentation'), 'show'));
  expect(beginStudentCardNfcPresentation).toHaveBeenCalledWith(
    code,
    expect.any(AbortSignal),
    expect.any(Function),
  );
  const signal = jest.mocked(beginStudentCardNfcPresentation).mock.calls[0][1]!;
  expect(v.getByText('感應出示已開啟')).toBeTruthy();
  expect(v.getByText(code.studentId)).toHaveStyle({ maxWidth: '100%' });
  expect(v.queryByText(`https://nuni.tw/student-card/verify#${code.token}`)).toBeNull();
  await act(async () => fireEvent.press(v.getByText('QR Code')));
  expect(signal.aborted).toBe(true);
  expect(v.getByText(`https://nuni.tw/student-card/verify#${code.token}`)).toBeTruthy();
  expect(requestStudentCardCode).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(v.getByRole('tab', { name: 'NFC 感應' })));
  expect(beginStudentCardNfcPresentation).toHaveBeenCalledTimes(2);
  expect(requestStudentCardCode).toHaveBeenCalledTimes(1);
  v.unmount();
  expect(jest.mocked(beginStudentCardNfcPresentation).mock.calls[1][1]!.aborted).toBe(true);
});

test('an NFC activation failure keeps the same credential available as a QR code', async () => {
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue({
    moduleAvailable: true,
    canRead: true,
    canPresent: true,
    enabled: true,
  });
  jest
    .mocked(beginStudentCardNfcPresentation)
    .mockRejectedValue(new StudentCardNfcError('DISABLED', '請先開啟 NFC。'));
  const code = { token: 'n'.repeat(32), studentId: 'S0003141', expiresAt: Date.now() + 55_000 };
  jest.mocked(requestStudentCardCode).mockResolvedValue(code);
  const v = render(<StudentCardScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應出示')));
  await act(async () => fireEvent(v.getByTestId('student-card-presentation'), 'show'));
  expect(v.getByText('請先開啟 NFC。')).toBeTruthy();
  await act(async () => fireEvent.press(v.getByText('QR Code')));
  expect(v.getByText(`https://nuni.tw/student-card/verify#${code.token}`)).toBeTruthy();
  expect(requestStudentCardCode).toHaveBeenCalledTimes(1);
});

test('leaving the screen stops NFC and removes the full student number', async () => {
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue({
    moduleAvailable: true,
    canRead: true,
    canPresent: true,
    enabled: true,
  });
  jest.mocked(requestStudentCardCode).mockResolvedValue({
    token: 'n'.repeat(32),
    studentId: 'S0003141',
    expiresAt: Date.now() + 55_000,
  });
  const v = render(<StudentCardScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應出示')));
  await act(async () => fireEvent(v.getByTestId('student-card-presentation'), 'show'));
  const signal = jest.mocked(beginStudentCardNfcPresentation).mock.calls[0][1]!;
  mockFocused = false;
  v.rerender(<StudentCardScreen />);
  expect(signal.aborted).toBe(true);
  expect(v.queryByText('S0003141')).toBeNull();
});

test('a native stop cancels a delayed activation and can restart using the same code', async () => {
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue({
    moduleAvailable: true,
    canRead: true,
    canPresent: true,
    enabled: true,
  });
  jest.mocked(requestStudentCardCode).mockResolvedValue({
    token: 'n'.repeat(32),
    studentId: 'S0003141',
    expiresAt: Date.now() + 55_000,
  });
  let finish!: () => void;
  jest.mocked(beginStudentCardNfcPresentation).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const v = render(<StudentCardScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應出示')));
  expect(beginStudentCardNfcPresentation).not.toHaveBeenCalled();
  await act(async () => fireEvent(v.getByTestId('student-card-presentation'), 'show'));
  const [, signal, stopped] = jest.mocked(beginStudentCardNfcPresentation).mock.calls[0];
  act(() => stopped!());
  expect(signal!.aborted).toBe(true);
  await act(async () => finish());
  expect(v.queryByText('感應出示已開啟')).toBeNull();
  expect(v.getByText('感應已停止，請重新開啟或使用 QR Code。')).toBeTruthy();
  await act(async () => fireEvent.press(v.getByText('重新開啟感應')));
  expect(v.getByText('感應出示已開啟')).toBeTruthy();
  expect(requestStudentCardCode).toHaveBeenCalledTimes(1);
});

test('accessibility escape stops presentation and removes the full student number', async () => {
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue({
    moduleAvailable: true,
    canRead: true,
    canPresent: true,
    enabled: true,
  });
  jest.mocked(requestStudentCardCode).mockResolvedValue({
    token: 'n'.repeat(32),
    studentId: 'S0003141',
    expiresAt: Date.now() + 55_000,
  });
  const v = render(<StudentCardScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應出示')));
  await act(async () => fireEvent(v.getByTestId('student-card-presentation'), 'show'));
  const signal = jest.mocked(beginStudentCardNfcPresentation).mock.calls[0][1]!;
  fireEvent(v.getByText('S0003141'), 'accessibilityEscape');
  expect(signal.aborted).toBe(true);
  expect(v.queryByText('S0003141')).toBeNull();
});
