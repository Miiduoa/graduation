// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getOfficialCampusMapUrl } from '@campus/shared/src/campusMapLookup';
import { PROVIDENCE_CAMPUS_PLACES } from '@campus/shared/src/providenceCampus';
import {
  campusMapHref, campusMapMatch, formatCampusMapRead, parseCampusMapArguments, parseCampusMapResult,
  type CampusMapRead,
} from './campusMap';

function result(query = '任垣樓501'): CampusMapRead {
  return { version: 1, kind: 'map', schoolId: 'pu', query, limit: 5,
    checkedAt: '2026-11-17T03:00:00.000Z', source: 'school-pois', sourcePath: 'schools/pu/pois',
    status: 'ready', partial: false, resolution: 'matched', href: campusMapHref('pu', query),
    officialMapUrl: getOfficialCampusMapUrl('pu')!,
    items: [{ id: 'renyuan-published', schoolId: 'pu', name: '任垣樓', category: '教學', description: '',
      lat: 24.226415, lng: 120.580067, facilities: [], source: 'school-pois', sourcePath: 'schools/pu/pois',
      href: campusMapHref('pu', query, 'renyuan-published'), match: 'building', verification: 'published' }] };
}
const read = (value: unknown) => parseCampusMapResult(value, 'pu', { query: '任垣樓501', limit: 5 });

