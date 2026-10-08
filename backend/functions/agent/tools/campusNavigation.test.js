'use strict';

const mockDocuments = new Map();
const mockReads = [];
function mockRef(path, constraints = []) {
  return {
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    where: (...args) => mockRef(path, [...constraints, ['where', ...args]]),
    limit: (count) => mockRef(path, [...constraints, ['limit', count]]),
    get: async () => {
      mockReads.push({ path, constraints });
      const rows = mockDocuments.get(path) || [];
      if (rows instanceof Error) throw rows;
      const limit = constraints.find(([type]) => type === 'limit')?.[1];
      const visible = typeof limit === 'number' ? rows.slice(0, limit) : rows;
      return { empty: visible.length === 0, docs: visible.map(({ id, ...data }) => ({ id, data: () => data })) };
    },
  };
}
const mockDb = { collection: (name) => mockRef(name) };
jest.mock('firebase-admin/firestore', () => ({ getFirestore: () => mockDb }));
const findCampusPoi = require('./findCampusPoi');
const planCampusRoute = require('./planCampusRoute');
const listCafeterias = require('./listCafeterias');
const { buildCardsFromToolTrace } = require('../cardBuilders');
const { callAssistantModelWithTools } = require('../../assistantAgent');
const originalEnv = { ...process.env };
const points = (schoolId) => [
  { id: 'gate', schoolId, name: '正式校門', lat: 24.1, lng: 120.1, category: 'gate' },
  { id: 'library', schoolId, name: '正式圖書館', lat: 24.2, lng: 120.2, category: 'library' },
];
const routeInput = { fromPoiId: 'gate', toPoiId: 'library' };
beforeEach(() => { mockDocuments.clear(); mockReads.length = 0; });
afterEach(() => { process.env = { ...originalEnv }; });

test('a non-PU cafeteria with a static PU identifier never receives fabricated PU fields', async () => {
  mockDocuments.set('schools/nthu/cafeterias', [{ id: 'jingyuan', name: '正式餐廳', openingHours: '平日 11:00–14:00' }]);
  const result = await listCafeterias.execute({ schoolId: 'nthu' }, {});
  expect(result).toMatchObject({ success: true, schoolId: 'nthu', cafeterias: [{
    id: 'jingyuan', name: '正式餐廳', schoolId: 'nthu', openingHours: '平日 11:00–14:00',
    lat: null, lng: null, openTime: null, closeTime: null, openNow: null,
    orderingEnabled: false, seats: null, menuPreviewCount: null,
  }] });
  expect(mockReads.map(({ path }) => path)).toEqual(['schools/nthu/cafeterias']);
  expect(buildCardsFromToolTrace([{ name: 'listCafeterias', output: result }])[0].payload)
    .toEqual({ schoolId: 'nthu', cafeterias: result.cafeterias });
});

test('unknown opening status is unavailable instead of declaring cafeterias open or all closed', async () => {
  mockDocuments.set('schools/nthu/cafeterias', [{ id: 'jingyuan', name: '正式餐廳', orderingEnabled: true, openNow: true }]);
  expect(await listCafeterias.execute({ schoolId: 'nthu' }, { onlyOpenNow: true }))
    .toMatchObject({ success: false, errorCode: 'opening_status_unavailable' });
});

test('cafeterias preserve only valid source coordinates, hours and counts', async () => {
  mockDocuments.set('schools/nthu/cafeterias', [
    { id: 'one', schoolId: 'nthu', name: '餐廳一', lat: 24.8, lng: 121, openTime: '11:00', closeTime: '14:00', seats: 32, orderingEnabled: true },
    { id: 'two', name: '餐廳二', lat: '24.8', lng: 121, openTime: '99:00', seats: -1, menuPreviewCount: 1.5 },
  ]);
  const result = await listCafeterias.execute({ schoolId: 'nthu' }, {});
  expect(result.cafeterias[0]).toMatchObject({ lat: 24.8, lng: 121, openTime: '11:00', closeTime: '14:00', seats: 32, orderingEnabled: true });
  expect(result.cafeterias[1]).toMatchObject({ lat: null, lng: null, openTime: null, seats: null, menuPreviewCount: null, orderingEnabled: false });
});

