import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { StudentCardNfc, StudentCardReader } from '../components/StudentCardNfc';
import { StudentCardUnavailable, verifyStudentCardCode } from '../services/studentCard';
import {
  getStudentCardNfcCapabilities,
  readStudentCardNfc,
  StudentCardNfcError,
} from '../services/studentCardNfc';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
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
const verificationId = '123e4567-e89b-42d3-a456-426614174000';
const platform = Platform.OS;
const appStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
const available = { moduleAvailable: true, canRead: true, canPresent: true, enabled: true };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.mocked(randomUUID).mockReset().mockReturnValue(verificationId);
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
  Object.defineProperty(AppState, 'currentState', appStateDescriptor);
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
  expect(randomUUID).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(verifyStudentCardCode).toHaveBeenCalledWith(
    token,
    expect.any(AbortSignal),
    verificationId,
  );
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

test('a verification timeout retries with the same ID while an aborted request is still pending', async () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  try {
    let finish!: (value: Awaited<ReturnType<typeof verifyStudentCardCode>>) => void;
    jest.mocked(verifyStudentCardCode).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const v = render(<StudentCardNfc />);
    await act(async () => {});
    await act(async () => fireEvent.press(v.getByText('感應核對')));
    await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
    await act(async () => fireEvent.press(v.getByText('核對這張卡')));
    const firstSignal = jest.mocked(verifyStudentCardCode).mock.calls[0][1];
    await act(async () => jest.advanceTimersByTime(15_001));
    expect(firstSignal.aborted).toBe(true);
    expect(v.getByText('核對尚未完成')).toBeTruthy();
    await act(async () => fireEvent.press(v.getByText('再試一次')));
    expect(verifyStudentCardCode).toHaveBeenCalledTimes(2);
    expect(verifyStudentCardCode).toHaveBeenNthCalledWith(
      2,
      token,
      expect.any(AbortSignal),
      verificationId,
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(v.getByText('學號已核對')).toBeTruthy();
    await act(async () =>
      finish({ schoolName: '舊回應', maskedId: '•••• 9999', verifiedAt: Date.now() }),
    );
    expect(v.queryByText('舊回應')).toBeNull();
    expect(v.getByText('•••• 3141')).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

test('a QR link waits for confirmation and never starts an NFC read', async () => {
  const v = render(<StudentCardReader onClose={jest.fn()} initialToken={token} />);
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  expect(v.getByText('已讀取驗證碼')).toBeTruthy();
  expect(v.queryByText(token)).toBeNull();
  expect(readStudentCardNfc).not.toHaveBeenCalled();
  expect(verifyStudentCardCode).not.toHaveBeenCalled();
  expect(randomUUID).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(verifyStudentCardCode).toHaveBeenCalledWith(
    token,
    expect.any(AbortSignal),
    verificationId,
  );
  expect(v.getByText('學號已核對')).toBeTruthy();
});

test('an unusable QR credential asks for a fresh scan without offering NFC retry', async () => {
  jest
    .mocked(verifyStudentCardCode)
    .mockRejectedValue(new StudentCardUnavailable('這組驗證碼已失效，請對方重新出示。'));
  const close = jest.fn();
  const v = render(<StudentCardReader onClose={close} initialToken={token} />);
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(v.getByText('請重新掃碼')).toBeTruthy();
  expect(v.queryByText('重新感應')).toBeNull();
  expect(v.queryByText('再試一次')).toBeNull();
  fireEvent.press(v.getByText('關閉'));
  expect(close).toHaveBeenCalledTimes(1);
  expect(readStudentCardNfc).not.toHaveBeenCalled();
});

test('an invalid QR token cannot be confirmed or start NFC', async () => {
  const v = render(<StudentCardReader onClose={jest.fn()} initialToken="invalid" />);
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  expect(v.getByText('請重新掃碼')).toBeTruthy();
  expect(v.queryByText('核對這張卡')).toBeNull();
  expect(readStudentCardNfc).not.toHaveBeenCalled();
  expect(verifyStudentCardCode).not.toHaveBeenCalled();
});

test('a temporary server error keeps the token and confirmation ID for a direct retry', async () => {
  jest
    .mocked(verifyStudentCardCode)
    .mockRejectedValueOnce(new StudentCardUnavailable('暫時無法連線核對，請稍後再試。', true));
  const v = render(<StudentCardReader onClose={jest.fn()} initialToken={token} />);
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(v.getByText('核對尚未完成')).toBeTruthy();
  await act(async () => fireEvent.press(v.getByText('再試一次')));
  expect(verifyStudentCardCode).toHaveBeenCalledTimes(2);
  expect(verifyStudentCardCode).toHaveBeenNthCalledWith(
    1,
    token,
    expect.any(AbortSignal),
    verificationId,
  );
  expect(verifyStudentCardCode).toHaveBeenNthCalledWith(
    2,
    token,
    expect.any(AbortSignal),
    verificationId,
  );
  expect(randomUUID).toHaveBeenCalledTimes(1);
  expect(readStudentCardNfc).not.toHaveBeenCalled();
  expect(v.getByText('學號已核對')).toBeTruthy();
});

test('replacing a QR token aborts the old request and starts a new confirmation ID', async () => {
  let finish!: (value: Awaited<ReturnType<typeof verifyStudentCardCode>>) => void;
  jest.mocked(verifyStudentCardCode).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const nextToken = 'r'.repeat(32);
  const nextId = '123e4567-e89b-42d3-a456-426614174001';
  jest.mocked(randomUUID).mockReturnValueOnce(verificationId).mockReturnValueOnce(nextId);
  const close = jest.fn();
  const v = render(<StudentCardReader onClose={close} initialToken={token} />);
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  const firstSignal = jest.mocked(verifyStudentCardCode).mock.calls[0][1];
  v.rerender(<StudentCardReader onClose={close} initialToken={nextToken} />);
  expect(firstSignal.aborted).toBe(true);
  expect(v.getByText('已讀取驗證碼')).toBeTruthy();
  await act(async () =>
    finish({ schoolName: '舊回應', maskedId: '•••• 9999', verifiedAt: Date.now() }),
  );
  expect(v.queryByText('舊回應')).toBeNull();
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(verifyStudentCardCode).toHaveBeenNthCalledWith(
    2,
    nextToken,
    expect.any(AbortSignal),
    nextId,
  );
  expect(randomUUID).toHaveBeenCalledTimes(2);
});

test('a late temporary failure does not extend the original credential deadline', async () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  try {
    jest
      .mocked(verifyStudentCardCode)
      .mockRejectedValueOnce(new StudentCardUnavailable('暫時無法連線核對，請稍後再試。', true));
    const v = render(<StudentCardReader onClose={jest.fn()} initialToken={token} />);
    act(() => jest.advanceTimersByTime(50_000));
    await act(async () => fireEvent.press(v.getByText('核對這張卡')));
    expect(v.getByText('再試一次')).toBeTruthy();
    act(() => jest.advanceTimersByTime(10_001));
    expect(v.getByText('這張憑證已到期，請對方重新出示，再掃描新的 QR Code。')).toBeTruthy();
    expect(v.queryByText('再試一次')).toBeNull();
    expect(verifyStudentCardCode).toHaveBeenCalledTimes(1);
    expect(readStudentCardNfc).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('credential expiry aborts a pending verification and ignores its late receipt', async () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  try {
    let finish!: (value: Awaited<ReturnType<typeof verifyStudentCardCode>>) => void;
    jest.mocked(verifyStudentCardCode).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const v = render(<StudentCardReader onClose={jest.fn()} />);
    await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
    act(() => jest.advanceTimersByTime(55_000));
    await act(async () => fireEvent.press(v.getByText('核對這張卡')));
    const signal = jest.mocked(verifyStudentCardCode).mock.calls[0][1];
    act(() => jest.advanceTimersByTime(5_001));
    expect(signal.aborted).toBe(true);
    expect(v.getByText('這張憑證已到期，請對方重新出示後再感應。')).toBeTruthy();
    await act(async () =>
      finish({ schoolName: '靜宜大學', maskedId: '•••• 3141', verifiedAt: Date.now() }),
    );
    expect(v.queryByText('學號已核對')).toBeNull();
    expect(v.queryByText('核對這張卡')).toBeNull();
    await act(async () => fireEvent.press(v.getByText('重新感應')));
    expect(readStudentCardNfc).toHaveBeenCalledTimes(2);
    expect(v.getByText('核對這張卡')).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

test('a QR link received earlier only gets its remaining confirmation time', () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  try {
    const v = render(
      <StudentCardReader
        onClose={jest.fn()}
        initialToken={token}
        initialExpiresAt={Date.now() + 5_000}
      />,
    );
    expect(v.getByText('核對這張卡')).toBeTruthy();
    act(() => jest.advanceTimersByTime(5_001));
    expect(v.getByText('請重新掃碼')).toBeTruthy();
    expect(v.queryByText('核對這張卡')).toBeNull();
    expect(verifyStudentCardCode).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('the link owner can clear its expired token without closing a later receipt or starting NFC', async () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  try {
    const close = jest.fn();
    const expiresAt = Date.now() + 60_000;
    const v = render(
      <StudentCardReader onClose={close} initialToken={token} initialExpiresAt={expiresAt} />,
    );
    await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
    act(() => jest.advanceTimersByTime(50_000));
    jest.mocked(verifyStudentCardCode).mockResolvedValue({
      schoolName: '靜宜大學',
      maskedId: '•••• 3141',
      verifiedAt: Date.now(),
    });
    await act(async () => fireEvent.press(v.getByText('核對這張卡')));
    act(() => jest.advanceTimersByTime(10_001));
    v.rerender(<StudentCardReader onClose={close} initialExpiresAt={expiresAt} />);
    expect(v.getByText('學號已核對')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    expect(readStudentCardNfc).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(50_000));
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('an idempotent receipt keeps its original display deadline', async () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  try {
    jest.mocked(verifyStudentCardCode).mockResolvedValue({
      schoolName: '靜宜大學',
      maskedId: '•••• 3141',
      verifiedAt: Date.now() - 50_000,
    });
    const close = jest.fn();
    const v = render(<StudentCardReader onClose={close} initialToken={token} />);
    await act(async () => fireEvent.press(v.getByText('核對這張卡')));
    expect(v.getByText('學號已核對')).toBeTruthy();
    act(() => jest.advanceTimersByTime(9_999));
    expect(close).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(2));
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('accessibility escape aborts verification and ignores a late receipt', async () => {
  let finish!: (value: Awaited<ReturnType<typeof verifyStudentCardCode>>) => void;
  jest.mocked(verifyStudentCardCode).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const close = jest.fn();
  const v = render(<StudentCardReader onClose={close} initialToken={token} />);
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  const signal = jest.mocked(verifyStudentCardCode).mock.calls[0][1];
  fireEvent(v.getByText('正在核對學號'), 'accessibilityEscape');
  expect(signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent(v.getByText('正在核對學號'), 'accessibilityEscape');
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () =>
    finish({ schoolName: '靜宜大學', maskedId: '•••• 3141', verifiedAt: Date.now() }),
  );
  expect(v.queryByText('學號已核對')).toBeNull();
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});

test('iOS announces each error and success once without repeating on a parent render', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest
    .mocked(verifyStudentCardCode)
    .mockRejectedValueOnce(new StudentCardUnavailable('暫時無法連線核對，請稍後再試。', true));
  const close = jest.fn();
  const v = render(<StudentCardReader onClose={close} initialToken={token} />);
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith(
    '核對尚未完成。暫時無法連線核對，請稍後再試。',
  );
  v.rerender(<StudentCardReader onClose={close} initialToken={token} />);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(v.getByText('再試一次')));
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(2);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith(
    '學號已核對。請與對方卡面上的學校及學號末四碼比對。',
  );
  v.rerender(<StudentCardReader onClose={close} initialToken={token} />);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(2);
});

test('an iOS result waits for the foreground and cannot announce after dismissal', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'inactive' });
  let changed!: (value: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') changed = listener as typeof changed;
    return { remove: jest.fn() };
  });
  const close = jest.fn();
  const v = render(<StudentCardReader onClose={close} initialToken={token} />);
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  fireEvent.press(v.getByText('完成核對'));
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  act(() => changed('active'));
  expect(close).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});

test('iOS announces a waiting result once when the app becomes active again', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'inactive' });
  let changed!: (value: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') changed = listener as typeof changed;
    return { remove: jest.fn() };
  });
  const v = render(<StudentCardReader onClose={jest.fn()} initialToken={token} />);
  await act(async () => fireEvent(v.getByTestId('student-card-nfc-reader'), 'show'));
  await act(async () => fireEvent.press(v.getByText('核對這張卡')));
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  act(() => changed('active'));
  act(() => changed('active'));
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
});
