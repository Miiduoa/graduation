import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import { StudentCardNfc } from '../components/StudentCardNfc';
import { StudentCardUnavailable, verifyStudentCardCode } from '../services/studentCard';
import {
  getStudentCardNfcCapabilities,
  readStudentCardNfc,
  StudentCardNfcError,
} from '../services/studentCardNfc';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/studentCard', () => ({
  ...jest.requireActual('../services/studentCard'),
  verifyStudentCardCode: jest.fn(),
}));
jest.mock('../services/studentCardNfc', () => ({
  ...jest.requireActual('../services/studentCardNfc'),
  getStudentCardNfcCapabilities: jest.fn(),
  readStudentCardNfc: jest.fn(),
}));

const token = 'n'.repeat(32);
const platform = Platform.OS;
const available = { moduleAvailable: true, canRead: true, canPresent: true, enabled: true };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue(available);
  jest.mocked(readStudentCardNfc).mockResolvedValue(token);
  jest.mocked(verifyStudentCardCode).mockResolvedValue({
    schoolName: '靜宜大學',
    maskedId: '•••• 3141',
    verifiedAt: Date.now(),
  });
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('offers the two supported Android operations without starting a session automatically', async () => {
  const present = jest.fn();
  const v = render(<StudentCardNfc onPresent={present} />);
  await act(async () => {});
  expect(v.getByText('已就緒')).toBeTruthy();
  fireEvent.press(v.getByText('感應出示'));
  expect(present).toHaveBeenCalledTimes(1);
  expect(v.getByText('感應核對')).toBeTruthy();
  expect(readStudentCardNfc).not.toHaveBeenCalled();
});

test('iPhone capabilities expose reading without offering unsupported presentation', async () => {
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue({ ...available, canPresent: false });
  const v = render(<StudentCardNfc onPresent={jest.fn()} />);
  await act(async () => {});
  expect(v.queryByText('感應出示')).toBeNull();
  expect(v.getByText('感應核對')).toBeTruthy();
});

test('a build without the native module gives an accurate availability message', async () => {
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue({
    moduleAvailable: false,
    canRead: false,
    canPresent: false,
    enabled: false,
  });
  const v = render(<StudentCardNfc />);
  await act(async () => {});
  expect(v.getByText('安裝支援 NFC 的 App 版本，即可使用感應核對。')).toBeTruthy();
  expect(v.queryByText('感應核對')).toBeNull();
});

test('a capability failure can be retried without an unhandled rejection', async () => {
  jest.mocked(getStudentCardNfcCapabilities).mockRejectedValueOnce(new Error('native unavailable'));
  const v = render(<StudentCardNfc />);
  await act(async () => {});
  expect(v.getByText('暫時無法確認 NFC 狀態，請再試一次。')).toBeTruthy();
  await act(async () => fireEvent.press(v.getByText('重新確認 NFC')));
  expect(v.getByText('感應核對')).toBeTruthy();
});

test('reading waits for the native modal to be shown', async () => {
  const v = render(<StudentCardNfc />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應核對')));
  expect(readStudentCardNfc).not.toHaveBeenCalled();
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  expect(readStudentCardNfc).toHaveBeenCalledTimes(1);
});

test('disabled NFC leads to Android NFC settings and updates when returning', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue({ ...available, enabled: false });
  const settings = jest.spyOn(Linking, 'sendIntent').mockResolvedValue(undefined);
  let changed!: (value: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') changed = listener as typeof changed;
    return { remove: jest.fn() };
  });
  const v = render(<StudentCardNfc />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('開啟 NFC 設定')));
  expect(settings).toHaveBeenCalledWith('android.settings.NFC_SETTINGS');
  jest.mocked(getStudentCardNfcCapabilities).mockResolvedValue(available);
  await act(async () => changed('active'));
  expect(v.queryByText('開啟 NFC 設定')).toBeNull();
  expect(v.getByText('感應核對')).toBeTruthy();
});