test('cafeteria scope errors and failed reads never appear as an empty school', async () => {
  expect(await listCafeterias.execute({}, {})).toMatchObject({ success: false, errorCode: 'missing_school' });
  expect(mockReads).toHaveLength(0);
  mockDocuments.set('schools/nthu/cafeterias', [{ id: 'jingyuan', schoolId: 'pu', name: '別校餐廳' }]);
  expect(await listCafeterias.execute({ schoolId: 'nthu' }, {})).toMatchObject({ success: false, errorCode: 'read_failed' });
  mockDocuments.set('schools/nthu/cafeterias', new Error('offline'));
  expect(await listCafeterias.execute({ schoolId: 'nthu' }, {})).toMatchObject({ success: false, errorCode: 'read_failed' });
});

test('only a confirmed empty cafeteria collection returns an empty result', async () => {
  expect(await listCafeterias.execute({ schoolId: 'nthu' }, { onlyOpenNow: true }))
    .toEqual({ success: true, schoolId: 'nthu', count: 0, cafeterias: [] });
});

test('finds only current-school source records and never invents hours or live status', async () => {
  mockDocuments.set('schools/nthu/pois', points('nthu'));
  const found = await findCampusPoi.execute({ schoolId: 'nthu' }, { query: '圖書館' });
  expect(found).toMatchObject({ success: true, schoolId: 'nthu', pois: [{ id: 'library', schoolId: 'nthu', name: '正式圖書館', openTime: null, closeTime: null, openNow: null }] });
  expect(mockReads.map(({ path }) => path)).toEqual(['schools/nthu/pois']);
});

test('creates a Google walking URL from real coordinates without a synthetic distance, ETA or polyline', async () => {
  mockDocuments.set('schools/nthu/pois', points('nthu'));
  const result = await planCampusRoute.execute({ schoolId: 'nthu' }, routeInput);
  expect(result.success).toBe(true);
  const url = new URL(result.navigationUrl);
  expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
  expect(Object.fromEntries(url.searchParams)).toEqual({ api: '1', origin: '24.1,120.1', destination: '24.2,120.2', travelmode: 'walking' });
  for (const field of ['distanceMeters', 'walkMinutes', 'polyline', 'steps']) expect(result).not.toHaveProperty(field);
  expect(buildCardsFromToolTrace([{ name: 'planCampusRoute', output: result }])).toEqual([
    { kind: 'directions_card', payload: { schoolId: 'nthu', from: result.from, to: result.to, navigationUrl: result.navigationUrl } },
  ]);
});

test('unknown locations never resolve to the static PU dataset', async () => {
  mockDocuments.set('schools/nthu/pois', points('nthu'));
  expect(await planCampusRoute.execute({ schoolId: 'nthu' }, { fromPoiId: 'pu-gate-main', toPoiId: 'pu-library' })).toMatchObject({ success: false, errorCode: 'from_not_found' });
  expect(await findCampusPoi.execute({ schoolId: 'nthu' }, { query: '蓋夏' })).toMatchObject({ success: true, count: 0 });
});

test('legacy fallback requires confirmed canonical emptiness and filters by school', async () => {
  mockDocuments.set('pois', points('nthu'));
  expect(await planCampusRoute.execute({ schoolId: 'nthu' }, routeInput)).toMatchObject({ success: true });
  expect(mockReads).toEqual([
    { path: 'schools/nthu/pois', constraints: [] },
    { path: 'pois', constraints: [['where', 'schoolId', '==', 'nthu']] },
  ]);
});

