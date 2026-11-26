import { vi } from 'vitest';

export const directoryStorageFailures = ['blocked', 'quota', 'write exception', 'read exception'] as const;

export function rejectDirectoryStorage(failure: (typeof directoryStorageFailures)[number]) {
  if (failure === 'blocked') {
    return vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
  }
  return vi.spyOn(Storage.prototype, failure === 'read exception' ? 'getItem' : 'setItem')
    .mockImplementation(() => {
      if (failure === 'quota') throw new DOMException('Storage full', 'QuotaExceededError');
      throw new Error('Storage unavailable');
    });
}