test('reading requires explicit confirmation and only a server receipt can show success', async () => {
  const v = render(<StudentCardNfc />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應核對')));
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  expect(v.getByText('已讀取感應憑證')).toBeTruthy();
  expect(v.queryByText(token)).toBeNull();
  expect(v.queryByText('學號已核對')).toBeNull();
  expect(verifyStudentCardCode).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(verifyStudentCardCode).toHaveBeenCalledWith(token, expect.any(AbortSignal));
  expect(v.getByText('學號已核對')).toBeTruthy();
  expect(v.getByText('靜宜大學')).toBeTruthy();
  expect(v.getByText('•••• 3141')).toBeTruthy();
  fireEvent.press(v.getByText('完成核對'));
  expect(v.queryByText('•••• 3141')).toBeNull();
});

test('an expired or already redeemed token asks for another presentation', async () => {
  jest
    .mocked(verifyStudentCardCode)
    .mockRejectedValue(new StudentCardUnavailable('憑證已失效，請對方重新出示。'));
  const v = render(<StudentCardNfc />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應核對')));
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(v.queryByText('學號已核對')).toBeNull();
  expect(v.getByText('憑證已失效，請對方重新出示。')).toBeTruthy();
  await act(async () => fireEvent.press(v.getByText('重新感應')));
  expect(readStudentCardNfc).toHaveBeenCalledTimes(2);
  expect(verifyStudentCardCode).toHaveBeenCalledTimes(1);
});

test('native user cancellation dismisses the reader without an error result', async () => {
  jest
    .mocked(readStudentCardNfc)
    .mockRejectedValue(new StudentCardNfcError('CANCELLED', '已取消感應。'));
  const v = render(<StudentCardNfc />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應核對')));
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  expect(v.queryByText('取消核對')).toBeNull();
  expect(v.queryByText('已取消感應。')).toBeNull();
  expect(verifyStudentCardCode).not.toHaveBeenCalled();
});

test('backgrounding aborts a pending read and ignores a late native result', async () => {
  let finish!: (value: string) => void;
  jest.mocked(readStudentCardNfc).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let changed!: (value: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') changed = listener as typeof changed;
    return { remove: jest.fn() };
  });
  const v = render(<StudentCardNfc />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應核對')));
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  const signal = jest.mocked(readStudentCardNfc).mock.calls[0][0]!;
  act(() => changed('inactive'));
  expect(signal.aborted).toBe(false);
  act(() => changed('background'));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(token));
  expect(v.queryByText('核對這張卡')).toBeNull();
  expect(verifyStudentCardCode).not.toHaveBeenCalled();
});

test('closing during verification aborts the request and never renders a late receipt', async () => {
  let finish!: (value: Awaited<ReturnType<typeof verifyStudentCardCode>>) => void;
  jest.mocked(verifyStudentCardCode).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const v = render(<StudentCardNfc />);
  await act(async () => {});
  await act(async () => fireEvent.press(v.getByText('感應核對')));
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  const signal = jest.mocked(verifyStudentCardCode).mock.calls[0][1];
  fireEvent.press(v.getByText('取消核對'));
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish({ schoolName: '靜宜大學', maskedId: '•••• 3141', verifiedAt: Date.now() }),
  );
  expect(v.queryByText('學號已核對')).toBeNull();
});

test('a verified receipt automatically clears after one minute', async () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  try {
    const v = render(<StudentCardNfc />);
    await act(async () => {});
    await act(async () => fireEvent.press(v.getByText('感應核對')));
    await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
    await act(async () => fireEvent.press(v.getByText('核對這張卡')));
    expect(v.getByText('學號已核對')).toBeTruthy();
    act(() => jest.advanceTimersByTime(60_001));
    expect(v.queryByText('學號已核對')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('a verification timeout can retry the same token after the aborted request settles', async () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  try {
    jest.mocked(verifyStudentCardCode).mockImplementationOnce(
      (_token, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const v = render(<StudentCardNfc />);
    await act(async () => {});
    await act(async () => fireEvent.press(v.getByText('感應核對')));
    await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
    await act(async () => fireEvent.press(v.getByText('核對這張卡')));
    await act(async () => jest.advanceTimersByTime(15_001));
    expect(v.getByText('核對尚未完成')).toBeTruthy();
    await act(async () => fireEvent.press(v.getByText('再試一次')));
    expect(verifyStudentCardCode).toHaveBeenCalledTimes(2);
    expect(v.getByText('學號已核對')).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});
