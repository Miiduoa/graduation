import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CLEAR_CAMPUS_SESSIONS_TIMEOUT_MS,
  clearOwnedPuCampusSessions,
} from './clearOwnedPuCampusSessions';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: async () => ({ result: { success: true, deleted: 1 } }) });
});

afterEach(() => {
  vi.useRealTimers();
});

it('posts the hosted callable with the current account token', async () => {
  const user = { getIdToken: vi.fn().mockResolvedValue('id-token') };
  await clearOwnedPuCampusSessions(user);
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/clearPuCampusSessions', expect.objectContaining({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer id-token',
    },
    body: JSON.stringify({ data: {} }),
    cache: 'no-store',
  }));
  expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

it('skips when no signed-in account is present', async () => {
  await clearOwnedPuCampusSessions(null);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('continues after 5 seconds if the campus session clear hangs', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  );
  const pending = clearOwnedPuCampusSessions({ getIdToken: vi.fn().mockResolvedValue('id-token') });
  await vi.advanceTimersByTimeAsync(CLEAR_CAMPUS_SESSIONS_TIMEOUT_MS - 1);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(settled).toBe(true);
});
