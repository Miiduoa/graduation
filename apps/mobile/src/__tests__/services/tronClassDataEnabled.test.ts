/** @jest-environment node */

// hoisted: 須在 jest.mock 工廠執行前被宣告。
// eslint-disable-next-line no-var
var mockExpoConfig: { extra: Record<string, unknown> };

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

import {
  isTronClassBackendMutation,
  isTronClassDataFetchEnabled,
  isTronClassPuHostedUrl,
  tronClassBackendReadWhenDisabled,
} from '../../services/tronClassDataEnabled';

describe('tronClassDataEnabled', () => {
  beforeEach(() => {
    mockExpoConfig.extra = {};
  });

  test('isTronClassDataFetchEnabled defaults to true when extra omits flag', () => {
    expect(isTronClassDataFetchEnabled()).toBe(true);
  });

  test('isTronClassDataFetchEnabled is false when extra.tronClassDataEnabled is false', () => {
    mockExpoConfig.extra = { tronClassDataEnabled: false };
    expect(isTronClassDataFetchEnabled()).toBe(false);
  });

  test('isTronClassDataFetchEnabled is true when extra.tronClassDataEnabled is true', () => {
    mockExpoConfig.extra = { tronClassDataEnabled: true };
    expect(isTronClassDataFetchEnabled()).toBe(true);
  });

  test('tronClassBackendReadWhenDisabled returns null for single-object reads', () => {
    expect(tronClassBackendReadWhenDisabled('profile')).toBeNull();
    expect(tronClassBackendReadWhenDisabled('selfScore')).toBeNull();
  });

  test('tronClassBackendReadWhenDisabled returns [] for list reads', () => {
    expect(tronClassBackendReadWhenDisabled('courses')).toEqual([]);
    expect(tronClassBackendReadWhenDisabled('discussions')).toEqual([]);
  });

  test('isTronClassBackendMutation recognizes write operations', () => {
    expect(isTronClassBackendMutation('postDiscussion')).toBe(true);
    expect(isTronClassBackendMutation('courses')).toBe(false);
  });

  test('isTronClassPuHostedUrl detects PU TronClass host', () => {
    expect(isTronClassPuHostedUrl('')).toBe(false);
    expect(isTronClassPuHostedUrl('https://example.com')).toBe(false);
    expect(isTronClassPuHostedUrl('https://tronclass.pu.edu.tw/course/1')).toBe(true);
    expect(isTronClassPuHostedUrl('HTTPS://TRONCLASS.PU.EDU.TW/x')).toBe(true);
    expect(isTronClassPuHostedUrl('file:///tronclass.pu.edu.tw')).toBe(true);
  });
});
