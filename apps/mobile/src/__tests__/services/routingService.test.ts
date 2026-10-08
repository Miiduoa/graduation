import { getFootRoute, planRoutes } from '../../services/routingService';

const from = { lat: 24.226, lng: 120.563 };
const to = { lat: 24.137, lng: 120.686 };
const route = {
  distance: 1200,
  duration: 360,
  geometry: {
    coordinates: [
      [120.563, 24.226],
      [120.686, 24.137],
    ],
  },
  legs: [
    {
      steps: [
        {
          distance: 1200,
          duration: 360,
          name: '道路',
          maneuver: { type: 'depart' },
          geometry: { coordinates: [] },
        },
      ],
    },
  ],
};
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('a failed walking provider never retries with driving routes', async () => {
  jest.mocked(fetch).mockRejectedValue(new Error('offline'));
  expect(await getFootRoute(from, to)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(jest.mocked(fetch).mock.calls[0][0]).toContain('routed-foot');
});

test('failed walking and cycling responses yield only the actual driving route', async () => {
  jest.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes('routed-foot') || String(url).includes('routed-bike')) {
      return { ok: false, status: 503 } as Response;
    }
    return { ok: true, json: async () => ({ code: 'Ok', routes: [route] }) } as Response;
  });
  const results = await planRoutes(from, to);
  expect(results.map((r) => r.mode)).toEqual(['driving']);
  expect(
    jest
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes('router.project-osrm.org')),
  ).toHaveLength(1);
  expect(results[0].totalDuration).toBe(360);
  expect(results[0]).not.toHaveProperty('congestionScore');
  expect(results[0].summary).not.toMatch(/壅塞|順暢/);
});

test('each provider keeps its own distance and duration without fabricated transit estimates', async () => {
  jest.mocked(fetch).mockImplementation(
    async (url) =>
      ({
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [{ ...route, duration: String(url).includes('routed-foot') ? 1200 : 360 }],
        }),
      }) as Response,
  );
  const results = await planRoutes(from, to);
  expect(results.map((r) => r.mode).sort()).toEqual(['cycling', 'driving', 'walking']);
  expect(results.find((r) => r.mode === 'walking')?.totalDuration).toBe(1200);
  expect(results.every((r) => r.totalDistance === 1200)).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(3);
});
