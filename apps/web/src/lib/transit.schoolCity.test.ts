import { expect, it } from 'vitest';
import { CAMPUS_TRANSIT, CAMPUS_TRANSIT_PUBLIC, preferredTransitCity } from './transit';

it('uses Tainan for NCKU and New Taipei for NTPU Sanxia without mixing cities', () => {
  expect(preferredTransitCity('ncku')).toBe('Tainan');
  expect(preferredTransitCity('ntpu')).toBe('NewTaipei');
  expect(preferredTransitCity('pu')).toBe('Taichung');
  expect(CAMPUS_TRANSIT.ncku).toEqual({ city: 'Tainan', stopName: '成大' });
  expect(CAMPUS_TRANSIT.ntpu).toEqual({ city: 'NewTaipei', stopName: '臺北大學' });
  expect(CAMPUS_TRANSIT.ncku.city).not.toBe(CAMPUS_TRANSIT.ntpu.city);
});

it('keeps campus search names as substrings of verified TDX stop names with sources', () => {
  for (const schoolId of ['ncku', 'ntpu'] as const) {
    const row = CAMPUS_TRANSIT_PUBLIC[schoolId];
    expect(CAMPUS_TRANSIT[schoolId]).toEqual({ city: row.city, stopName: row.stopName });
    expect(row.stops.every((name) => name.includes(row.stopName))).toBe(true);
    expect(row.routes.every((route) => route.name && route.routeUID)).toBe(true);
    expect(row.sources.every((source) => source.url.startsWith('https://'))).toBe(true);
  }
  expect(CAMPUS_TRANSIT_PUBLIC.ncku.stops).toEqual([
    '成大自強校區',
    '成大光復校區',
    '成大醫院(勝利路)',
    '成大醫院(小東路)',
  ]);
  expect(CAMPUS_TRANSIT_PUBLIC.ncku.routes.map((route) => route.routeUID)).toEqual([
    'TNN10450',
    'TNN10451',
    'TNN1077',
  ]);
  expect(CAMPUS_TRANSIT_PUBLIC.ntpu.stops).toEqual([
    '臺北大學正門',
    '臺北大學宿舍',
    '捷運臺北大學站(復興大勇路口)',
  ]);
  expect(CAMPUS_TRANSIT_PUBLIC.ntpu.routes).toEqual([
    { name: '851', routeUID: 'NWT16665', routeId: '0400085100' },
  ]);
  expect('國立臺北大學'.includes(CAMPUS_TRANSIT.ntpu.stopName)).toBe(true);
  expect('臺北大學正門'.includes('國立臺北大學')).toBe(false);
  expect('成大自強校區'.includes('成功大學')).toBe(false);
});