describe('map query and source contract', () => {
  it('retains the exact requested classroom without allowing a model to change the bound school or URL', () => {
    expect(parseCampusMapArguments({ query: '  任垣樓501  ' })).toEqual({ query: '任垣樓501', limit: 5 });
    for (const input of [{ query: '任垣樓', schoolId: 'nthu' }, { query: '任垣樓', url: 'https://example.com' },
      { query: '' }, { query: 'a'.repeat(121) }, { query: '任\u202e垣樓' }, { query: '任垣樓', limit: 0 },
      { query: '任垣樓', limit: 6 }, { query: '任垣樓', limit: 1.5 }, { query: '任垣樓', limit: '5' }]) {
      expect(() => parseCampusMapArguments(input)).toThrow('INVALID_INPUT');
    }
  });

  it('preserves published coordinates and distinguishes a building match from a verified room', () => {
    const parsed = read(result());
    expect(parsed.items[0]).toMatchObject({ name: '任垣樓', lat: 24.226415, lng: 120.580067, match: 'building' });
    expect(parsed.items[0]).not.toHaveProperty('floor');
    expect(formatCampusMapRead(parsed)).toContain('只核對到建築，沒有確認房號或從房號推算樓層');
    expect(formatCampusMapRead(parsed)).not.toMatch(/步行約\s*\d|五樓|5F/);
  });

  it.each([
    ['different school', (v: CampusMapRead) => { v.schoolId = 'nthu'; }],
    ['different query', (v: CampusMapRead) => { v.query = '圖書館'; }],
    ['different result limit', (v: CampusMapRead) => { v.limit = 4; }],
    ['wrong collection', (v: CampusMapRead) => { v.sourcePath = 'schools/nthu/pois'; }],
    ['foreign row', (v: CampusMapRead) => { v.items[0].schoolId = 'nthu'; }],
    ['foreign map link', (v: CampusMapRead) => { v.items[0].href = '/map?schoolId=nthu'; }],
    ['invented official URL', (v: CampusMapRead) => { v.officialMapUrl = 'https://example.com'; }],
    ['invented provenance', (v: CampusMapRead) => { v.items[0].sourceUrl = 'https://example.com/poi'; }],
    ['coordinate overflow', (v: CampusMapRead) => { v.items[0].lat = 91; }],
    ['nonfinite coordinate', (v: CampusMapRead) => { v.items[0].lng = Number.NaN; }],
    ['source control character', (v: CampusMapRead) => { v.items[0].name = '任垣樓\u202e'; }],
    ['false exact room', (v: CampusMapRead) => { v.items[0].match = 'place'; }],
    ['duplicate ID', (v: CampusMapRead) => { v.items.push({ ...v.items[0] }); v.resolution = 'ambiguous'; }],
    ['false unique while partial', (v: CampusMapRead) => { v.partial = true; }],
    ['invalid date', (v: CampusMapRead) => { v.checkedAt = '2026-02-30T03:00:00.000Z'; }],
  ])('rejects %s before answer generation', (_name, mutate) => {
    const value = result(); mutate(value);
    expect(() => read(value)).toThrow('INVALID_CAMPUS_MAP_RESULT');
  });

  it('does not turn one fuzzy keyword candidate into a unique destination', () => {
    const value = result('任垣');
    value.items[0].match = 'search'; value.resolution = 'candidates';
    const parsed = parseCampusMapResult(value, 'pu', { query: '任垣', limit: 5 });
    expect(formatCampusMapRead(parsed)).toContain('尚不能確認是你要找的位置');
    expect(() => parseCampusMapResult({ ...value, resolution: 'matched' }, 'pu', { query: '任垣', limit: 5 }))
      .toThrow('INVALID_CAMPUS_MAP_RESULT');
  });

  it('keeps a genuine bundled point tied to its original details, source and coordinates', () => {
    const point = PROVIDENCE_CAMPUS_PLACES.find(place => place.id === 'pu-renyuan')!;
    const value = result('任垣樓');
    value.source = 'bundled-providence'; value.sourcePath = 'bundled/providence-campus';
    value.items = [{ ...point, facilities: [], schoolId: 'pu', source: 'bundled-providence',
      sourcePath: 'bundled/providence-campus', match: 'place', verification: 'cross-checked',
      href: campusMapHref('pu', '任垣樓', point.id) }];
    expect(parseCampusMapResult(value, 'pu', { query: '任垣樓', limit: 5 }).items[0].sourceUrl).toBe(point.sourceUrl);
    for (const mutate of [(v: CampusMapRead) => { v.items[0].floor = '5F'; },
      (v: CampusMapRead) => { v.items[0].lat += 0.00001; },
      (v: CampusMapRead) => { v.items[0].description = '可直接從後門進入'; }]) {
      const changed = structuredClone(value); mutate(changed);
      expect(() => parseCampusMapResult(changed, 'pu', { query: '任垣樓', limit: 5 })).toThrow('INVALID_CAMPUS_MAP_RESULT');
    }
  });

  it('uses the existing school-specific classroom code only for the source it actually identifies', () => {
    const hall = PROVIDENCE_CAMPUS_PLACES.find(place => place.id === 'pu-zhugu')!;
    expect(campusMapMatch('pu', 'PH101', hall)).toBe('building');
    expect(campusMapMatch('nthu', 'PH101', hall)).toBeNull();
    expect(campusMapMatch('pu', 'XX101', hall)).toBeNull();
    expect(campusMapMatch('pu', '主顧樓501', hall)).toBe('building');
  });

  it('does not treat a teaching-looking POI with transit markers as a classroom building', () => {
    const hall = PROVIDENCE_CAMPUS_PLACES.find(place => place.id === 'pu-zhugu')!;
    const spoof = {
      id: 'synthetic-unrecognized-stop',
      name: hall.name,
      category: 'academic',
      description: 'PH303 附近候車',
      lat: hall.lat,
      lng: hall.lng,
      building: '主顧樓',
      transitStopIds: ['unknown-stop-1'],
    };
    const { transitStopIds: _ignored, ...withoutMarkers } = spoof;
    expect(campusMapMatch('pu', 'PH303', spoof)).toBe('search');
    expect(campusMapMatch('pu', 'PH303', withoutMarkers)).toBe('building');
    const value = result('PH303');
    const item = {
      id: spoof.id, schoolId: 'pu', name: spoof.name, category: spoof.category, description: spoof.description,
      lat: spoof.lat, lng: spoof.lng, building: spoof.building, facilities: [],
      source: 'school-pois' as const, sourcePath: 'schools/pu/pois',
      href: campusMapHref('pu', 'PH303', spoof.id), match: 'search' as const, verification: 'published' as const,
      transitStopIds: spoof.transitStopIds,
    };
    value.items = [item];
    value.resolution = 'candidates';
    const parsed = parseCampusMapResult(value, 'pu', { query: 'PH303', limit: 5 });
    expect(parsed.items[0].match).toBe('search');
    expect(parsed.items[0]).toHaveProperty('transitStopIds', ['1']);
    expect(parseCampusMapResult(parsed, 'pu', { query: 'PH303', limit: 5 }).items[0].match).toBe('search');
    const oversized = { ...item, transitStopIds: { nested: 'x'.repeat(10_000), more: Array.from({ length: 5000 }, (_, i) => i) } };
    const bounded = parseCampusMapResult({ ...value, items: [oversized] }, 'pu', { query: 'PH303', limit: 5 });
    expect(bounded.items[0].match).toBe('search');
    expect(bounded.items[0]).toHaveProperty('transitStopIds', ['1']);
    expect(JSON.stringify(bounded.items[0]).length).toBeLessThan(JSON.stringify(oversized).length);
    expect(parseCampusMapResult(bounded, 'pu', { query: 'PH303', limit: 5 }).items[0].match).toBe('search');
    expect(() => parseCampusMapResult({
      ...value,
      items: [{ ...item, match: 'building' }],
      resolution: 'matched',
    }, 'pu', { query: 'PH303', limit: 5 })).toThrow('INVALID_CAMPUS_MAP_RESULT');
  });

  it('keeps partial coverage ahead of candidates and the fact that no route was executed', () => {
    const value = result(); value.partial = true; value.resolution = 'partial';
    const text = formatCampusMapRead(read(value));
    expect(text.indexOf('目前結果不能確認唯一地點')).toBeLessThan(text.indexOf('・任垣樓'));
    expect(text).toContain('尚未建立導航路線或計算到達時間');
  });
});
