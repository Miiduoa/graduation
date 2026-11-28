import { describe, expect, it } from 'vitest';
import { findCampusWalkingRoute, isCampusWalkingRouteCurrent, type CampusWalkingGraph } from './campusWalkingGraph';

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

  it('rejects malformed graph containers and rows without throwing or using partial routes', () => {
    const malformed: unknown[] = [
      null, undefined,
      { ...graph, nodes: null }, { ...graph, nodes: {} },
      { ...graph, edges: null }, { ...graph, edges: {} },
      { ...graph, nodes: [...graph.nodes, null] },
      { ...graph, nodes: [...graph.nodes, undefined] },
      { ...graph, nodes: [...graph.nodes, 1] },
      { ...graph, edges: [...graph.edges, null] },
      { ...graph, edges: [...graph.edges, undefined] },
      { ...graph, edges: [...graph.edges, 1] },
    ];
    for (const value of malformed) {
      expect(route(value as CampusWalkingGraph)).toBeNull();
      expect(route(value as CampusWalkingGraph, 1, 1)).toBeNull();
    }
    expect(findCampusWalkingRoute(graph, 'fixture', null as unknown as typeof bounds, 1, 3, now)).toBeNull();
    expect(route(graph)?.nodes.map(node => node.id)).toEqual([1, 2, 3]);
  });

  it('does not resume a missing cached route', () => {
    const result = route(graph)!;
    for (const missing of [null, undefined]) {
      expect(isCampusWalkingRouteCurrent(missing as unknown as typeof result, 'fixture', now)).toBe(false);
    }
    expect(isCampusWalkingRouteCurrent(result, 'fixture', now)).toBe(true);
  });

  it('rejects corrupted cached route geometry without claiming that shape proves access', () => {
    const result = route(graph)!;
    const invalid: unknown[] = [
      { ...result, nodes: null },
      { ...result, nodes: [] },
      { ...result, nodes: [...result.nodes, null] },
      { ...result, nodes: [result.nodes[0], result.nodes[0], result.nodes[2]] },
      { ...result, nodes: [result.nodes[0], { ...result.nodes[1], lat: 91 }, result.nodes[2]] },
      { ...result, nodes: [result.nodes[0], { ...result.nodes[1], lng: NaN }, result.nodes[2]] },
      { ...result, nodes: [result.nodes[0], { ...result.nodes[0], id: 99 }, result.nodes[2]] },
      { ...result, osmWayIds: null },
      { ...result, osmWayIds: [101] },
      { ...result, osmWayIds: [101, 0] },
      { ...result, distanceMeters: NaN },
      { ...result, distanceMeters: -1 },
      { ...result, distanceMeters: result.distanceMeters + 1 },
      { ...result, attribution: '' },
    ];
    for (const value of invalid) {
      expect(isCampusWalkingRouteCurrent(value as typeof result, 'fixture', now)).toBe(false);
    }
    expect(isCampusWalkingRouteCurrent(JSON.parse(JSON.stringify(result)), 'fixture', now)).toBe(true);
    expect(isCampusWalkingRouteCurrent(route(graph, 3, 1)!, 'fixture', now)).toBe(true);
    expect(isCampusWalkingRouteCurrent(route(graph, 1, 1)!, 'fixture', now)).toBe(true);
  });

  it('rejects dangling, zero-length or contradictory segments', () => {
    expect(route({ ...graph, edges: [...graph.edges, { ...graph.edges[0], to: 999 }] })).toBeNull();
    expect(route({ ...graph, edges: [...graph.edges, { ...graph.edges[0], from: 2, to: 5 }] })).toBeNull();
    expect(route({ ...graph, edges: [...graph.edges, { ...graph.edges[0], from: 2, to: 1, access: 'restricted' }] })).toBeNull();
    expect(route({ ...graph, edges: [...graph.edges, { ...graph.edges[0], osmWayId: 0 }] })).toBeNull();
  });

  it('rejects missing-GPS and physically zero-length segments in live and cached routes', () => {
    const wideBounds = { south: -90, north: 90, west: -180, east: 180 };
    const solve = (nodes: CampusWalkingGraph['nodes']) => findCampusWalkingRoute({
      ...graph, nodes, edges: [graph.edges[0]],
    }, 'fixture', wideBounds, 1, 2, now);
    const template = route(graph)!;
    const invalidPairs = [
      [{ id: 1, lat: 0, lng: 0 }, { id: 2, lat: 0, lng: 0.001 }],
      [{ id: 1, lat: 10, lng: -180 }, { id: 2, lat: 10, lng: 180 }],
      [{ id: 1, lat: 90, lng: 1 }, { id: 2, lat: 90, lng: 2 }],
      [{ id: 1, lat: -90, lng: 1 }, { id: 2, lat: -90, lng: 2 }],
    ];
    for (const nodes of invalidPairs) {
      expect(solve(nodes)).toBeNull();
      const distanceMeters = nodes[0].lat === 0 ? 6371000 * Math.PI / 180 * 0.001 : 0;
      expect(isCampusWalkingRouteCurrent({
        ...template, nodes, osmWayIds: [101], distanceMeters,
      }, 'fixture', now)).toBe(false);
    }
    for (const nodes of [
      [{ id: 1, lat: 0, lng: 1 }, { id: 2, lat: 0, lng: 1.001 }],
      [{ id: 1, lat: 1, lng: 0 }, { id: 2, lat: 1.001, lng: 0 }],
      [{ id: 1, lat: 10, lng: 179.999 }, { id: 2, lat: 10, lng: -179.999 }],
    ]) {
      const result = solve(nodes)!;
      expect(result.distanceMeters).toBeGreaterThan(0);
      expect(isCampusWalkingRouteCurrent(result, 'fixture', now)).toBe(true);
    }
  });

  it('only returns the documented coordinate fields, not extra upstream node metadata', () => {
    const nodes = graph.nodes.map(node => ({ ...node, internalMetadata: 'synthetic-not-for-route' }));
    const result = route({ ...graph, nodes })!;
    expect(result.nodes).toEqual(route(graph)!.nodes);
    expect(route({ ...graph, nodes }, 1, 1)?.nodes).toEqual([graph.nodes[0]]);
  });

  it('does not mutate the source and preserves the explicit same-node result', () => {
    const result = route(graph, 1, 1);
    expect(result?.distanceMeters).toBe(0);
    expect(result?.osmWayIds).toEqual([]);
    expect(result?.nodes[0]).not.toBe(graph.nodes[0]);
  });

  it('requires a current reviewed incident segment even for same-node arrivals', () => {
    const edge = graph.edges[0];
    const single = { ...graph, edges: [edge] };
    expect(route(single, 1, 1)?.distanceMeters).toBe(0);
    expect(route(single, 3, 3)).toBeNull();
    expect(route({ ...single, edges: [] }, 1, 1)).toBeNull();
    for (const blocked of [
      { ...edge, access: 'unknown' as const },
      { ...edge, access: 'restricted' as const },
      { ...edge, validUntil: '2026-11-24T08:01:00Z' },
      { ...edge, validUntil: undefined },
    ]) {
      expect(route({ ...single, edges: [blocked] }, 1, 1)).toBeNull();
    }
    const oneWay = { ...single, edges: [{ ...edge, direction: 'forward' as const }] };
    expect(route(oneWay, 1, 1)?.distanceMeters).toBe(0);
    expect(route(oneWay, 2, 2)?.distanceMeters).toBe(0);
    expect(route(oneWay, 2, 1)).toBeNull();
  });


  it('exposes chosen path expiry rather than expiry of unrelated edges', () => {
    const expires = '2026-11-25T08:00:00Z';
    const unrelated = '2026-11-24T09:00:00Z';
    const changed = { ...graph, edges: graph.edges.map((edge, i) => ({
      ...edge, validUntil: i === 1 ? expires : i >= 2 ? unrelated : edge.validUntil,
    })) };
    const result = route(changed)!;
    expect(result.nodes.map(n => n.id)).toEqual([1, 2, 3]);
    expect(result.schoolId).toBe('fixture');
    expect(result.osmBaseAt).toBe(graph.osmBaseAt);
    expect(result.reviewExpiresAtMs).toBe(Date.parse(expires));
    expect(route(changed, 3, 1)?.reviewExpiresAtMs).toBe(Date.parse(expires));
    expect(isCampusWalkingRouteCurrent(result, 'fixture', Date.parse(expires) - 1)).toBe(true);
    expect(isCampusWalkingRouteCurrent(result, 'fixture', Date.parse(expires))).toBe(false);
    expect(isCampusWalkingRouteCurrent(result, 'other', now)).toBe(false);
  });

  it('prefers later route audit expiry for equally short parallel ways regardless of input order', () => {
    const early = '2026-11-24T09:00:00Z';
    const late = '2026-11-25T08:00:00Z';
    const edges = [
      { ...graph.edges[0], validUntil: early },
      { ...graph.edges[0], osmWayId: 200, validUntil: late },
      { ...graph.edges[1], validUntil: late },
    ];
    for (const ordered of [edges, [...edges].reverse()]) {
      const result = route({ ...graph, edges: ordered })!;
      expect(result.osmWayIds).toEqual([200, 101]);
      expect(result.reviewExpiresAtMs).toBe(Date.parse(late));
      expect(isCampusWalkingRouteCurrent(result, 'fixture', Date.parse(early))).toBe(true);
      expect(route({ ...graph, edges: ordered }, 3, 1)?.osmWayIds).toEqual([101, 200]);
    }
    const equal = edges.map(edge => ({ ...edge, validUntil: late }));
    expect(route({ ...graph, edges: equal })?.osmWayIds).toEqual([101, 101]);
    expect(route({ ...graph, edges: [...equal].reverse() })?.osmWayIds).toEqual([101, 101]);
  });

  it('compares the minimum expiry across an entire equal-distance route, not just the last edge', () => {
    const early = '2026-11-24T09:00:00Z';
    const late = '2026-11-25T08:00:00Z';
    // Node 5 shares coordinates with node 2 but remains a distinct explicit path.
    const edges = [
      { ...graph.edges[0], validUntil: early },
      { ...graph.edges[1], validUntil: late },
      { ...graph.edges[0], to: 5, osmWayId: 200, validUntil: late },
      { ...graph.edges[1], from: 5, osmWayId: 200, validUntil: late },
    ];
    for (const ordered of [edges, [...edges].reverse()]) {
      const result = route({ ...graph, edges: ordered })!;
      expect(result.nodes.map(n => n.id)).toEqual([1, 5, 3]);
      expect(result.reviewExpiresAtMs).toBe(Date.parse(late));
    }
  });

  it('discards stale queue entries when a shorter path is found after discovery', () => {
    const changed = { ...graph, nodes: graph.nodes.map(node => node.id === 2
      ? { ...node, lat: 10.1005, lng: 20.1 }
      : node.id === 4 ? { ...node, lat: 10.1, lng: 20.101 } : node) };
    expect(route(changed)?.nodes.map(node => node.id)).toEqual([1, 4, 3]);
    expect(route(changed, 3, 1)?.nodes.map(node => node.id)).toEqual([3, 4, 1]);
  });

  it('routes a near-limit connected grid consistently when edge order changes', () => {
    const side = 40;
    const nodes = Array.from({ length: side * side }, (_, index) => ({
      id: index + 1, lat: 10.1 + Math.floor(index / side) * 0.0001,
      lng: 20.1 + index % side * 0.0001,
    }));
    const edges: CampusWalkingGraph['edges'][number][] = [];
    const connect = (from: number, to: number) => edges.push({
      from, to, osmWayId: edges.length + 1, access: 'reviewed-open',
      direction: 'both', ...open,
    });
    for (const node of nodes) {
      if (node.id % side !== 0) connect(node.id, node.id + 1);
      if (node.id + side <= nodes.length) connect(node.id, node.id + side);
    }
    const first = route({ ...graph, nodes, edges }, 1, nodes.length);
    const reversed = route({ ...graph, nodes, edges: [...edges].reverse() }, 1, nodes.length);
    expect(first?.nodes).toHaveLength(2 * side - 1);
    expect(first?.osmWayIds).toHaveLength(2 * side - 2);
    expect(first?.reviewExpiresAtMs).toBe(Date.parse(open.validUntil));
    expect(reversed).toEqual(first);
  });

  it('invalidates cached routes when the snapshot expires or clock is invalid', () => {
    const result = route(graph)!;
    const deadline = Date.parse(graph.osmBaseAt) + 48 * 60 * 60 * 1000;
    expect(isCampusWalkingRouteCurrent(result, 'fixture', deadline)).toBe(true);
    expect(isCampusWalkingRouteCurrent(result, 'fixture', deadline + 1)).toBe(false);
    expect(isCampusWalkingRouteCurrent(result, 'fixture', NaN)).toBe(false);
    expect(isCampusWalkingRouteCurrent({ ...result, reviewExpiresAtMs: NaN }, 'fixture', now)).toBe(false);
  });

  it('uses latest eligible incident expiry for same-node routes, excluding blocked edges', () => {
    const early = '2026-11-24T09:00:00Z';
    const late = '2026-11-25T08:00:00Z';
    const changed = { ...graph, edges: [
      { ...graph.edges[0], validUntil: early },
      { ...graph.edges[2], validUntil: late },
      { ...graph.edges[4], from: 1, access: 'restricted' as const },
    ] };
    const result = route(changed, 1, 1)!;
    expect(result.reviewExpiresAtMs).toBe(Date.parse(late));
    expect(isCampusWalkingRouteCurrent(result, 'fixture', Date.parse(early))).toBe(true);
    expect(isCampusWalkingRouteCurrent(result, 'fixture', Date.parse(late))).toBe(false);
    expect(route(changed, 1, 1, Date.parse(late))).toBeNull();
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
