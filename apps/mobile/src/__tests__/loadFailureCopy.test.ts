import {
  NETWORK_RETRY_TEXT,
  TEMPORARY_UNAVAILABLE_TEXT,
  loadFailureCopy,
  loadFailureOrLoginCopy,
} from '../utils/loadFailureCopy';
import { getNetworkStatus } from '../services/offline';

jest.mock('../services/offline', () => ({
  getNetworkStatus: jest.fn(() => ({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  })),
}));

beforeEach(() => {
  jest.mocked(getNetworkStatus).mockReturnValue({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  });
});

test('uses the shared network copy only for device offline or fetch-layer failures', () => {
  jest.mocked(getNetworkStatus).mockReturnValue({
    isConnected: false,
    isInternetReachable: false,
    type: 'none',
  });
  expect(loadFailureCopy()).toBe(NETWORK_RETRY_TEXT);
  jest.mocked(getNetworkStatus).mockReturnValue({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  });
  expect(loadFailureCopy(new TypeError('Failed to fetch'))).toBe(NETWORK_RETRY_TEXT);
  expect(loadFailureCopy(new Error('Network request failed'))).toBe(NETWORK_RETRY_TEXT);
  expect(loadFailureCopy(Object.assign(new Error('NETWORK_ERROR'), { code: 'NETWORK_ERROR' }))).toBe(
    NETWORK_RETRY_TEXT,
  );
  expect(
    loadFailureCopy(
      Object.assign(new Error('Failed to get document because the client is offline.'), {
        code: 'unavailable',
      }),
    ),
  ).toBe(NETWORK_RETRY_TEXT);
});

test('does not treat an unread network status as being offline', () => {
  jest.mocked(getNetworkStatus).mockReturnValue({
    isConnected: false,
    isInternetReachable: null,
    type: 'unknown',
  });
  expect(loadFailureCopy(new Error('timed out'))).toBe(TEMPORARY_UNAVAILABLE_TEXT);
});

test('uses the temporary copy for timeouts, server errors and unknown failures', () => {
  expect(loadFailureCopy(new Error('timed out'))).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(
    loadFailureCopy(Object.assign(new Error('internal'), { code: 'functions/internal' })),
  ).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(loadFailureCopy(Object.assign(new Error('offline'), { code: 'unavailable' }))).toBe(
    TEMPORARY_UNAVAILABLE_TEXT,
  );
  expect(loadFailureCopy()).toBe(TEMPORARY_UNAVAILABLE_TEXT);
});

test('keeps the original login prompt when permission is denied or the account is missing', () => {
  const login = '請先登入後再查看這份資料。';
  expect(
    loadFailureOrLoginCopy(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      }),
      login,
    ),
  ).toBe(login);
  expect(loadFailureOrLoginCopy(new Error('missing-account'), login)).toBe(login);
  expect(loadFailureOrLoginCopy(new Error('timed out'), login)).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(loadFailureOrLoginCopy(new TypeError('Failed to fetch'), login)).toBe(NETWORK_RETRY_TEXT);
});
