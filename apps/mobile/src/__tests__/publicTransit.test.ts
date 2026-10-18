import {
  BUS_CITIES,
  primaryBusCity,
  publicArrivalLabel,
  queryPublicTransit,
  type PublicBusArrival,
} from '../features/publicTransit';

const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; });

const now = () => new Date().toISOString();
function reply(body: unknown, ok = true) {
  jest.mocked(global.fetch).mockResolvedValueOnce({
    ok, json: async () => body,
  } as Response);
}

test('selects the primary school city without treating unknown campuses as Taichung', () => {
  expect(primaryBusCity('nthu')).toBe('Hsinchu');
  expect(primaryBusCity('ncku')).toBe('Tainan');
  expect(primaryBusCity('ntpu')).toBe('NewTaipei');
  expect(primaryBusCity('tw-nchu')).toBe('Taichung');
  expect(primaryBusCity('nycu')).toBeNull();
  expect(primaryBusCity('external-university')).toBeNull();
  expect(Object.keys(BUS_CITIES)).toHaveLength(22);
});

test('uses a public server gateway without shipping TDX credentials from mobile', async () => {
  reply({ status: 'ready', kind: 'stops', fetchedAt: now(), limited: false, stops: [
    { id: 'HSZ123', name: '清華大學', city: 'Hsinchu', lat: 24.79, lon: 120.99, distance: null },
  ] });
  const result = await queryPublicTransit({ action: 'search', city: 'Hsinchu', text: '清華大學' });
  expect(result).toMatchObject({ status: 'ready', kind: 'stops', stops: [
    { id: 'HSZ123', city: 'Hsinchu', name: '清華大學' },
  ] });
  const [url, init] = jest.mocked(global.fetch).mock.calls[0];
  expect(url).toBe('https://nuni.tw/api/transit');
  expect(init?.method).toBe('POST');
  expect(init?.credentials).toBe('omit');
  expect(JSON.parse(String(init?.body))).toEqual({
    action: 'search', city: 'Hsinchu', text: '清華大學',
  });
  expect(JSON.stringify(init)).not.toMatch(/client_secret|client_id|TDX_CLIENT/);
});

test('rejects spoofed school stops and malformed provider responses instead of showing fake places', async () => {
  reply({ status: 'ready', kind: 'stops', fetchedAt: now(), limited: false, stops: [
    { id: 'ONE', name: '本地站牌', city: 'Hsinchu', lat: 24.8, lon: 120.9 },
    { id: 'FAKE', name: '另一城市', city: 'Taichung', lat: 24, lon: 120 },
    { id: 'WRONG', name: '', city: 'Hsinchu', lat: 24, lon: 120 },
    { id: 'ONE', name: '重複站牌', city: 'Hsinchu', lat: 24.8, lon: 120.9 },
    { id: 'INVALID', name: '無效座標', city: 'Hsinchu', lat: 200, lon: 120 },
  ] });
  const result = await queryPublicTransit({ action: 'search', city: 'Hsinchu', text: '站牌' });
  expect(result).toMatchObject({ status: 'ready', kind: 'stops', stops: [{ id: 'ONE' }] });
});

test('retains validated static route metadata without treating its snapshot as live arrivals', async () => {
  const catalog = {
    id: 'TCOD_static001', name: '靜宜大學', city: 'Taichung', lat: 24.23, lon: 120.57, distance: null,
    source: 'taichung-open-data', catalogDate: '2026-01-01T00:00:00.000Z',
    routes: [{ name: '300', direction: '去', destination: '臺中車站' }],
  };
  reply({ status: 'ready', kind: 'stops', fetchedAt: now(), limited: false, stops: [catalog] });
  expect(await queryPublicTransit({ action: 'search', city: 'Taichung', text: '靜宜' })).toMatchObject({
    status: 'ready', kind: 'stops', stops: [catalog],
  });
});

