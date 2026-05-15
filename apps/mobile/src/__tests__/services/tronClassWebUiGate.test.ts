/** @jest-environment node */

let mockExpoConfig: { extra: Record<string, unknown> };

jest.mock('expo-constants', () => {
  mockExpoConfig = { extra: {} };
  return {
    __esModule: true,
    default: {
      get expoConfig() {
        return mockExpoConfig;
      },
    },
  };
});

const mockCanOpenURL = jest.fn().mockResolvedValue(true);
const mockOpenURL = jest.fn().mockResolvedValue(undefined);

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  Linking: {
    canOpenURL: (...args: unknown[]) => mockCanOpenURL(...args),
    openURL: (...args: unknown[]) => mockOpenURL(...args),
  },
}));

const mockOpenBrowserAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}));

import {
  linkingOpenWithPuTronClassGate,
  webBrowserOpenWithPuTronClassGate,
  webViewShouldAllowRequestUrl,
} from '../../services/tronClassWebUiGate';

describe('tronClassWebUiGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExpoConfig.extra = {};
  });

  test('linkingOpenWithPuTronClassGate does not call Linking for whitespace-only url', async () => {
    await expect(linkingOpenWithPuTronClassGate(' \t ')).resolves.toBe(false);
    expect(mockCanOpenURL).not.toHaveBeenCalled();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  test('webBrowserOpenWithPuTronClassGate skips open when LMS disabled', async () => {
    mockExpoConfig.extra = { tronClassDataEnabled: false };
    await expect(webBrowserOpenWithPuTronClassGate('https://tronclass.pu.edu.tw/x')).resolves.toBe(
      false,
    );
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });

  test('webBrowserOpenWithPuTronClassGate opens when LMS enabled', async () => {
    mockExpoConfig.extra = { tronClassDataEnabled: true };
    await expect(webBrowserOpenWithPuTronClassGate('https://tronclass.pu.edu.tw/x')).resolves.toBe(
      true,
    );
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://tronclass.pu.edu.tw/x');
  });

  test('webViewShouldAllowRequestUrl blocks TronClass when LMS disabled', () => {
    mockExpoConfig.extra = { tronClassDataEnabled: false };
    expect(webViewShouldAllowRequestUrl('https://tronclass.pu.edu.tw/course/1')).toBe(false);
  });

  test('webViewShouldAllowRequestUrl allows TronClass when LMS enabled', () => {
    mockExpoConfig.extra = { tronClassDataEnabled: true };
    expect(webViewShouldAllowRequestUrl('https://tronclass.pu.edu.tw/course/1')).toBe(true);
  });

  test('webViewShouldAllowRequestUrl allows other hosts when LMS disabled', () => {
    mockExpoConfig.extra = { tronClassDataEnabled: false };
    expect(webViewShouldAllowRequestUrl('https://www.google.com/')).toBe(true);
  });
});
