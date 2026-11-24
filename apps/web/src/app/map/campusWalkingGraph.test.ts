import { describe, expect, it } from 'vitest';
import { findCampusWalkingRoute, type CampusWalkingGraph } from './campusWalkingGraph';

// Synthetic topology and IDs only: these are NOT Providence paths or coordinates.
const bounds = { south: 10, north: 11, west: 20, east: 21 };
const now = Date.parse('2026-11-24T08:01:00Z');
const open = { validUntil: '2026-12-01T00:00:00Z' } as const;
const graph: CampusWalkingGraph = {
  schoolId: 'fixture',
  osmBaseAt: '2026-11-24T08:00:00Z',
  nodes: [
    { id: 1, lat: 10.1, lng: 20.1 },
    { id: 2, lat: 10.1, lng: 20.101 },
    { id: 3, lat: 10.1, lng: 20.102 },
    { id: 4, lat: 10.102, lng: 20.101 },
    { id: 5, lat: 10.1, lng: 20.101 }, // same coordinate, different node
    { id: 6, lat: 10.099, lng: 20.101 },
  ],
  edges: [
    { from: 1, to: 2, osmWayId: 101, access: 'reviewed-open', direction: 'both', ...open },
    { from: 2, to: 3, osmWayId: 101, access: 'reviewed-open', direction: 'both', ...open },
    { from: 1, to: 4, osmWayId: 102, access: 'reviewed-open', direction: 'both', ...open },
    { from: 4, to: 3, osmWayId: 102, access: 'reviewed-open', direction: 'both', ...open },
    { from: 5, to: 6, osmWayId: 103, access: 'reviewed-open', direction: 'both', ...open },
  ],
};
const route = (g: CampusWalkingGraph, start = 1, end = 3, at = now) =>
  findCampusWalkingRoute(g, 'fixture', bounds, start, end, at);

describe('audited outdoor campus walking graph', () => {
  it('uses the shortest connected route with per-segment sources and attribution', () => {
    const result = route(graph);
    expect(result?.nodes.map(n => n.id)).toEqual([1, 2, 3]);
    expect(result?.osmWayIds).toEqual([101, 101]);
    expect(result?.distanceMeters).toBeGreaterThan(200);
    expect(result?.distanceMeters).toBeLessThan(230);
    expect(result?.attribution).toBe('https://www.openstreetmap.org/copyright');
    expect(route(graph, 3, 1)?.nodes.map(n => n.id)).toEqual([3, 2, 1]);
  });

  it('does not join coincident coordinates or snap an unknown endpoint', () => {
    expect(route(graph, 1, 6)).toBeNull();
    expect(route(graph, 1, 999)).toBeNull();
  });

  it.each(['unknown', 'restricted'] as const)('avoids %s segments', access => {
    const changed = { ...graph, edges: graph.edges.map((e, i) => i === 0 ? { ...e, access } : e) };
    expect(route(changed)?.nodes.map(n => n.id)).toEqual([1, 4, 3]);
    expect(route({ ...changed, edges: changed.edges.slice(0, 2) })).toBeNull();
  });

  it('honors explicit pedestrian direction', () => {
    const g: CampusWalkingGraph = { ...graph, edges: [
      { ...graph.edges[0], direction: 'forward' },
      { ...graph.edges[1], direction: 'reverse' },
    ] };
    expect(route(g, 1, 2)?.nodes.map(n => n.id)).toEqual([1, 2]);
    expect(route(g, 2, 1)).toBeNull();
    expect(route(g, 1, 3)).toBeNull();
    expect(route(g, 3, 2)?.nodes.map(n => n.id)).toEqual([3, 2]);
  });

  it('rejects another school, invalid coordinates and duplicate node identities', () => {
    expect(route({ ...graph, schoolId: 'other' })).toBeNull();
    expect(route({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] })).toBeNull();
    expect(route({ ...graph, nodes: graph.nodes.map(n => n.id === 4 ? { ...n, lat: 12 } : n) })).toBeNull();
    expect(route({ ...graph, nodes: graph.nodes.map(n => n.id === 4 ? { ...n, lat: NaN } : n) })).toBeNull();
  });

  it('rejects dangling, zero-length or contradictory segments', () => {
    expect(route({ ...graph, edges: [...graph.edges, { ...graph.edges[0], to: 999 }] })).toBeNull();
    expect(route({ ...graph, edges: [...graph.edges, { ...graph.edges[0], from: 2, to: 5 }] })).toBeNull();
    expect(route({ ...graph, edges: [...graph.edges, { ...graph.edges[0], from: 2, to: 1, access: 'restricted' }] })).toBeNull();
    expect(route({ ...graph, edges: [...graph.edges, { ...graph.edges[0], osmWayId: 0 }] })).toBeNull();
  });

  it('does not mutate the source and preserves the explicit same-node result', () => {
    const result = route(graph, 1, 1);
    expect(result?.distanceMeters).toBe(0);
    expect(result?.osmWayIds).toEqual([]);
    expect(result?.nodes[0]).not.toBe(graph.nodes[0]);
  });

  it('does not route reviewed-open segments after their review expires', () => {
    const validUntil = '2026-11-25T08:00:00Z';
    const expiry = Date.parse(validUntil);
    const expiring = { ...graph, edges: graph.edges.map(edge => ({ ...edge, validUntil })) };
    expect(route(expiring, 1, 3, expiry - 1)?.nodes.map(n => n.id)).toEqual([1, 2, 3]);
    expect(route(expiring, 1, 3, expiry)).toBeNull();
    const missingExpiry = { ...graph, edges: graph.edges.map(({ validUntil: _validUntil, ...edge }) => edge) };
    expect(route(missingExpiry)).toBeNull();
  });

  it('requires a snapshot even when the graph arrives without its timestamp', () => {
    const { osmBaseAt: _osmBaseAt, ...missing } = graph;
    expect(route(missing as CampusWalkingGraph)).toBeNull();
  });

  it.each([
    '2026-11-24', '2026-11-24T08:00:00', '2026-11-24T08:00:00+00:00',
    '2026-11-24T08:00:00.000Z', '2026-11-24T08:00:00Z ',
  ])('rejects noncanonical snapshot timestamp %s', osmBaseAt => {
    expect(route({ ...graph, osmBaseAt })).toBeNull();
  });

  it.each([
    '2026-12-01', '2026-12-01T00:00:00', '2026-12-01T00:00:00+00:00',
    '2026-11-31T00:00:00Z', '2026-12-01T00:00:00.000Z', '2026-12-01T00:00:00Z ',
  ])('rejects noncanonical or impossible review expiry %s', validUntil => {
    expect(route({ ...graph, edges: graph.edges.map(edge => ({ ...edge, validUntil })) })).toBeNull();
  });

  it.each([
    ['2026-11-22T08:01:00Z', true],
    ['2026-11-22T08:00:59Z', false],
    ['2026-11-24T08:06:00Z', true],
    ['2026-11-24T08:06:01Z', false],
  ] as const)('preserves the snapshot freshness boundary for %s', (osmBaseAt, usable) => {
    expect(!!route({ ...graph, osmBaseAt })).toBe(usable);
  });

  it('does not route a graph whose OSM snapshot is no longer fresh', () => {
    expect(route(graph, 1, 3, Date.parse('2026-11-27T08:00:01Z'))).toBeNull();
  });
});
