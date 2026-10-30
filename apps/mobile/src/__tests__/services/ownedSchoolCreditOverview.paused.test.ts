import { loadOwnedSchoolCreditOverview } from '../../services/ownedSchoolCreditOverview';
import { isPuEcampusDataFetchEnabled, PU_ECAMPUS_DATA_PAUSED_MESSAGE } from '@campus/shared/src/puEcampusDataPolicy';

const mockRequester = { uid: 'owner', getIdToken: jest.fn() };
jest.mock('../../firebase', () => ({ getAuthInstance: () => ({ currentUser: mockRequester }) }));
jest.mock('../../services/cloudFunctions', () => ({
  getSchoolCreditOverviewUrl: () => { throw new Error('Paused reads must not choose an endpoint'); },
}));
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

test('the real shipped policy stops before tokens and even an old hosted deployment', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  expect(isPuEcampusDataFetchEnabled()).toBe(false);
  await expect(loadOwnedSchoolCreditOverview('owner')).rejects.toMatchObject({
    reason: 'paused', message: PU_ECAMPUS_DATA_PAUSED_MESSAGE,
  });
  expect(mockRequester.getIdToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(mockRequester.uid).toBe('owner');
});

test('another principal is still rejected without requesting a token', async () => {
  await expect(loadOwnedSchoolCreditOverview('other')).rejects.toMatchObject({ reason: 'reconnect' });
  expect(mockRequester.getIdToken).not.toHaveBeenCalled();
});
