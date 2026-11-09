import { describe, expect, it } from 'vitest';
import {
  parseProvidenceOsmFootprints,
  parseProvidenceFootprintResponse,
  PROVIDENCE_OSM_BUILDING_WAY_IDS,
} from './providenceFootprints';

const library = [
  { lat: 24.22624, lon: 120.58131 },
  { lat: 24.22624, lon: 120.58143 },
  { lat: 24.22634, lon: 120.58143 },
  { lat: 24.22634, lon: 120.58131 },
  { lat: 24.22624, lon: 120.58131 },
];
const way = (id: number, geometry: unknown = library, tags: unknown = { building: 'yes' }) =>
  ({ type: 'way', id, geometry, tags });

describe('Providence OSM building outlines', () => {
  it('loads only vetted building ways, labels heights honestly and preserves the source URL', () => {
    const result = parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { height: '18 m' }), way(9999999)],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      poiId: 'pu-library', name: '蓋夏圖書館',
      sourceUrl: 'https://www.openstreetmap.org/way/255784049',
      heightMeters: 18, heightBasis: 'osm-tag',
    });
    expect(result[0].outline).toHaveLength(4);
    expect(PROVIDENCE_OSM_BUILDING_WAY_IDS).toContain(255784049);
  });

  it('does not infer a true height from building:levels or an unknown unit', () => {
    const levelsOnly = parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { 'building:levels': '8', height: '50 ft' })],
    });
    expect(levelsOnly[0]).toMatchObject({ heightMeters: 12, heightBasis: 'illustrative' });
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { height: '9999' })],
    })[0].heightBasis).toBe('illustrative');
  });

  it('rejects wrong campus, open ways, degenerate shapes and self-intersections', () => {
    const outside = library.map((p) => ({ lat: p.lat + 1, lon: p.lon }));
    const open = library.slice(0, -1);
    const tiny = library.map((p) => ({ lat: 24.22624 + (p.lat - 24.22624) / 1000,
      lon: 120.58131 + (p.lon - 120.58131) / 1000 }));
    const bowtie = [library[0], library[2], library[1], library[3], library[0]];
    for (const geometry of [outside, open, tiny, bowtie, [{ lat: NaN, lon: 120.58 }]]) {
      expect(parseProvidenceOsmFootprints({ elements: [way(255784049, geometry)] })).toEqual([]);
    }
  });

  it('rejects a self-touching footprint even without strictly crossing edges', () => {
    // A notch ends on the bottom edge. This would falsely extrude a folded building.
    const point = (x: number, y: number) =>
      ({ lat: 24.22624 + y * 0.00001, lon: 120.58131 + x * 0.00001 });
    const touching = [[0, 0], [12, 0], [12, 12], [0, 12],
      [0, 6], [6, 6], [6, 0], [0, 0]].map(([x, y]) => point(x, y));
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, touching)],
    })).toEqual([]);
    const valid = parseProvidenceOsmFootprints({ elements: [way(255784049)] })[0];
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [{
      ...valid, outline: touching.slice(0, -1).map((p) => [p.lon, p.lat]),
    }] })).toEqual([]);
  });

  it('excludes unverified parking and raw nodes, duplicate IDs and excessive payloads', () => {
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049), way(255784049), way(295686299), { type: 'node', id: 255784049, geometry: library }],
    })).toHaveLength(1);
    expect(parseProvidenceOsmFootprints({ elements: Array.from({ length: 129 }, () => way(255784049)) })).toEqual([]);
    expect(parseProvidenceOsmFootprints({ elements: [{ ...way(255784049), geometry: Array(200).fill(library[0]) }] })).toEqual([]);
  });

  it('accepts a server payload only for Providence with matching source, name and geometry', () => {
    const footprint = parseProvidenceOsmFootprints({ elements: [way(255784049)] })[0];
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [footprint] })).toEqual([footprint]);
    expect(parseProvidenceFootprintResponse({ schoolId: 'nthu', buildings: [footprint] })).toEqual([]);
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [
      { ...footprint, sourceUrl: 'https://example.com/pretend' },
      { ...footprint, name: '另一間學校' },
    ] })).toEqual([]);
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [
      { ...footprint, outline: [[120, 24], [121, 24], [121, 25]] },
    ] })).toEqual([]);
  });
});
