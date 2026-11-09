import { describe, expect, it } from 'vitest';
import {
  parseProvidenceOsmFootprints,
  parseProvidenceFootprintResponse,
  parseProvidenceFootprintSnapshot,
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
      elements: [way(255784049, library, { building: 'yes', height: '18 m' }), way(9999999)],
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
      elements: [way(255784049, library, { building: 'yes', 'building:levels': '8', height: '50 ft' })],
    });
    expect(levelsOnly[0]).toMatchObject({ heightMeters: 12, heightBasis: 'illustrative' });
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'yes', height: '9999' })],
    })[0].heightBasis).toBe('illustrative');
  });

  it('does not extrude a retired, roof-only, unfinished or untagged OSM way as a complete building', () => {
    expect(parseProvidenceOsmFootprints({
      elements: [{ ...way(255784049), tags: undefined }],
    })).toEqual([]);
    for (const tags of [
      null, {}, { height: '18' }, { building: 'no' },
      { building: 'construction' }, { building: 'proposed' },
      { building: 'demolished' }, { building: 'roof' }, { building: 'ruins' },
      { building: 'maybe' }, { building: '   ' }, { building: 1 },
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, tags)],
      }), JSON.stringify(tags)).toEqual([]);
    }
    // Do not restrict OSM to one building type; an existing school building is valid.
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'school', height: '18' })],
    })[0]).toMatchObject({ poiId: 'pu-library', heightMeters: 18, heightBasis: 'osm-tag' });
  });

  it('fails closed on contradictory lifecycle tags even when building=yes remains', () => {
    // Edits can leave a historic lifecycle tag alongside an older building=yes.
    // Do not present ambiguous construction/demolition status as a full 3D building.
    for (const lifecycle of [
      'abandoned:building', 'disused:building', 'demolished:building',
      'destroyed:building', 'removed:building', 'razed:building',
      'construction:building', 'proposed:building', 'planned:building',
    ]) {
      const tags = { building: 'yes', [lifecycle]: 'yes' };
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, tags)],
      }), lifecycle).toEqual([]);
    }
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'yes', 'demolished:building': 'house' })],
    })).toEqual([]);
    // Explicit negative lifecycle flags do not override a standing building.
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'yes', 'demolished:building': 'no' })],
    })).toHaveLength(1);
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

  it('refuses a way moved to another campus building even if it remains in campus bounds', () => {
    // The existing source ID does not license attaching the library's name to a distant polygon.
    const displaced = library.map(({ lat, lon }) => ({ lat: lat + 0.0015, lon: lon + 0.0013 }));
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, displaced)],
    })).toEqual([]);

    const known = parseProvidenceOsmFootprints({ elements: [way(255784049)] })[0];
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [{
      ...known, outline: displaced.slice(0, -1).map((p) => [p.lon, p.lat]),
    }] })).toEqual([]);
  });

  it('tolerates a small, declared map-alignment offset without requiring a fabricated entrance', () => {
    const nearby = library.map(({ lat, lon }) => ({ lat: lat + 0.00028, lon }));
    const result = parseProvidenceOsmFootprints({ elements: [way(255784049, nearby)] });
    expect(result).toHaveLength(1);
    expect(result[0].poiId).toBe('pu-library');
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: result })).toEqual(result);
  });

  it('excludes unverified parking and raw nodes, and oversized payloads', () => {
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049), way(295686299), { type: 'node', id: 255784049, geometry: library }],
    })).toHaveLength(1);
    expect(parseProvidenceOsmFootprints({ elements: Array.from({ length: 129 }, () => way(255784049)) })).toEqual([]);
    expect(parseProvidenceOsmFootprints({ elements: [{ ...way(255784049), geometry: Array(200).fill(library[0]) }] })).toEqual([]);
  });

  it('rejects repeated trusted OSM way IDs rather than trusting the first outline', () => {
    const first = way(255784049, library, { building: 'yes', height: '12' });
    const conflicting = way(255784049, library, { building: 'yes', height: '90' });
    expect(parseProvidenceOsmFootprints({ elements: [first, conflicting] })).toEqual([]);
    expect(parseProvidenceOsmFootprints({ elements: [conflicting, first] })).toEqual([]);
    // A duplicate without valid geometry or tags is still an inconsistent way response.
    expect(parseProvidenceOsmFootprints({
      elements: [first, { ...conflicting, tags: {}, geometry: null }],
    })).toEqual([]);
    // Unknown, unverified ways must not interfere with a separately trusted building.
    expect(parseProvidenceOsmFootprints({
      elements: [first, way(295686299), way(295686299)],
    })).toHaveLength(1);
  });

  it('retains a valid way revision but never copies OSM editor account information', () => {
    const wayWithRevision = { ...way(255784049), version: 7,
      timestamp: '2026-10-15T08:09:10Z', user: 'private-editor', uid: 1234, changeset: 9876 };
    const parsed = parseProvidenceOsmFootprints({ elements: [wayWithRevision] });
    expect(parsed[0]).toMatchObject({
      poiId: 'pu-library', osmVersion: 7, osmEditedAt: '2026-10-15T08:09:10Z',
    });
    expect(JSON.stringify(parsed)).not.toContain('private-editor');
    expect(JSON.stringify(parsed)).not.toContain('1234');
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: parsed })).toEqual(parsed);
  });

  it('drops forged revision metadata without dropping valid building geometry', () => {
    const base = parseProvidenceOsmFootprints({ elements: [way(255784049)] })[0];
    const malformed = parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [
      { ...base, osmVersion: -3, osmEditedAt: '2026-02-30T00:00:00Z' },
    ] });
    expect(malformed).toEqual([base]);
    expect(parseProvidenceOsmFootprints({ elements: [
      { ...way(255784049), version: 2, timestamp: 'invalid' },
    ] })).toEqual([base]);
  });

  it('does not label future-dated OSM way edits as verified provenance', () => {
    const base = parseProvidenceOsmFootprints({ elements: [way(255784049)] })[0];
    const stamp = (milliseconds: number) =>
      new Date(Math.floor(milliseconds / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    const reasonableClockSkew = stamp(Date.now() + 4 * 60 * 1000);
    const implausibleFuture = stamp(Date.now() + 6 * 60 * 1000);

    // Overpass geometry may remain usable, but impossible revision metadata must
    // not appear in the selected building's source/details section.
    const accepted = parseProvidenceOsmFootprints({ elements: [
      { ...way(255784049), version: 11, timestamp: reasonableClockSkew },
    ] });
    expect(accepted[0]).toMatchObject({ osmVersion: 11, osmEditedAt: reasonableClockSkew });
    const rejected = parseProvidenceOsmFootprints({ elements: [
      { ...way(255784049), version: 12, timestamp: implausibleFuture },
    ] });
    expect(rejected).toEqual([base]);

    // The browser must also distrust a tampered API timestamp independently.
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [
      { ...base, osmVersion: 99, osmEditedAt: implausibleFuture },
    ] })).toEqual([base]);
  });

  it('rejects inflated illustrative heights from the API instead of drawing fictitious towers', () => {
    const footprint = parseProvidenceOsmFootprints({ elements: [way(255784049)] })[0];
    expect(footprint).toMatchObject({ heightMeters: 12, heightBasis: 'illustrative' });
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [
      { ...footprint, heightMeters: 99, heightBasis: 'illustrative' },
    ] })).toEqual([]);
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [
      { ...footprint, heightMeters: 2.5, heightBasis: 'illustrative' },
    ] })).toEqual([]);
    expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings: [footprint] })).toEqual([footprint]);
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

