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
    expect(findCampusWalkingRoute(result.graph, 'fixture', bounds, 1, 2)).toBeNull();
    expect(findCampusWalkingRoute(result.graph, 'other', bounds, 1, 2)).toBeNull();
  });

  it('does not join non-identical nodes or jump across the campus boundary', () => {
    const outside = node(6, 10.015, 20.002);
    const input = { ...payload(), elements: [...payload().elements, outside, way(103, [1, 6, 5])] };
    const result = parse(input)!;
    expect(result.graph.nodes.some(n => n.id === 6)).toBe(false);
    expect(result.graph.edges.some(e => e.osmWayId === 103)).toBe(false);
    expect(result.graph.edges.some(e => e.from === 2 && e.to === 4)).toBe(false);
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

  it('rejects incomplete, stale and malformed responses', () => {
    const input = payload();
    expect(parse({ ...input, remark: 'runtime error' })).toBeNull();
    expect(parse({ ...input, osm3s: {} })).toBeNull();
    expect(parse({ ...input, osm3s: { timestamp_osm_base: '2026-11-21T00:00:00Z' } })).toBeNull();
    expect(parse({ ...input, osm3s: { timestamp_osm_base: '2026-11-24T09:00:00Z' } })).toBeNull();
    expect(parse({ ...input, osm3s: { timestamp_osm_base: '2026-11-31T08:00:00Z' } })).toBeNull();
    expect(parse({ ...input, elements: [...input.elements, way(103, [1, 999])] })).toBeNull();
    expect(parse({ ...input, elements: [...input.elements, node(1, 10.003, 20.003)] })).toBeNull();
    expect(parse({ ...input, elements: [...input.elements, way(101, [1, 5])] })).toBeNull();
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
