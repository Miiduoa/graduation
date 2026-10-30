import { afterEach, expect, it, vi } from 'vitest';
import { loadSchoolCreditOverview } from './schoolCreditOverview';
import { PU_ECAMPUS_DATA_PAUSED_CODE, isPuEcampusDataFetchEnabled } from '@campus/shared/src/puEcampusDataPolicy';

const { requester } = vi.hoisted(() => ({ requester: { uid: 'owner', getIdToken: vi.fn() } }));
vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: requester }), isFirebaseConfigured: () => true,
  getCloudFunctionUrl: () => { throw new Error('Paused reads must not choose an endpoint'); },
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('uses the real shipped pause before tokens or requests, without altering the principal', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(isPuEcampusDataFetchEnabled()).toBe(false);
  await expect(loadSchoolCreditOverview('owner', 'pu')).rejects.toMatchObject({
    reason: 'unavailable', cause: { code: PU_ECAMPUS_DATA_PAUSED_CODE },
  });
  expect(requester.getIdToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(requester.uid).toBe('owner');
});

it('still rejects another account without a token or request', async () => {
  await expect(loadSchoolCreditOverview('other', 'pu')).rejects.toMatchObject({ reason: 'reconnect' });
  expect(requester.getIdToken).not.toHaveBeenCalled();
});