test('rejects inconsistent catalog identity and metadata instead of downgrading static stops to TDX', async () => {
  const catalog = {
    id: 'TCOD_static001', name: '靜宜大學', city: 'Taichung', lat: 24.23, lon: 120.57,
    source: 'taichung-open-data', catalogDate: '2026-01-01T00:00:00.000Z',
    routes: [{ name: '300', direction: '去', destination: '臺中車站' }],
  };
  reply({ status: 'ready', kind: 'stops', fetchedAt: now(), limited: false, stops: [
    { ...catalog, id: 'TCOD_no_source', source: undefined },
    { ...catalog, id: 'TDX_WRONG_NAMESPACE' },
    { ...catalog, id: 'TCOD_wrong_source', source: 'unverified-provider' },
    { ...catalog, id: 'TCOD_wrong_date', catalogDate: 'not-a-date' },
    { ...catalog, id: 'TCOD_invalid_calendar_date', catalogDate: '2026-02-31T00:00:00.000Z' },
    { ...catalog, id: 'TCOD_future_date', catalogDate: '2999-01-01T00:00:00.000Z' },
    { ...catalog, id: 'TCOD_wrong_routes', routes: [{ name: '300', direction: '去' }] },
    { ...catalog, id: 'TCOD_wrong_routes_type', routes: null },
    { ...catalog, id: 'TCOD_other_city', city: 'Taipei' },
    catalog,
  ] });
  const result = await queryPublicTransit({ action: 'search', city: 'Taichung', text: '靜宜' });
  expect(result).toMatchObject({ status: 'ready', kind: 'stops', stops: [{ id: catalog.id }] });
});

test('retains missing catalog route fields as empty values without inventing destinations', async () => {
  reply({ status: 'ready', kind: 'stops', fetchedAt: now(), limited: false, stops: [{
    id: 'TCOD_incomplete_route', name: '靜宜大學', city: 'Taichung', lat: 24.23, lon: 120.57,
    source: 'taichung-open-data', catalogDate: '2026-01-01T00:00:00Z',
    routes: [{ name: '300', direction: '', destination: '' }],
  }] });
  expect(await queryPublicTransit({ action: 'search', city: 'Taichung', text: '靜宜' })).toMatchObject({
    status: 'ready', kind: 'stops', stops: [{ routes: [{ name: '300', direction: '', destination: '' }] }],
  });
});

test('invalid city, station name and location never issue a network request', async () => {
  expect(await queryPublicTransit({ action: 'search', city: 'Hsinchu', text: 'A' })).toMatchObject({
    status: 'unavailable', reason: 'invalid-query',
  });
  expect(await queryPublicTransit({
    action: 'nearby', city: 'Hsinchu', lat: NaN, lon: 120.9, radius: 600,
  })).toMatchObject({ status: 'unavailable', reason: 'invalid-query' });
  expect(await queryPublicTransit({
    action: 'arrivals', city: 'Hsinchu', stopId: '../pu',
  })).toMatchObject({ status: 'unavailable', reason: 'invalid-query' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('does not claim a live arrival from expired or incomplete TDX data', async () => {
  const stale: PublicBusArrival = {
    id: 'one', route: '300', direction: 0, destination: '', status: 0,
    seconds: 60, updatedAt: new Date(Date.now() - 120000).toISOString(),
  };
  expect(publicArrivalLabel(stale)).toBe('資料待更新');
  expect(publicArrivalLabel({ ...stale, updatedAt: now(), seconds: 500 })).toBe('約 9 分鐘');
  expect(publicArrivalLabel({ ...stale, updatedAt: now(), status: 3 })).toBe('末班車已駛離');
  expect(publicArrivalLabel({ ...stale, updatedAt: null })).toBe('資料待更新');
  reply({ status: 'ready', kind: 'arrivals', fetchedAt: now(), arrivals: [
    { ...stale, updatedAt: now() },
    { ...stale, id: 'invalid', route: '', updatedAt: now() },
  ] });
  const result = await queryPublicTransit({ action: 'arrivals', city: 'Taichung', stopId: 'TXG001' });
  expect(result).toMatchObject({ status: 'ready', kind: 'arrivals', arrivals: [{ id: 'one' }] });
});

test('an unconfigured provider or network failure never becomes a fictional successful lookup', async () => {
  reply({ status: 'unavailable', reason: 'not-configured' }, false);
  expect(await queryPublicTransit({ action: 'search', city: 'Hsinchu', text: '清華' })).toEqual({
    status: 'unavailable', reason: 'not-configured',
  });
  jest.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'));
  expect(await queryPublicTransit({ action: 'search', city: 'Hsinchu', text: '清華' })).toEqual({
    status: 'unavailable', reason: 'network',
  });
});


test('a stalled public data request times out rather than leaving the native page spinning', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(global.fetch).mockImplementationOnce(
      (_url, options) => new Promise((_resolve, reject) => {
        (options?.signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );
    const pending = queryPublicTransit({ action: 'search', city: 'Hsinchu', text: '清華大學' });
    jest.advanceTimersByTime(12_000);
    await expect(pending).resolves.toMatchObject({ status: 'unavailable', reason: 'network' });
  } finally {
    jest.useRealTimers();
  }
});
