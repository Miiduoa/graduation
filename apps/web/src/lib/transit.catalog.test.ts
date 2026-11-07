import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isLegacyCatalogGroup, queryTransit, readSavedStops, type TransitStop } from './transit';

const stop: TransitStop = {
  id: 'TCOD_sample_outbound', name: '靜宜大學', city: 'Taichung', lat: 24.22, lon: 120.58, distance: 80,
  source: 'taichung-open-data', catalogDate: '2026-10-18T04:00:00.000Z',
  routes: [{ name: '310區2', direction: '去', destination: '臺中車站(A月台)' }],
};
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T08:00:00.000Z')); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps catalog metadata through API parsing and favorites while discarding URLs and user position', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    status: 'ready', kind: 'stops', fetchedAt: '2026-10-18T08:00:00.000Z', limited: false,
    stops: [{ ...stop, officialUrl: 'https://untrusted.invalid/', userPosition: { lat: 1, lon: 2 },
      routes: [{ ...stop.routes![0], url: 'https://untrusted.invalid/' }] }],
  })));
  const result = await queryTransit({ action: 'campus', schoolId: 'pu' }, new AbortController().signal);
  expect(result.status === 'ready' && result.kind === 'stops' ? result.stops : []).toEqual([
    stop,
  ]);
  if (result.status !== 'ready' || result.kind !== 'stops') throw new Error('expected stops');
  expect(readSavedStops(JSON.stringify(result.stops))).toEqual([
    { ...stop, distance: null },
  ]);
});

it('distinguishes old campus-group favorites from physical catalog and TDX stops', () => {
  for (const name of ['校門口・往沙鹿', '校門口・往市區', '英才路側', '專用道', '校門口・往校內', '校內', '校門口']) {
    const [favorite] = readSavedStops(JSON.stringify([{ ...stop, name }]));
    expect(isLegacyCatalogGroup(favorite)).toBe(true);
    expect(isLegacyCatalogGroup({ ...favorite, source: undefined })).toBe(false);
  }
  expect(isLegacyCatalogGroup({ ...stop, name: '靜宜大學(專用道)' })).toBe(false);
});

it('reads older favorites with shortened destinations without inventing their original platforms', () => {
  const old = { ...stop, distance: null, routes: [{ name: '300', direction: '去', destination: '台中車站' }] };
  expect(readSavedStops(JSON.stringify([old]))).toEqual([old]);
});

it.each([
  { source: undefined }, { source: 'unknown-provider' }, { catalogDate: undefined },
  { catalogDate: 'invalid' }, { catalogDate: '2026-10-18T08:05:00.001Z' },
  { routes: Array.from({ length: 201 }, () => ({ name: '300', direction: '去', destination: '臺中車站' })) }, { catalogDate: '2026-02-30T04:00:00.000Z' },
  { catalogDate: '2026-10-18T12:00:00+08:00' },
  { routes: [{ name: '', direction: '去', destination: '臺中車站' }] },
  { routes: [{ name: '300', direction: null, destination: '臺中車站' }] },
  { city: 'Taipei' }, { id: 'TXG001' },
])('drops malformed static favorites instead of allowing them to be polled as TDX: %o', (invalid) => {
  const legacy = { id: 'TXG002', name: '臺中車站', city: 'Taichung', lat: 24.2, lon: 120.6, distance: null };
  expect(readSavedStops(JSON.stringify([{ ...stop, ...invalid }, legacy]))).toEqual([legacy]);
});

it('does not invent route metadata when the provider supplies no route or direction', () => {
  expect(readSavedStops(JSON.stringify([{ ...stop, routes: [] }]))[0].routes).toEqual([]);
  expect(readSavedStops(JSON.stringify([{ ...stop, routes: [{ name: '300', direction: '', destination: '' }] }]))[0].routes)
    .toEqual([{ name: '300', direction: '', destination: '' }]);
});

it('allows small source clock skew but rejects a future snapshot beyond five minutes', () => {
  expect(readSavedStops(JSON.stringify([{ ...stop, catalogDate: '2026-10-18T08:05:00.000Z' }]))).toHaveLength(1);
  expect(readSavedStops(JSON.stringify([{ ...stop, catalogDate: '2026-10-18T08:05:00.001Z' }]))).toEqual([]);
});
