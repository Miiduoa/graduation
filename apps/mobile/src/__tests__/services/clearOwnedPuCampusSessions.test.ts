import {
  CLEAR_CAMPUS_SESSIONS_TIMEOUT_MS,
  clearOwnedPuCampusSessions,
} from '../../services/clearOwnedPuCampusSessions';

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
  jest.useRealTimers();
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
  expect((global.fetch as jest.Mock).mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

test('continues after 5 seconds if the campus session clear hangs', async () => {
  jest.useFakeTimers();
  (global.fetch as jest.Mock).mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  );
  const pending = clearOwnedPuCampusSessions();
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await jest.advanceTimersByTimeAsync(CLEAR_CAMPUS_SESSIONS_TIMEOUT_MS - 1);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await pending;
  expect(settled).toBe(true);
});
