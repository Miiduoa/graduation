import { expect, it } from 'vitest';
import {
  NETWORK_RETRY_TEXT,
  TEMPORARY_UNAVAILABLE_TEXT,
  isNetworkLayerError,
  isNetworkUnavailable,
  loadFailureCopy,
} from '@campus/shared/src/loadFailureCopy';

it('blames the network only when the device is offline or fetch fails at the network layer', () => {
  expect(loadFailureCopy(undefined, { online: false })).toBe(NETWORK_RETRY_TEXT);
  expect(isNetworkUnavailable(undefined, { online: false })).toBe(true);
  expect(isNetworkLayerError(new TypeError('Failed to fetch'))).toBe(true);
  expect(loadFailureCopy(new TypeError('Failed to fetch'))).toBe(NETWORK_RETRY_TEXT);
  expect(loadFailureCopy(new Error('Network request failed'))).toBe(NETWORK_RETRY_TEXT);
  expect(
    loadFailureCopy(
      Object.assign(new Error('Failed to get document because the client is offline.'), {
        code: 'unavailable',
      }),
    ),
  ).toBe(NETWORK_RETRY_TEXT);
  expect(
    loadFailureCopy(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })),
  ).toBe(NETWORK_RETRY_TEXT);
});

it('uses the temporary copy for timeouts, server errors and permission failures', () => {
  expect(loadFailureCopy(new Error('timed out'))).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(loadFailureCopy(new Error('Timeout'))).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(
    loadFailureCopy(
      Object.assign(new Error('deadline exceeded'), { code: 'functions/deadline-exceeded' }),
    ),
  ).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(
    loadFailureCopy(Object.assign(new Error('internal'), { code: 'functions/internal' })),
  ).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(
    loadFailureCopy(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      }),
    ),
  ).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(loadFailureCopy(Object.assign(new Error('offline'), { code: 'unavailable' }))).toBe(
    TEMPORARY_UNAVAILABLE_TEXT,
  );
  expect(loadFailureCopy()).toBe(TEMPORARY_UNAVAILABLE_TEXT);
  expect(loadFailureCopy(undefined, { online: true })).toBe(TEMPORARY_UNAVAILABLE_TEXT);
});
