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

  it('does not attach an audited campus POI name to a renamed OSM building', () => {
    // Synthetic source drift: the way ID and geometry remain valid, but OSM
    // now explicitly names a different place. Keep the point marker; omit
    // the misleading 3D volume until the new source/name is verified.
    for (const tags of [
      { building: 'school' },
      { building: 'school', name: '蓋夏圖書館' },
      { building: 'school', name: 'Guixa Library', 'name:zh': '蓋夏圖書館' },
      { building: 'school', 'name:zh': '蓋夏圖書館' },
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, tags)],
      }), JSON.stringify(tags)).toMatchObject([{ poiId: 'pu-library' }]);
    }
    for (const tags of [
      { building: 'school', name: '希嘉學苑' },
      { building: 'school', name: '  ' },
      { building: 'school', name: 99 },
      { building: 'school', name: null },
      { building: 'school', name: '蓋夏圖書館', 'name:zh': '希嘉學苑' },
      { building: 'school', name: 'Guixa Library', 'name:zh': ' ' },
      // A conflicting Chinese primary label must not be silently overridden
      // by a matching name:zh (a real bilingual label remains accepted above).
      { building: 'school', name: '希嘉學苑', 'name:zh': '蓋夏圖書館' },
      { building: 'school', name: '主顧樓', 'name:zh': '蓋夏圖書館' },
      { building: 'school', name: '蓋夏圖書館／希嘉學苑', 'name:zh': '蓋夏圖書館' },
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, tags)],
      }), JSON.stringify(tags)).toEqual([]);
    }
  });

  it('uses localized traditional Chinese OSM names without allowing conflicting POI identities', () => {
    // Synthetic OSM tag drift: a matching name:zh is not enough when an
    // explicit Taiwanese/traditional name identifies a different building.
    // This does not claim any actual campus OSM way currently has a mismatch.
    const checked = { building: 'school', name: 'Guixa Library' };
    for (const tags of [
      { ...checked, 'name:zh-TW': '蓋夏圖書館' },
      { ...checked, 'name:zh-Hant': '蓋夏圖書館' },
      { ...checked, 'name:zh': '蓋夏圖書館', 'name:zh-TW': '蓋夏圖書館',
        'name:zh-Hant': '蓋夏圖書館' },
      { building: 'school', 'name:zh-TW': '蓋夏圖書館' },
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, tags)],
      }), JSON.stringify(tags)).toMatchObject([{ poiId: 'pu-library' }]);
    }
    for (const tags of [
      { ...checked, 'name:zh': '蓋夏圖書館', 'name:zh-TW': '希嘉學苑' },
      { ...checked, 'name:zh': '蓋夏圖書館', 'name:zh-Hant': '主顧樓' },
      { ...checked, 'name:zh-TW': '蓋夏圖書館', 'name:zh-Hant': '希嘉學苑' },
      { ...checked, 'name:zh-TW': '' },
      { ...checked, 'name:zh-Hant': null },
      { building: 'school', name: '主顧樓', 'name:zh-TW': '蓋夏圖書館' },
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, tags)],
      }), JSON.stringify(tags)).toEqual([]);
    }
  });

  it('uses an illustrative height only when height is absent, never for an explicit unknown unit', () => {
    const levelsOnly = parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'yes', 'building:levels': '8' })],
    });
    expect(levelsOnly[0]).toMatchObject({ heightMeters: 12, heightBasis: 'illustrative' });
    for (const height of ['50 cubits', '9999', '', '   ', null, 18]) {
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
    // Do not interpret malformed values, ranges or out-of-bound measurements.
    for (const height of ['18,125 m', '18-20 m', '59 cubits', '2.499 m', '100.001 m']) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'yes', height })],
      }), height).toEqual([]);
    }
  });

  it('accepts unambiguous, spelled-out OSM metre aliases without guessing other units', () => {
    // The OSM units guide discourages these aliases but defines them as metres.
    // A tagged building must not disappear solely due to an unambiguous alias.
    for (const height of ['18 metre', '18 metres', '18 meter', '18 meters']) {
      const buildings = parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'school', height })],
      });
      expect(buildings, height).toHaveLength(1);
      expect(buildings[0], height).toMatchObject({
        poiId: 'pu-library', heightMeters: 18, heightBasis: 'osm-tag',
      });
      expect(parseProvidenceFootprintResponse({
        schoolId: 'pu', buildings,
      }), height).toEqual(buildings);
    }
    for (const height of ['18metres', '18meters', '18 kilometres', '18 km',
      '18 centimetres', '18 metres approx', '18 metres;20 metres']) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'yes', height })],
      }), height).toEqual([]);
    }
  });

  it('converts OSM-standard km, mi, nmi and yd heights without inventing metres', () => {
    // These are synthetic tags, not claims about any current campus building.
    // OSM documents kilometre, mile, nautical mile and yard as explicit height units;
    // convert the measured tag instead of substituting a 12 m illustration.
    const valid: Array<[string, number]> = [
      ['0.018 km', 18],
      ['0.012 mi', 19.312128],
      ['0.010 nmi', 18.52],
      ['0.050 nmi', 92.6],
      ['20 yd', 18.288],
    ];
    for (const [height, expected] of valid) {
      const buildings = parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'school', height })],
      });
      expect(buildings, height).toHaveLength(1);
      expect(buildings[0].heightMeters, height).toBeCloseTo(expected, 6);
      expect(buildings[0].heightBasis, height).toBe('osm-tag');
      expect(parseProvidenceFootprintResponse({
        schoolId: 'pu', buildings,
      }), height).toEqual(buildings);
    }
    // Do not assume an unstated unit, accept concatenated/ambiguous notation,
    // or extrude a value outside the bounded 2.5–100 metre scene contract.
    for (const height of [
      '0.018km', '0.012 MI', '20 yards', '20 cm', '0.0001 km',
      '0.010nmi', '0.060 nmi', '0.2 km', '200 mi', '12 yd; 10 ft', '1e-2 km',
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'school', height })],
      }), height).toEqual([]);
    }
  });

  it('converts unambiguous OSM feet and inches without inventing a height', () => {
    // OSM's ft/in convention: 1 foot is exactly 0.3048 metres;
    // 1 inch is exactly 0.0254 metres. No levels-based estimates.
    const valid: Array<[string, number]> = [
      ['50 ft', 15.24], ['50 feet', 15.24], ["50'", 15.24],
      ['50.5 ft', 15.3924], ["50'6\"", 15.3924], ["10'4\"", 3.1496],
    ];
    for (const [height, expected] of valid) {
      const parsed = parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'school', height })],
      });
      expect(parsed, height).toHaveLength(1);
      expect(parsed[0].heightMeters, height).toBeCloseTo(expected, 6);
      expect(parsed[0].heightBasis, height).toBe('osm-tag');
      expect(parseProvidenceFootprintResponse({
        schoolId: 'pu', buildings: parsed,
      }), height).toEqual(parsed);
    }
    for (const height of ["50' 6\"", "50'12\"", '50 ft; 60 ft',
      '1,000 ft', '333 ft', '50 foot', '50 furlongs', "5'99\"", '12 inch', "7'4\""]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'yes', height })],
      }), height).toEqual([]);
    }
  });

  it('does not extrude explicitly non-area or contradictory OSM building geometry', () => {
    // Geometry closing back on itself is not evidence of an area when OSM
    // explicitly marks this whitelisted way as a line or an ambiguous type.
    for (const tags of [
      { building: 'yes', area: 'no', height: '18 m' },
      { building: 'school', area: 'false' },
      { building: 'yes', area: '0' },
      { building: 'yes', area: 'unknown' },
      { building: 'yes', area: '' },
      { building: 'yes', area: null },
      { building: 'yes', area: true },
      { building: 'school;demolished' },
      { building: 'yes,construction' },
      { building: 'school|roof' },
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, tags)],
      }), JSON.stringify(tags)).toEqual([]);
    }
    // The presence of a valid area tag must not accidentally hide real ways.
    for (const area of [undefined, 'yes', 'true', '1', ' YES ']) {
      const tags = area === undefined ? { building: 'school' } : { building: 'school', area };
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, tags)],
      }), String(area)).toHaveLength(1);
    }
  });

  it('does not extrude a retired, roof-only, unfinished or untagged OSM way as a complete building', () => {
    expect(parseProvidenceOsmFootprints({
      elements: [{ ...way(255784049), tags: undefined }],
    })).toEqual([]);
    for (const tags of [
      null, {}, { height: '18' }, { building: 'no' },
      { building: 'false' }, { building: ' FALSE ' },
      { building: '0' }, { building: 'none' }, { building: 'unknown' },
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

  it('does not extrude a coordinate-closed but OSM-node-open way', () => {
    // These IDs are synthetic. Real OSM way closure requires first/last
    // node IDs to match; two different nodes may share the same coordinates.
    const closedIds = [101, 102, 103, 104, 101];
    const withNodes = (nodes: unknown) => ({
      ...way(255784049, library, { building: 'school' }), nodes,
    });
    expect(parseProvidenceOsmFootprints({
      elements: [withNodes(closedIds)],
    })).toMatchObject([{ poiId: 'pu-library' }]);
    for (const nodes of [
      [101, 102, 103, 104, 105], // same first/last coordinates, different OSM node
      // An internally repeated ID with two different geometry coordinates is
      // contradictory even though the coordinate ring itself is valid.
      [101, 102, 103, 102, 101],
      [101, 101, 103, 104, 101],
      [101, 102, 103, 101], // missing geometry reference
      [101, 102, 103, 104, 101, 101], // extra reference
      [101, 102, -3, 104, 101],
      [101, 102, '103', 104, 101],
      null,
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [withNodes(nodes)],
      }), JSON.stringify(nodes)).toEqual([]);
    }
    // A repeated OSM node ID identifies exactly one coordinate. This fixture
    // differs by only 5e-10 degrees: safeOutline's geometry-only tolerance
    // would accept it, but its explicit OSM node identity is contradictory.
    const conflictingClosure = library.map((point) => ({ ...point }));
    conflictingClosure[conflictingClosure.length - 1].lon += 5e-10;
    expect(parseProvidenceOsmFootprints({
      elements: [{ ...withNodes(closedIds), geometry: conflictingClosure }],
    })).toEqual([]);
    // Preserve existing geometry-only compatibility when no node IDs exist.
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, conflictingClosure, { building: 'school' })],
    })).toHaveLength(1);
    // Synthetic fixtures without node references preserve legacy parsing.
    expect(parseProvidenceOsmFootprints({
      elements: [way(255784049, library, { building: 'school' })],
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

  it('does not raise a subsurface, rooftop or bridge feature into an invented ground-standing building', () => {
    // A whitelisted way can later be retagged. A source height is not a
    // surveyed base elevation; reject non-surface placement rather than
    // constructing walls through soil or empty air.
    for (const placement of [
      { location: 'underground' }, { location: 'underwater' },
      { location: 'roof' }, { location: 'overhead' },
      { location: '' }, { location: null },
      { layer: '-1' }, { layer: '1' }, { layer: '0.5' },
      { layer: 'unknown' }, { layer: null },
      { bridge: 'yes' }, { bridge: 'viaduct' }, { bridge: true },
      { tunnel: 'yes' }, { tunnel: 'building_passage' },
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'school', height: '18 m', ...placement })],
      }), JSON.stringify(placement)).toEqual([]);
    }
    // Explicit ground placement and negative bridge/tunnel flags should not
    // hide a normally verified, above-ground OSM outline.
    for (const placement of [
      {}, { location: 'surface' }, { location: 'ground' },
      { layer: '0' }, { layer: '+0' },
      { bridge: 'no', tunnel: 'no' },
      { location: 'surface', layer: '0', bridge: 'no', tunnel: 'false' },
    ]) {
      expect(parseProvidenceOsmFootprints({
        elements: [way(255784049, library, { building: 'school', height: '18 m', ...placement })],
      }), JSON.stringify(placement)).toMatchObject([
        { poiId: 'pu-library', heightMeters: 18, heightBasis: 'osm-tag' },
      ]);
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

  it('bounds audited node consistency work before reading oversized rings', () => {
    // The closed ring has one extra entry for its repeated first node.
    // Use a synthetic oversized source and count indexed reads, not timing.
    for (const count of [162, 200, 2000]) {
      let reads = 0;
      const nodes = new Proxy(Array.from({ length: count }, (_, index) => index + 1), {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
          return Reflect.get(target, key, receiver);
        },
      });
      const geometry = Array.from({ length: count }, () => library[0]);
      expect(parseProvidenceOsmFootprints({
        elements: [{ ...way(255784049, geometry), nodes }],
      })).toEqual([]);
      expect(reads, 'oversized node references must not be scanned').toBe(0);
    }
    // The inclusive limit (160 vertices plus closure) still accepts a
    // simple synthetic ring around the fixture POI, with distinct node IDs.
    const geometry = Array.from({ length: 160 }, (_, index) => {
      const angle = 2 * Math.PI * index / 160;
      return { lat: 24.22629 + Math.sin(angle) * 0.0001,
        lon: 120.58137 + Math.cos(angle) * 0.0001 };
    });
    geometry.push({ ...geometry[0] });
    const nodes = Array.from({ length: 160 }, (_, index) => index + 1);
    nodes.push(nodes[0]);
    expect(parseProvidenceOsmFootprints({
      elements: [{ ...way(255784049, geometry), nodes }],
    })).toHaveLength(1);
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

  it('does not display OSM edits newer than the database or fetch snapshot', () => {
    // Synthetic conflicting source dates: the shape may still be valid, but
    // a way revision cannot originate in a database from before that edit.
    const revision = {
      ...footprint, osmVersion: 13, osmEditedAt: '2026-11-09T08:36:00Z',
    };
    const snapshot = parseProvidenceFootprintSnapshot({
      ...response, osmBaseAt: '2026-11-09T08:30:00Z', buildings: [revision],
    }, now);
    expect(snapshot?.buildings).toHaveLength(1);
    expect(snapshot?.buildings[0].outline).toEqual(footprint.outline);
    expect(snapshot?.buildings[0]).not.toHaveProperty('osmVersion');
    expect(snapshot?.buildings[0]).not.toHaveProperty('osmEditedAt');

    // A revision at the replication cutoff remains a sourced label.
    const consistent = {
      ...revision, osmEditedAt: '2026-11-09T08:34:00Z',
    };
    expect(parseProvidenceFootprintSnapshot({
      ...response, osmBaseAt: '2026-11-09T08:30:00Z', buildings: [consistent],
    }, now)?.buildings[0]).toMatchObject({
      osmVersion: 13, osmEditedAt: '2026-11-09T08:34:00Z',
    });

    // Older Overpass replies have no osm3s field: the HTTP fetch timestamp
    // is the only available upper bound, not the device clock 1 hour later.
    const legacy = parseProvidenceFootprintSnapshot({
      ...response, buildings: [{ ...revision, osmEditedAt: '2026-11-09T09:06:00Z' }],
    }, now);
    expect(legacy?.buildings[0]).not.toHaveProperty('osmEditedAt');
    expect(parseProvidenceFootprintSnapshot({
      ...response, buildings: [{ ...revision, osmEditedAt: '2026-11-09T09:04:00Z' }],
    }, now)?.buildings[0]).toMatchObject({
      osmVersion: 13, osmEditedAt: '2026-11-09T09:04:00Z',
    });
  });

  it('does not accumulate clock skew across fetch and OSM replication timestamps', () => {
    const fetchedAt = new Date(now + 4 * 60 * 1000).toISOString();
    const osmBaseAt = (seconds: number) =>
      new Date(now + seconds * 1000).toISOString().replace('.000Z', 'Z');
    // Both clocks must be within the same five-minute tolerance of the device.
    // A future fetch timestamp must not grant a second five-minute allowance.
    for (const seconds of [301, 480, 540]) {
      expect(parseProvidenceFootprintSnapshot({
        ...response, fetchedAt, osmBaseAt: osmBaseAt(seconds),
      }, now)).toBeNull();
    }
    for (const seconds of [0, 240, 300]) {
      expect(parseProvidenceFootprintSnapshot({
        ...response, fetchedAt, osmBaseAt: osmBaseAt(seconds),
      }, now)).toMatchObject({ osmBaseAt: osmBaseAt(seconds), buildings: [footprint] });
    }
    expect(parseProvidenceFootprintSnapshot({ ...response, fetchedAt }, now))
      .toMatchObject({ osmBaseAt: null, buildings: [footprint] });
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
