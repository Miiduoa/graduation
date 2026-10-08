import { httpsCallable } from 'firebase/functions';
import { getDocsFromServer, collection, query, where } from 'firebase/firestore';
import {
  loadBusArrivals,
  loadBusRoutes,
  normalizeBusArrivals,
  normalizeBusRoutes,
} from '../../features/campusBus';

jest.mock('../../firebase', () => ({
  getDb: () => 'db',
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => false,
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...args) => args.slice(1).join('/')),
  query: jest.fn((...args) => args),
  where: jest.fn((...args) => args),
  getDocsFromServer: jest.fn(),
}));
const now = Date.parse('2026-10-08T01:00:00Z');
const realtime = (overrides = {}) => ({
  source: 'tdx',
  isRealtime: true,
  fetchedAt: new Date(now - 1000).toISOString(),
  arrivals: [{ stopId: 'stop', routeName: '300', estimatedArrival: 480, status: 0, direction: 0 }],
  ...overrides,
});
beforeEach(() => jest.clearAllMocks());

it.each([
  { source: 'static', isRealtime: false },
  { source: undefined },
  { isRealtime: undefined },
  { noApiKey: true },
  { error: 'TDX unavailable' },
  { fetchedAt: undefined },
  { fetchedAt: new Date(now - 90_000).toISOString() },
  { fetchedAt: new Date(now + 90_000).toISOString() },
])('never displays fallback or unverifiable arrivals as realtime: %j', (overrides) => {
  expect(normalizeBusArrivals(realtime(overrides), 'stop', now)).toEqual({
    status: 'unavailable',
    arrivals: [],
    fetchedAt: null,
  });
});

it('shows a fresh verified estimate while respecting its stop and service status', () => {
  const data = realtime({
    arrivals: [
      { stopId: 'stop', routeName: '300', estimatedArrival: 480, status: 0, direction: 0 },
      { stopId: 'stop', routeName: '301', estimatedArrival: 480, status: 3, direction: 1 },
      { stopId: 'another', routeName: '302', estimatedArrival: 20, status: 0 },
      { stopId: 'stop', routeName: '303', estimatedArrival: '480', status: 0 },
    ],
  });
  expect(normalizeBusArrivals(data, 'stop', now)).toMatchObject({
    status: 'ready',
    arrivals: [
      { routeName: '300', label: '約 8 分鐘', direction: '去程' },
      { routeName: '301', label: '末班車已駛離', direction: '返程' },
      { routeName: '303', label: '暫無到站預估' },
    ],
  });
});

it('requires usable station identifiers and omits demo or foreign-school routes', () => {
  const route = {
    id: 'real',
    name: '300',
    isActive: true,
    schoolId: 'pu',
    stops: [
      { id: 'two', name: '第二站', order: 2 },
      { id: 'one', name: '第一站', order: 1 },
    ],
  };
  expect(
    normalizeBusRoutes(
      [
        route,
        { ...route, id: 'demo', isDemo: true },
        { ...route, id: 'foreign', schoolId: 'other' },
        { ...route, id: 'no-id', stops: [{ name: '沒有站牌代碼' }] },
      ],
      'pu',
    ),
  ).toEqual([
    {
      id: 'real',
      name: '300',
      description: '',
      city: 'Taichung',
      stops: [
        { id: 'one', name: '第一站', order: 1 },
        { id: 'two', name: '第二站', order: 2 },
      ],
    },
  ]);
});

it('keeps arrival failures distinct from an empty successful service response', async () => {
  const call = jest.fn().mockRejectedValue(new Error('offline'));
  jest.mocked(httpsCallable).mockReturnValue(call as never);
  const input = { schoolId: 'pu', stopId: 'stop', city: 'Taichung' };
  expect(await loadBusArrivals(input)).toEqual({ status: 'error', arrivals: [], fetchedAt: null });
  expect(call).toHaveBeenCalledWith(input);
  call.mockResolvedValue({
    data: { ...realtime(), fetchedAt: new Date().toISOString(), arrivals: [] },
  });
  expect(await loadBusArrivals(input)).toMatchObject({ status: 'ready', arrivals: [] });
});

it('propagates route loading failure instead of substituting example routes', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(loadBusRoutes('pu')).rejects.toThrow('offline');
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'busRoutes');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});

function snapshot(rows: Record<string, unknown>[]) {
  return {
    empty: !rows.length,
    docs: rows.map((row, i) => ({ id: `route-${i}`, data: () => row })),
  } as Awaited<ReturnType<typeof getDocsFromServer>>;
}
it('falls back only after confirmed canonical emptiness and enforces the school filter', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot([]))
    .mockResolvedValueOnce(
      snapshot([{ name: '300', isActive: true, stops: [{ id: 'stop', name: '校門' }] }]),
    );
  expect(await loadBusRoutes('pu')).toMatchObject([{ id: 'route-0', name: '300' }]);
  expect(where).toHaveBeenCalledWith('schoolId', '==', 'pu');
  expect(query).toHaveBeenCalledWith('busRoutes', ['schoolId', '==', 'pu']);
});
it('does not query a malformed school path', async () => {
  await expect(loadBusRoutes('../pu')).rejects.toThrow();
  expect(getDocsFromServer).not.toHaveBeenCalled();
});
