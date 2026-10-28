import { clearOwnedPuCampusSessions } from '../../services/clearOwnedPuCampusSessions';

const mockCurrentUser = { getIdToken: jest.fn() };
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockCurrentUser }),
  hasUsableFirebaseConfig: () => true,
}));
jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: (name: string) => `https://functions.test/${name}`,
  canUseHostedSchoolFallback: () => false,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser.getIdToken.mockResolvedValue('id-token');
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ result: { success: true, deleted: 1 } }),
  }) as jest.Mock;
});

test('asks the server to delete the signed-in campus sessions before local logout', async () => {
  await clearOwnedPuCampusSessions();
  expect(global.fetch).toHaveBeenCalledWith(
    'https://functions.test/clearPuCampusSessions',
    expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer id-token',
      },
      body: JSON.stringify({ data: {} }),
    }),
  );
});
