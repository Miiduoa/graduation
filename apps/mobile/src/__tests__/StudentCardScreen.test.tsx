import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import {
  createAccountDemoPermissions,
  createAccountDemoState,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
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
const mockDemoRequest = jest.fn();
const mockPlatform = {
  session: null as { platformAccountId: string; context: string; expiresAt: number } | null,
  loading: false,
  pendingLogout: false,
  error: '',
  bffRequest: mockDemoRequest,
};
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/nuniSession', () => ({ useOptionalNuniSession: () => mockPlatform }));
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
  mockPlatform.session = null;
  mockPlatform.loading = false;
  mockPlatform.pendingLogout = false;
  mockPlatform.error = '';
  mockDemoRequest.mockReset();
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

const demoAccountId = 'pa_12345678-1234-1234-1234-123456789abc';
function accountDemo(overrides: Partial<AccountDemoSnapshot> = {}): AccountDemoSnapshot {
  return {
    accountId: demoAccountId,
    revision: 1,
    profile: {
      displayName: '展示同學',
      schoolId: 'pu',
      schoolName: '靜宜大學',
      studentId: 'DEMO20261112',
      department: '資訊管理學系',
    },
    permissions: createAccountDemoPermissions(true),
    state: createAccountDemoState(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

function signInPlatform() {
  mockAuth.user = null;
  mockPlatform.session = {
    platformAccountId: demoAccountId,
    context: 'native-session-a',
    expiresAt: Date.now() + 3_600_000,
  };
}

test('a Google platform account can open its own server-authorized demonstration card without Firebase', async () => {
  signInPlatform();
  mockDemoRequest.mockResolvedValue({ demo: accountDemo() });
  const v = render(<StudentCardScreen />);
  expect(await v.findByLabelText('展示學生證')).toBeTruthy();
  expect(v.getByText('展示同學')).toBeTruthy();
  expect(v.queryByText('DEMO20261112')).toBeNull();
  expect(v.queryByText('請先登入學校帳號。')).toBeNull();
  expect(mockDemoRequest).toHaveBeenCalledWith('account-demo', 'native-session-a');
  expect(v.getByText('展示資料與權限')).toBeTruthy();
});

test('the demonstration QR uses a separate marker and does not invoke verified student-card or NFC issuance', async () => {
  signInPlatform();
  mockDemoRequest.mockResolvedValue({ demo: accountDemo() });
  const v = render(<StudentCardScreen />);
  fireEvent.press(await v.findByText('出示展示 QR Code'));
  expect(v.getByText(/^nuni-demo-card:v1:pu:DEMO20261112:\d+$/)).toBeTruthy();
  expect(v.getByText('DEMO20261112')).toBeTruthy();
  expect(requestStudentCardCode).not.toHaveBeenCalled();
  expect(beginStudentCardNfcPresentation).not.toHaveBeenCalled();
  fireEvent.press(v.getByText('收起學生證'));
  expect(v.queryByTestId('demo-student-card-presentation')).toBeNull();
  expect(v.queryByText('DEMO20261112')).toBeNull();
});

test.each(['disabled', 'expired', 'other-school', 'other-account'] as const)(
  'the demonstration card rejects %s authorization',
  async (condition) => {
    signInPlatform();
    const demo = accountDemo();
    if (condition === 'disabled') demo.permissions.studentCard = false;
    if (condition === 'expired') demo.expiresAt = new Date(Date.now() - 1).toISOString();
    if (condition === 'other-school') demo.profile.schoolId = 'thu';
    if (condition === 'other-account') demo.accountId = 'pa_22345678-1234-1234-1234-123456789abc';
    mockDemoRequest.mockResolvedValue({ demo });
    const v = render(<StudentCardScreen />);
    expect(
      await v.findByText(
        condition === 'disabled'
          ? '學生證展示尚未開啟'
          : condition === 'expired'
            ? '展示資料已到期'
            : condition === 'other-school'
              ? '請切回展示帳號的學校'
              : '暫時無法讀取展示學生證',
      ),
    ).toBeTruthy();
    expect(v.queryByText('展示同學')).toBeNull();
    expect(v.queryByText('出示展示 QR Code')).toBeNull();
  },
);

test('a late demo response cannot restore a card from the previous platform account', async () => {
  signInPlatform();
  let finish!: (value: unknown) => void;
  mockDemoRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const v = render(<StudentCardScreen />);
  mockPlatform.session = {
    ...mockPlatform.session!,
    platformAccountId: 'pa_22345678-1234-1234-1234-123456789abc',
    context: 'native-session-b',
  };
  mockDemoRequest.mockResolvedValueOnce({ demo: null });
  v.rerender(<StudentCardScreen />);
  await act(async () => finish({ demo: accountDemo() }));
  expect(v.queryByText('展示同學')).toBeNull();
  expect(v.queryByText('出示展示 QR Code')).toBeNull();
});

test.each(['logout', 'context', 'school', 'unfocused'] as const)(
  'an open demonstration card is removed immediately on %s',
  async (change) => {
    signInPlatform();
    mockDemoRequest.mockResolvedValue({ demo: accountDemo() });
    const v = render(<StudentCardScreen />);
    fireEvent.press(await v.findByText('出示展示 QR Code'));
    expect(v.getByText('DEMO20261112')).toBeTruthy();
    if (change === 'logout') mockPlatform.pendingLogout = true;
    if (change === 'context') {
      mockPlatform.session = { ...mockPlatform.session!, context: 'native-session-new' };
      mockDemoRequest.mockImplementationOnce(() => new Promise(() => {}));
    }
    if (change === 'school') mockSchoolId = 'thu';
    if (change === 'unfocused') mockFocused = false;
    v.rerender(<StudentCardScreen />);
    expect(v.queryByTestId('demo-student-card-presentation')).toBeNull();
    expect(v.queryByText('DEMO20261112')).toBeNull();
    await act(async () => {});
  },
);

test.each(['demo', 'session'] as const)(
  'expiry of %s authorization hides the demo card and its QR',
  async (expiry) => {
    jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      signInPlatform();
      const demo = accountDemo();
      if (expiry === 'demo') demo.expiresAt = new Date(Date.now() + 2000).toISOString();
      else mockPlatform.session!.expiresAt = Date.now() + 2000;
      mockDemoRequest.mockResolvedValue({ demo });
      const v = render(<StudentCardScreen />);
      await act(async () => {});
      fireEvent.press(v.getByText('出示展示 QR Code'));
      expect(v.getByText('DEMO20261112')).toBeTruthy();
      act(() => jest.advanceTimersByTime(3000));
      expect(v.queryByTestId('demo-student-card-presentation')).toBeNull();
      expect(v.queryByText('DEMO20261112')).toBeNull();
      expect(v.queryByText('展示同學')).toBeNull();
      expect(v.getByText('展示資料已到期')).toBeTruthy();
      v.unmount();
    } finally {
      jest.useRealTimers();
    }
  },
);
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
