import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlatformLostFoundPending,
  discardPlatformLostFoundPending,
  platformLostFoundPendingKey,
  readPlatformLostFoundPending,
  savePlatformLostFoundPending,
  type PlatformLostFoundPending,
} from './platformLostFoundPending';

const account = 'pa_11111111-1111-4111-8111-111111111111';
const other = 'pa_22222222-2222-4222-8222-222222222222';
const operation: PlatformLostFoundPending = {
  action: 'create',
  input: {
    schoolId: 'pu',
    id: 'plf_11111111-1111-4111-8111-111111111111',
    mutationId: 'intent-11111111',
    fields: {
      type: 'lost',
      title: '黑色雨傘',
      description: '傘柄有貼紙',
      category: 'other',
      location: '圖書館',
      date: '2026-11-07',
      contactInfo: '請聯絡服務台',
    },
  },
};
beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('platform lost-found pending intents', () => {
  it('restores an exact intent without sharing it with another account or campus', () => {
    expect(savePlatformLostFoundPending(account, 'pu', operation)).toEqual(operation);
    expect(readPlatformLostFoundPending(account, 'pu')).toEqual(operation);
    expect(readPlatformLostFoundPending(other, 'pu')).toBeNull();
    expect(readPlatformLostFoundPending(account, 'ncu')).toBeNull();
  });

  it('allows the same retry and refuses to replace an unresolved operation', () => {
    savePlatformLostFoundPending(account, 'pu', operation);
    expect(() => savePlatformLostFoundPending(account, 'pu', operation)).not.toThrow();
    expect(() =>
      savePlatformLostFoundPending(account, 'pu', {
        ...operation,
        input: { ...operation.input, mutationId: 'intent-22222222' },
      }),
    ).toThrow();
    expect(readPlatformLostFoundPending(account, 'pu')).toEqual(operation);
  });

  it('does not let an older receipt clear a different operation', () => {
    savePlatformLostFoundPending(account, 'pu', operation);
    expect(() => clearPlatformLostFoundPending(account, 'pu', 'another-operation')).toThrow();
    expect(readPlatformLostFoundPending(account, 'pu')).toEqual(operation);
    clearPlatformLostFoundPending(account, 'pu', operation.input.mutationId);
    expect(readPlatformLostFoundPending(account, 'pu')).toBeNull();
  });

  it.each(['broken', 'null', '[]', 'x'.repeat(17000)])(
    'blocks damaged metadata without silently overwriting it',
    (raw) => {
      sessionStorage.setItem(platformLostFoundPendingKey(account, 'pu'), raw);
      expect(() => readPlatformLostFoundPending(account, 'pu')).toThrow();
      expect(() => savePlatformLostFoundPending(account, 'pu', operation)).toThrow();
      expect(sessionStorage.getItem(platformLostFoundPendingKey(account, 'pu'))).toBe(raw);
      discardPlatformLostFoundPending(account, 'pu');
      expect(readPlatformLostFoundPending(account, 'pu')).toBeNull();
    },
  );

  it('rejects a stored intent copied across accounts or campuses', () => {
    savePlatformLostFoundPending(account, 'pu', operation);
    const raw = sessionStorage.getItem(platformLostFoundPendingKey(account, 'pu'))!;
    sessionStorage.setItem(platformLostFoundPendingKey(other, 'pu'), raw);
    sessionStorage.setItem(platformLostFoundPendingKey(account, 'ncu'), raw);
    expect(() => readPlatformLostFoundPending(other, 'pu')).toThrow();
    expect(() => readPlatformLostFoundPending(account, 'ncu')).toThrow();
  });

  it.each(['role', 'platformAccountId', 'credential', '__proto__'])(
    'rejects unexpected input fields: %s',
    (field) => {
      const raw = JSON.stringify({
        version: 1,
        accountId: account,
        schoolId: 'pu',
        operation: {
          ...operation,
          input: { ...operation.input, [field]: 'untrusted' },
        },
      });
      sessionStorage.setItem(platformLostFoundPendingKey(account, 'pu'), raw);
      expect(() => readPlatformLostFoundPending(account, 'pu')).toThrow();
    },
  );

  it('requires storage write/readback and deletion confirmation', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    expect(() => savePlatformLostFoundPending(account, 'pu', operation)).toThrow();
    vi.restoreAllMocks();
    savePlatformLostFoundPending(account, 'pu', operation);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
    expect(() =>
      clearPlatformLostFoundPending(account, 'pu', operation.input.mutationId),
    ).toThrow();
  });

  it('keeps legacy drafts untouched', () => {
    sessionStorage.setItem('legacy-lost-found', 'old draft');
    savePlatformLostFoundPending(account, 'pu', operation);
    discardPlatformLostFoundPending(account, 'pu');
    expect(sessionStorage.getItem('legacy-lost-found')).toBe('old draft');
  });
});
