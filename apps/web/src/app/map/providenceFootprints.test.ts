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

  it('uses an illustrative height only when height is absent, never for an explicit unknown unit', () => {
    const levelsOnly = parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'yes', 'building:levels': '8' })],
    });
    expect(levelsOnly[0]).toMatchObject({ heightMeters: 12, heightBasis: 'illustrative' });
    for (const height of ['50 ft', '9999', '', '   ', null, 18]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'yes', 'building:levels': '8', height })],
      }), JSON.stringify(height)).toEqual([]);
    }
  });

  it('keeps explicit metric OSM heights beyond two decimal places instead of inventing 12 m', () => {
    // Height values are OSM contributions, not official elevation measurements.
    // A precise decimal in metres remains an explicit tag even without a space
    // before the unit; it must not turn into a 12 m illustrative building.
    for (const height of ['18.125', '18.125 m', '18.125m', '18.125000 m']) {
      const parsed = parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'school', height })],
      });
      expect(parsed, height).toHaveLength(1);
      expect(parsed[0], height).toMatchObject({
        heightMeters: 18.125, heightBasis: 'osm-tag',
      });
      expect(parseProvidenceFootprintResponse({
        schoolId: 'pu', buildings: parsed,
      })).toEqual(parsed);
    }
    // Do not interpret non-metric values, ranges or out-of-bound measurements.
    for (const height of ['18,125 m', '18-20 m', '59 ft', '2.499 m', '100.001 m']) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'yes', height })],
      }), height).toEqual([]);
    }
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

  it('does not present unprefixed lifecycle markers as an intact campus building', () => {
    // OSM supports both lifecycle prefixes and direct flags. A way can retain
    // building=yes after demolition, ruin, abandonment or reconstruction.
    for (const key of [
      'abandoned', 'disused', 'demolished', 'destroyed', 'removed',
      'razed', 'ruins', 'ruined', 'construction', 'proposed', 'planned',
      'ruins:building', 'ruined:building',
    ]) {
      for (const value of ['yes', 'house']) {
        expect(parseProvidenceOsmFootprints({
          elements: [way(255784049, library, { building: 'yes', [key]: value })],
        }), `${key}=${value}`).toEqual([]);
      }
    }
    // Explicit negative values do not cause an otherwise verified way to vanish.
    for (const value of ['no', 'false', '0']) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, {
          building: 'school', abandoned: value, ruins: value, 'ruins:building': value,
        })],
      }), value).toHaveLength(1);
    }
    // Unexpected flag formats do not silently certify a complete building.
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'yes', demolished: true })],
    })).toEqual([]);
    for (const building of ['collapsed', 'abandoned', 'disused', 'derelict', 'ruined']) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building })],
      }), building).toEqual([]);
    }
  });

  it('fails closed on empty or null lifecycle flags instead of treating them as an explicit no', () => {
    // Missing tags are normal. Present-but-blank OSM values are not evidence
    // that a formerly demolished/ruined/unfinished building is intact.
    for (const key of [
      'ruins', 'demolished', 'construction', 'abandoned',
      'ruins:building', 'demolished:building', 'proposed:building',
    ]) {
      for (const value of ['', '  ', null]) {
        expect(parseProvidenceOsmFootprints({
          elements: [way(255784049, library, { building: 'yes', [key]: value })],
        }), `${key}=${String(value)}`).toEqual([]);
      }
    }
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'yes' })],
    })).toHaveLength(1);
  });

  it('does not mistake an OSM building part for a surveyed complete school building', () => {
    // building:part can coexist with building=yes while describing only one
    // section of a building. Its area/height cannot become a full ground-up
    // campus volume until the complete 3D parts model is verified.
    for (const marker of ['yes', 'school', 'roof', '', '  ', null, true]) {
      const buildings = parseProvidenceOsmFootprints({
        elements: [way(255784049, library, {
          building: 'yes', 'building:part': marker, height: '18 m',
        })],
      });
      expect(buildings, `building:part=${String(marker)}`).toEqual([]);
    }
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'part', height: '18 m' })],
    })).toEqual([]);
    // Explicit negative tags are not evidence of a part; do not exclude
    // an otherwise audited whole-building way simply because of them.
    for (const marker of ['no', 'false', '0']) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, {
          building: 'school', 'building:part': marker, height: '18 m',
        })],
      }), marker).toMatchObject([{ poiId: 'pu-library', heightMeters: 18 }]);
    }
    // A separate ordinary way is unaffected by the rejected part.
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'yes' })],
    })).toHaveLength(1);
  });

  it('does not invent ground-level walls for elevated OSM building parts', () => {
    // Height is top elevation, not proof that the building begins at ground.
    // Until we model a verified base elevation, an elevated footprint is not
    // a trustworthy full ground-to-roof solid.
    for (const offsetTags of [
      { min_height: '5' },
      { min_height: '10 m' },
      { min_height: 'unknown' },
      { 'building:min_level': '2' },
      { 'building:min_level': 'bad data' },
    ]) {
      const buildings = parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'yes', height: '18 m', ...offsetTags })],
      });
      expect(buildings, JSON.stringify(offsetTags)).toEqual([]);
    }
    // Explicit zero offsets still allow an ordinary ground-standing volume.
    for (const offsetTags of [
      { min_height: '0' },
      { min_height: '0 m' },
      { min_height: '0.0 m', 'building:min_level': '0' },
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'yes', height: '18 m', ...offsetTags })],
      }), JSON.stringify(offsetTags)).toHaveLength(1);
    }
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

  it('rejects duplicate verified POIs in an API snapshot instead of selecting the first building', () => {
    const footprint = parseProvidenceOsmFootprints({ elements: [way(255784049)] })[0];
    const conflicting = { ...footprint, heightMeters: 90, heightBasis: 'osm-tag' as const };
    const invalid = { ...footprint, name: '錯誤建築名稱' };
    const fetchedAt = new Date().toISOString();
    for (const buildings of [
      [footprint, conflicting],
      [conflicting, footprint],
      [footprint, invalid],
      [invalid, footprint],
    ]) {
      // Invalid duplicates must not silently be ignored after a valid record,
      // nor promoted ahead of it merely because JSON ordering changed.
      expect(parseProvidenceFootprintResponse({ schoolId: 'pu', buildings })).toEqual([]);
      expect(parseProvidenceFootprintSnapshot({
        schoolId: 'pu', source: 'OpenStreetMap', fetchedAt, stale: false, buildings,
      })).toBeNull();
    }
    // Unverified foreign POIs are never rendered and cannot suppress trusted ways.
    const foreign = { ...footprint, poiId: 'pu-parking-p1', name: '未核對停車場' };
    expect(parseProvidenceFootprintResponse({
      schoolId: 'pu', buildings: [footprint, foreign, foreign],
    })).toEqual([footprint]);
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
      buildings: [footprint], fetchedAt: response.fetchedAt, stale: false, osmBaseAt: null,
    });
  });

  it('does not call a 25-hour-old snapshot fresh even if a stale cache says otherwise', () => {
    const fetchedAt = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    expect(parseProvidenceFootprintSnapshot({ ...response, fetchedAt }, now)).toEqual({
      buildings: [footprint], fetchedAt, stale: true, osmBaseAt: null,
    });
  });

  it('retains the OSM replication date separately from HTTP snapshot fetch time', () => {
    const osmBaseAt = '2026-11-09T08:30:00Z';
    expect(parseProvidenceFootprintSnapshot({ ...response, osmBaseAt }, now)).toEqual({
      buildings: [footprint], fetchedAt: response.fetchedAt, stale: false, osmBaseAt,
    });
    const staleFetchedAt = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const previousBaseAt = new Date(Date.parse(staleFetchedAt) - 60 * 60 * 1000)
      .toISOString().replace('.000Z', 'Z');
    expect(parseProvidenceFootprintSnapshot({
      ...response, fetchedAt: staleFetchedAt, osmBaseAt: previousBaseAt,
    }, now)).toMatchObject({ stale: true, osmBaseAt: previousBaseAt });
  });

  it('marks a cached snapshot stale when its OSM replication age reaches 48 hours', () => {
    // An intermediary can still return stale=false after origin freshness expires.
    // A 46.5h-old database at HTTP fetch time reaches 48h before the 24h
    // HTTP snapshot age limit. Do not call that geometry fresh on the device.
    const osmBaseAt = '2026-11-07T10:30:00Z';
    const snapshot = { ...response, osmBaseAt };
    expect(parseProvidenceFootprintSnapshot(snapshot, now)).toMatchObject({
      stale: false, osmBaseAt,
    });
    const deadline = Date.parse(osmBaseAt) + 48 * 60 * 60 * 1000;
    expect(parseProvidenceFootprintSnapshot(snapshot, deadline - 1)).toMatchObject({
      stale: false, osmBaseAt,
    });
    expect(parseProvidenceFootprintSnapshot(snapshot, deadline)).toMatchObject({
      stale: true, osmBaseAt, buildings: [footprint],
    });
    expect(parseProvidenceFootprintSnapshot(snapshot, deadline + 60_000)).toMatchObject({
      stale: true, osmBaseAt,
    });
    // Legacy responses without the optional replication metadata keep the
    // existing 24h fetch-age rule; do not fabricate a replication timestamp.
    expect(parseProvidenceFootprintSnapshot(response, deadline + 60_000)).toMatchObject({
      stale: false, osmBaseAt: null,
    });
  });

  it('rejects a stale CDN snapshot once its OSM source is seven days old', () => {
    const osmBaseAt = '2026-11-07T10:00:00Z'; // 47h before the HTTP fetch.
    const expiry = Date.parse(osmBaseAt) + 7 * 24 * 60 * 60 * 1000;
    const cached = { ...response, osmBaseAt, stale: true };
    expect(parseProvidenceFootprintSnapshot(cached, expiry - 1)).toMatchObject({
      buildings: [footprint], stale: true, osmBaseAt,
    });
    expect(parseProvidenceFootprintSnapshot(cached, expiry)).toBeNull();
    expect(parseProvidenceFootprintSnapshot(cached, expiry + 1)).toBeNull();
    // A legacy payload lacking replication metadata still follows fetch age.
    expect(parseProvidenceFootprintSnapshot({ ...response, stale: true }, expiry))
      .toMatchObject({ stale: true, osmBaseAt: null });
  });

  it('rejects fabricated OSM replication metadata while keeping legacy snapshots', () => {
    for (const osmBaseAt of [
      '2099-01-01T00:00:00Z',
      '2026-11-06T00:00:00Z',
      '2026-11-09T08:30:00+00:00',
      '2026-02-30T08:30:00Z',
      42, {},
    ]) {
      expect(parseProvidenceFootprintSnapshot({ ...response, osmBaseAt }, now)).toBeNull();
    }
    expect(parseProvidenceFootprintSnapshot({ ...response, osmBaseAt: null }, now)?.osmBaseAt).toBeNull();
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
