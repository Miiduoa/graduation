import { describe, expect, it } from 'vitest';
import { buildCampusWalkingOverpassQuery, parseCampusWalkingOsmCandidates } from './campusWalkingOsm';
import { findCampusWalkingRoute } from './campusWalkingGraph';

// Synthetic fixture only: no real school, entrance or surveyed walking route.
const bounds = { south: 10, north: 10.01, west: 20, east: 20.01 };
const base = '2026-11-24T08:00:00Z';
const now = Date.parse(base) + 60_000;
const meta = { version: 1, timestamp: '2026-11-20T00:00:00Z' };
const node = (id: number, lat: number, lon: number, tags = {}) =>
  ({ type: 'node', id, lat, lon, tags, ...meta });
const way = (id: number, nodes: number[], tags = {}) =>
  ({ type: 'way', id, nodes, tags: { highway: 'footway', ...tags }, ...meta });
const payload = () => ({
  osm3s: { timestamp_osm_base: base },
  elements: [
    node(1, 10.001, 20.001), node(2, 10.001, 20.002),
    node(3, 10.001, 20.003, { barrier: 'gate' }),
    node(4, 10.001, 20.002), node(5, 10.002, 20.002),
    way(101, [1, 2, 3], { foot: 'yes' }), way(102, [4, 5]),
  ],
});
const parse = (input: unknown = payload()) =>
  parseCampusWalkingOsmCandidates(input, 'fixture', bounds, now);

