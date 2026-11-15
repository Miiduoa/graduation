import { describe, expect, it } from 'vitest';
import { parseProvidenceOsmFootprints } from './providenceFootprints';

// Synthetic geometry near the existing audited library POI; not a campus survey.
const geometry = [
  { lat: 24.22624, lon: 120.58131 },
  { lat: 24.22624, lon: 120.58143 },
  { lat: 24.22634, lon: 120.58143 },
  { lat: 24.22634, lon: 120.58131 },
  { lat: 24.22624, lon: 120.58131 },
];

function parse(tags: Record<string, unknown>) {
  return parseProvidenceOsmFootprints({
    elements: [{ type: 'way', id: 255784049, geometry, tags }],
  });
}

describe('OSM storeys and condition cannot certify an intact campus 3D volume', () => {
  it('keeps valid above-ground storeys illustrative, never converts levels into metres', () => {
    for (const count of ['1', '8', '100', ' 8 ']) {
      expect(parse({ building: 'yes', 'building:levels': count }), count).toMatchObject([
        { poiId: 'pu-library', heightBasis: 'illustrative', heightMeters: 12 },
      ]);
    }
    expect(parse({ building: 'yes' })).toHaveLength(1);
    expect(parse({ building: 'yes', 'building:levels': '8', height: '18 m' })).toMatchObject([
      { heightBasis: 'osm-tag', heightMeters: 18 },
    ]);
  });

  it('rejects zero, underground-only, composite, malformed and implausible storey tags', () => {
    for (const count of [
      '0', '-1', '0.5', '3;4', '2,3', '101', '', 'unknown', null, 8, true,
    ]) {
      expect(parse({ building: 'yes', 'building:levels': count }), String(count)).toEqual([]);
      // A separate tagged height does not make contradictory floors trustworthy.
      expect(parse({ building: 'yes', 'building:levels': count, height: '18 m' }), String(count))
        .toEqual([]);
    }
  });

  it('does not draw intact walls when the OSM condition describes ruins or is ambiguous', () => {
    for (const condition of [
      'ruinous', 'partly_ruinous', 'mainly_ruinous', 'completely_ruinous',
      'recognizable_remains', 'good;ruinous', 'average', 'poor', '',
      null, 3, true,
    ]) {
      expect(parse({ building: 'yes', 'building:condition': condition, height: '18 m' }),
        String(condition)).toEqual([]);
    }
  });

  it('preserves explicit intact and restored conditions and untagged buildings', () => {
    for (const condition of ['good', 'preserved', 'renovated', 'reconstructed', ' GOOD ']) {
      expect(parse({ building: 'school', 'building:condition': condition }), condition)
        .toMatchObject([{ poiId: 'pu-library', heightBasis: 'illustrative', heightMeters: 12 }]);
    }
    expect(parse({ building: 'yes', 'building:condition': undefined })).toHaveLength(1);
  });
});
