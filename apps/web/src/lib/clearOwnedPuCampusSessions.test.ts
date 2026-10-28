import { beforeEach, expect, it, vi } from 'vitest';
import { clearOwnedPuCampusSessions } from './clearOwnedPuCampusSessions';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: async () => ({ result: { success: true, deleted: 1 } }) });
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
});

it('skips when no signed-in account is present', async () => {
  await clearOwnedPuCampusSessions(null);
  expect(fetchMock).not.toHaveBeenCalled();
});