describe('OSM campus walking discovery (not routing approval)', () => {
  it('generates a bounded metadata query including member nodes', () => {
    const query = buildCampusWalkingOverpassQuery(bounds);
    expect(query).toContain('(10,20,10.01,20.01)');
    expect(query).toContain(';>;);out meta;');
    expect(query).toContain('footway');
    expect(buildCampusWalkingOverpassQuery({ ...bounds, north: 90 })).toBeNull();
    expect(buildCampusWalkingOverpassQuery({ ...bounds, east: NaN })).toBeNull();
    expect(buildCampusWalkingOverpassQuery({ ...bounds, south: 11 })).toBeNull();
  });

  it('keeps OSM source, node revisions and exact topology; never grants access', () => {
    const result = parse()!;
    expect(result.osmBaseAt).toBe(base);
    expect(result.attribution).toBe('https://www.openstreetmap.org/copyright');
    expect(result.ways[0]).toMatchObject({ id: 101, version: 1, tags: { foot: 'yes' } });
    expect(result.nodes[2]).toMatchObject({ id: 3, tags: { barrier: 'gate' } });
    expect(result.graph.edges.map(e => [e.from, e.to, e.access])).toEqual([
      [1, 2, 'unknown'], [2, 3, 'restricted'], [4, 5, 'unknown'],
    ]);
    expect(findCampusWalkingRoute(result.graph, 'fixture', bounds, 1, 2, now)).toBeNull();
    const currentExpiry = new Date(now + 60_000).toISOString().replace('.000Z', 'Z');
    const unreviewed = {
      ...result.graph,
      edges: result.graph.edges.map(edge => ({ ...edge, validUntil: currentExpiry })),
    };
    expect(findCampusWalkingRoute(unreviewed, 'fixture', bounds, 1, 2, now)).toBeNull();
    expect(findCampusWalkingRoute(result.graph, 'other', bounds, 1, 2, now)).toBeNull();
  });

  it('does not join non-identical nodes or jump across the campus boundary', () => {
    const outside = node(6, 10.015, 20.002);
    const input = { ...payload(), elements: [...payload().elements, outside, way(103, [1, 6, 5])] };
    const result = parse(input)!;
    expect(result.graph.nodes.some(n => n.id === 6)).toBe(false);
    expect(result.graph.edges.some(e => e.osmWayId === 103)).toBe(false);
    expect(result.graph.edges.some(e => e.from === 2 && e.to === 4)).toBe(false);
  });

  it('keeps in-bounds ways when an out-of-bounds node identity is repeated in the payload', () => {
    const outside = node(6, 10.015, 20.002);
    const input = { ...payload(), elements: [...payload().elements, outside, { ...outside }] };
    const result = parse(input)!;
    expect(result.graph.edges.map(e => [e.from, e.to, e.osmWayId])).toEqual([
      [1, 2, 101], [2, 3, 101], [4, 5, 102],
    ]);
  });

  it('keeps in-bounds ways when an out-of-bounds way has coincident or duplicate nodes', () => {
    const outsideA = node(6, 10.015, 20.002);
    const outsideB = node(7, 10.015, 20.002);
    const input = {
      ...payload(),
      elements: [...payload().elements, outsideA, outsideB, way(103, [6, 7, 6])],
    };
    const result = parse(input)!;
    expect(result.graph.edges.map(e => [e.from, e.to, e.osmWayId])).toEqual([
      [1, 2, 101], [2, 3, 101], [4, 5, 102],
    ]);
    expect(result.osmBaseAt).toBe(base);
    expect(result.graph.osmBaseAt).toBe(base);
  });

  it('keeps campus segments despite repeated ways and invalid revisions outside campus', () => {
    const outsideA = { ...node(6, 10.015, 20.002), version: 0 };
    const outsideB = { ...node(7, 10.016, 20.002), timestamp: 'invalid' };
    const outsideWay = way(103, [6, 7]);
    const input = {
      ...payload(),
      elements: [outsideWay, ...payload().elements, { ...outsideWay, version: 0 }, outsideA, outsideB],
    };
    expect(parse(input)).toEqual(parse());
  });

  it('rejects a repeated way identity when either occurrence references a campus node', () => {
    const outside = [node(6, 10.015, 20.002), node(7, 10.016, 20.002)];
    const campusWay = way(103, [1, 5]);
    const outsideWay = way(103, [6, 7]);
    const boundaryWay = way(103, [1, 6]);
    for (const duplicates of [
      [campusWay, campusWay], [outsideWay, campusWay], [campusWay, outsideWay],
      [outsideWay, boundaryWay], [boundaryWay, outsideWay],
    ]) {
      expect(parse({ ...payload(), elements: [...payload().elements, ...outside, ...duplicates] })).toBeNull();
    }
    expect(parse({
      ...payload(),
      elements: [...payload().elements, { ...campusWay, timestamp: 'invalid' }],
    })).toBeNull();
  });

  it('ignores invalid element IDs outside campus and rejects them inside campus', () => {
    const input = payload();
    const outside = [node(6, 10.015, 20.002), node(7, 10.016, 20.002)];
    expect(parse({
      ...input,
      elements: [...input.elements, ...outside, node(0, 10.017, 20.002), way(0, [6, 7])],
    })).toEqual(parse(input));
    for (const invalid of [node(0, 10.001, 20.004), way(0, [1, 5]), way(0, [1, 6])]) {
      expect(parse({ ...input, elements: [...input.elements, ...outside, invalid] })).toBeNull();
    }
  });

  it('drops incomplete outside ways and rejects incomplete campus ways', () => {
    const input = payload();
    const elements = [
      ...input.elements,
      node(6, 10.015, 20.002), node(7, 10.016, 20.002),
    ];
    for (const references of [[6, 0, 7], [6, 999, 7]]) {
      expect(parse({ ...input, elements: [...elements, way(103, references)] })).toEqual(parse(input));
    }
    for (const references of [[1, 2, 0], [7, 0, 1], [1, 999, 7], [0, 999]]) {
      expect(parse({ ...input, elements: [...elements, way(103, references)] })).toBeNull();
    }
  });

  it('charges the segment budget only for retained ways', () => {
    const input = payload();
    const outside = [node(6, 10.015, 20.002), node(7, 10.016, 20.002)];
    const longWay = way(103, Array.from({ length: 3997 }, (_, i) => 6 + i % 2));
    const shortWay = way(104, [6, 7]);
    const atLimit = [...input.elements, ...outside, longWay, shortWay];
    const baseline = parse({ ...input, elements: atLimit });
    expect(baseline?.graph.edges).toEqual(parse(input)?.graph.edges);
    const repeated = parse({ ...input, elements: [...atLimit, { ...shortWay }] });
    expect(repeated?.graph).toEqual(baseline?.graph);
    expect(repeated?.ways.map(({ id }) => id)).toEqual([101, 102, 103]);
    expect(parse({ ...input, elements: [...atLimit, way(105, [6, 7])] })).toBeNull();

    const shortDuplicate = way(105, [6, 7]);
    const longDuplicate = way(105, Array.from({ length: 3999 }, (_, i) => 6 + i % 2));
    for (const duplicates of [[shortDuplicate, longDuplicate], [longDuplicate, shortDuplicate]]) {
      expect(parse({ ...input, elements: [...atLimit, ...duplicates] })).toEqual(baseline);
    }
    expect(parse({ ...input, elements: [...atLimit, { ...longDuplicate, version: 0 }] }))
      .toEqual(baseline);
  });

  it('excludes highway areas and indoor ways and flags tagged restrictions', () => {
    const input = { ...payload(), elements: [...payload().elements,
      way(103, [1, 2, 1], { area: 'yes' }),
      way(104, [1, 2], { indoor: 'yes' }),
      way(105, [1, 5], { access: 'private' }),
      way(106, [1, 5], { 'foot:conditional': 'no @ (Su)' }),
    ] };
    const edges = parse(input)!.graph.edges;
    expect(edges.some(e => e.osmWayId === 103 || e.osmWayId === 104)).toBe(false);
    expect(edges.filter(e => [105, 106].includes(e.osmWayId)).map(e => e.access))
      .toEqual(['restricted', 'restricted']);
  });

  it('keeps the sidepath as a candidate and excludes the original way', () => {
    const input = { ...payload(), elements: [...payload().elements,
      way(103, [1, 5], { highway: 'residential', foot: 'use_sidepath' }),
      way(104, [1, 4, 5], { footway: 'sidewalk' }),
    ] };
    const result = parse(input)!;
    expect(result.ways.find(w => w.id === 103)?.tags.foot).toBe('use_sidepath');
    expect(result.graph.edges.filter(e => e.osmWayId >= 103).map(e => [e.osmWayId, e.from, e.to]))
      .toEqual([[104, 1, 4], [104, 4, 5]]);
  });

  it('rejects incomplete, stale and malformed responses', () => {
    const input = payload();
    expect(parse({ ...input, remark: 'runtime error' })).toBeNull();
    expect(parse({ ...input, osm3s: {} })).toBeNull();
    expect(parse({ ...input, osm3s: { timestamp_osm_base: '2026-11-21T00:00:00Z' } })).toBeNull();
    expect(parse({ ...input, osm3s: { timestamp_osm_base: '2026-11-24T09:00:00Z' } })).toBeNull();
    expect(parse({ ...input, osm3s: { timestamp_osm_base: '2026-11-31T08:00:00Z' } })).toBeNull();
    expect(parse({ ...input, elements: [...input.elements, way(103, [1, 999])] })).toBeNull();
    expect(parse({ ...input, elements: [...input.elements, node(1, 10.003, 20.003)] })).toBeNull();
    expect(parse({ ...input, elements: [...input.elements, way(103, [2, 4])] })).toBeNull();
    expect(parse({ ...input, elements: [...input.elements, way(103, [1, 2, 1])] })).toBeNull();
    expect(parse({ ...input, elements: [...input.elements, { ...node(6, 10.001, 20.001), version: 0 }] })).toBeNull();
    expect(parse({ ...input, elements: [...input.elements, { ...node(6, 10.001, 20.001), timestamp: '2026-11-25T00:00:00Z' }] })).toBeNull();
  });

  it('bounds node and segment counts', () => {
    expect(parse({ ...payload(), elements: Array.from({ length: 2001 }, (_, i) => node(i + 1, 10.001, 20.001)) })).toBeNull();
    expect(parse({ ...payload(), elements: [...payload().elements, way(103, Array(4002).fill(1))] })).toBeNull();
  });
});