describe('Providence footprint API snapshot freshness', () => {
  const footprint = parseProvidenceOsmFootprints({
    elements: [way(255784049)],
  })[0];
  const now = Date.parse('2026-11-09T10:00:00.000Z');
  const response = {
    schoolId: 'pu', source: 'OpenStreetMap',
    fetchedAt: '2026-11-09T09:00:00.000Z', stale: false,
    buildings: [footprint],
  };

  it('accepts a dated, source-identified snapshot without changing valid geometry', () => {
    expect(parseProvidenceFootprintSnapshot(response, now)).toEqual({
      buildings: [footprint], fetchedAt: response.fetchedAt, stale: false,
    });
  });

  it('does not call a 25-hour-old snapshot fresh even if a stale cache says otherwise', () => {
    const fetchedAt = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    expect(parseProvidenceFootprintSnapshot({ ...response, fetchedAt }, now)).toEqual({
      buildings: [footprint], fetchedAt, stale: true,
    });
  });

  it('rejects snapshots older than seven days or with future dates beyond clock skew', () => {
    for (const fetchedAt of [
      new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(now + 6 * 60 * 1000).toISOString(),
      '9999-99-99T99:99:99.999Z',
      '2026-11-09',
    ]) {
      expect(parseProvidenceFootprintSnapshot({ ...response, fetchedAt }, now)).toBeNull();
    }
    expect(parseProvidenceFootprintSnapshot({
      ...response, fetchedAt: new Date(now + 4 * 60 * 1000).toISOString(),
    }, now)?.buildings).toEqual([footprint]);
  });

  it('rejects missing or spoofed source and invalid stale status instead of claiming OSM verification', () => {
    for (const input of [
      { ...response, source: 'unknown' },
      { ...response, source: undefined },
      { ...response, stale: 'false' },
      { ...response, stale: undefined },
      { ...response, schoolId: 'other-school' },
      { ...response, buildings: [] },
    ]) {
      expect(parseProvidenceFootprintSnapshot(input, now)).toBeNull();
    }
  });
});