test('failed or inconsistent canonical reads do not use legacy/static data', async () => {
  mockDocuments.set('schools/nthu/pois', new Error('offline'));
  mockDocuments.set('pois', points('nthu'));
  expect(await planCampusRoute.execute({ schoolId: 'nthu' }, routeInput)).toMatchObject({ success: false, errorCode: 'read_failed' });
  expect(mockReads).toHaveLength(1);
  mockDocuments.set('schools/nthu/pois', points('pu'));
  expect(await findCampusPoi.execute({ schoolId: 'nthu' }, { query: '圖書館' })).toMatchObject({ success: false });
});

test.each([undefined, NaN, 91, '24.1'])('does not invent missing or invalid latitude %p', async (lat) => {
  const rows = points('pu'); rows[0].lat = lat;
  mockDocuments.set('schools/pu/pois', rows);
  expect(await planCampusRoute.execute({ schoolId: 'pu' }, routeInput)).toMatchObject({ success: false, errorCode: 'coordinates_unavailable' });
});

test('ambiguous names require a choice instead of silently selecting the first source record', async () => {
  mockDocuments.set('schools/pu/pois', [...points('pu'), { id: 'side', schoolId: 'pu', name: '第二校門', lat: 24.3, lng: 120.3 }]);
  expect(await planCampusRoute.execute({ schoolId: 'pu' }, { fromQuery: '校門', toQuery: '圖書館' })).toMatchObject({ success: false, errorCode: 'ambiguous_location' });
  expect(await planCampusRoute.execute({ schoolId: 'pu' }, { fromQuery: '正式校門', toQuery: '正式圖書館' })).toMatchObject({ success: true });
});

test('missing school returns unavailable without any database read', async () => {
  expect(await findCampusPoi.execute({}, { query: '圖書館' })).toMatchObject({ success: false, errorCode: 'missing_school' });
  expect(await planCampusRoute.execute({}, routeInput)).toMatchObject({ success: false, errorCode: 'missing_school' });
  expect(mockReads).toEqual([]);
});

test('a valid destination beyond the first 100 records remains searchable and navigable', async () => {
  const rows = [...points('pu'), ...Array.from({ length: 120 }, (_, index) => ({
    id: `place-${index}`, schoolId: 'pu', name: `正式設施 ${index}`, lat: 24.3, lng: 120.3,
  }))];
  mockDocuments.set('schools/pu/pois', rows);
  const found = await findCampusPoi.execute({ schoolId: 'pu' }, { query: '正式設施 119' });
  expect(found.success).toBe(true);
  expect(found.pois[0].id).toBe('place-119');
  expect(await planCampusRoute.execute({ schoolId: 'pu' }, { fromPoiId: 'gate', toPoiId: 'place-119' })).toMatchObject({ success: true, to: expect.objectContaining({ id: 'place-119' }) });
});

test('the real model tool loop executes the scoped reader and produces the directions card', async () => {
  process.env.GROQ_API_KEY = 'navigation-test-key';
  process.env.GROQ_MODEL = 'navigation-test-model';
  mockDocuments.set('schools/pu/pois', points('pu'));
  const reply = (message) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message }] }) });
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce(reply({ content: '', tool_calls: [{ id: 'route', type: 'function', function: { name: 'planCampusRoute', arguments: JSON.stringify(routeInput) } }] }))
    .mockResolvedValueOnce(reply({ content: '請開啟 Google 地圖查看步行路線。' }));
  const result = await callAssistantModelWithTools({
    messages: [{ role: 'user', content: '從校門走到圖書館' }],
    toolCtx: { schoolId: 'pu' }, providerOrder: ['groq'], fetchImpl,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(result.toolsInvoked).toEqual(['planCampusRoute']);
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0].kind).toBe('directions_card');
  expect(result.cards[0].payload.navigationUrl).toContain('https://www.google.com/maps/dir/');
  expect(mockReads.map(({ path }) => path)).toEqual(['schools/pu/pois']);
});
