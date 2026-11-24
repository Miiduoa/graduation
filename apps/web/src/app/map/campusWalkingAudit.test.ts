import { describe, expect, it } from 'vitest';
import { applyCampusWalkingSegmentAudits, type CampusWalkingSegmentAudit } from './campusWalkingAudit';
import { findCampusWalkingRoute } from './campusWalkingGraph';
import { parseCampusWalkingOsmCandidates } from './campusWalkingOsm';

// Synthetic audit fixture: evidence URLs, IDs and coordinates are not campus records.
const bounds = { south: 10, north: 10.01, west: 20, east: 20.01 };
const now = Date.parse('2026-11-24T08:01:00Z');
const revision = { version: 1, timestamp: '2026-11-20T00:00:00Z' };
const points = [1, 2, 3, 4].map(id => ({
  id, type: 'node', lat: 10.001, lon: 20 + id * 0.001, ...revision,
}));
const candidates = () => parseCampusWalkingOsmCandidates({
  osm3s: { timestamp_osm_base: '2026-11-24T08:00:00Z' },
  elements: [...points,
    { type: 'way', id: 101, nodes: [1, 2, 3], tags: { highway: 'footway' }, ...revision },
    { type: 'way', id: 102, nodes: [3, 4], tags: { highway: 'footway', access: 'private' }, ...revision },
  ],
}, 'fixture', bounds, now)!;
const reviewedNode = (id: number) => ({
  id, version: 1, lat: points[id - 1].lat, lng: points[id - 1].lon,
});
const audit = (from = 1, to = 2, patch: Partial<CampusWalkingSegmentAudit> = {}): CampusWalkingSegmentAudit => ({
  schoolId: 'fixture', osmWayId: 101, wayVersion: 1,
  from: reviewedNode(from), to: reviewedNode(to), direction: 'both',
  reviewedAt: '2026-11-23T08:00:00Z', validUntil: '2026-12-01T00:00:00Z',
  evidenceUrl: 'https://example.invalid/synthetic-audit',
  ...patch,
});
const apply = (audits: readonly CampusWalkingSegmentAudit[]) =>
  applyCampusWalkingSegmentAudits(candidates(), 'fixture', audits, now)!;

describe('trusted OSM walking segment audit bridge', () => {
  it('only enables the exact audited segments and honors audited direction', () => {
    const graph = apply([audit(), audit(2, 3, { direction: 'forward' })]);
    expect(graph.edges.map(e => e.access)).toEqual(['reviewed-open', 'reviewed-open', 'restricted']);
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 3, now)?.nodes.map(n => n.id)).toEqual([1, 2, 3]);
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 3, 1, now)).toBeNull();
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 4, now)).toBeNull();
    expect(findCampusWalkingRoute(apply([audit()]), 'fixture', bounds, 1, 3, now)).toBeNull();
    expect(findCampusWalkingRoute(apply([]), 'fixture', bounds, 1, 2, now)).toBeNull();
  });

  it('retains review expiry and OSM snapshot freshness so later routing cannot use an expired graph', () => {
    const graph = apply([audit(), audit(2, 3, { direction: 'forward' })]);
    expect(graph.osmBaseAt).toBe('2026-11-24T08:00:00Z');
    expect(graph.edges.filter(e => e.access === 'reviewed-open').map(e => e.validUntil))
      .toEqual(['2026-12-01T00:00:00Z', '2026-12-01T00:00:00Z']);
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 3, now)?.nodes.map(n => n.id)).toEqual([1, 2, 3]);
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 3, Date.parse('2026-12-01T00:00:00Z'))).toBeNull();
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 3, Date.parse('2026-11-27T08:00:01Z'))).toBeNull();
  });

  it('keeps other-school, changed node, changed way and wrong order audits closed', () => {
    for (const bad of [
      audit(1, 2, { schoolId: 'other' }),
      audit(1, 2, { wayVersion: 2 }),
      audit(1, 2, { from: { ...reviewedNode(1), version: 2 } }),
      audit(1, 2, { to: { ...reviewedNode(2), lng: 20.005 } }),
      audit(2, 1),
      audit(1, 3),
    ]) expect(apply([bad]).edges[0].access).toBe('unknown');
    expect(applyCampusWalkingSegmentAudits(candidates(), 'other', [audit()], now)).toBeNull();
  });

  it('ignores expired, future, excessively long and invalid evidence audits', () => {
    for (const bad of [
      audit(1, 2, { reviewedAt: '2026-11-19T08:00:00Z' }),
      audit(1, 2, { reviewedAt: '2026-11-25T08:00:00Z' }),
      audit(1, 2, { validUntil: '2026-11-24T08:00:00Z' }),
      audit(1, 2, { validUntil: '2027-01-01T00:00:00Z' }),
      audit(1, 2, { reviewedAt: '2026-11-31T08:00:00Z' }),
      audit(1, 2, { evidenceUrl: 'http://example.invalid/audit' }),
      audit(1, 2, { evidenceUrl: 'https://a:b@example.invalid/audit' }),
    ]) expect(apply([bad]).edges[0].access).toBe('unknown');
    expect(applyCampusWalkingSegmentAudits(candidates(), 'fixture', [audit()], now + 3 * 86400000)).toBeNull();
  });

  it('does not override restricted ways, duplicate audits or pre-promoted input', () => {
    expect(apply([audit(3, 4, { osmWayId: 102 })]).edges[2].access).toBe('restricted');
    expect(apply([audit(), audit(1, 2, { direction: 'reverse' })]).edges[0].access).toBe('unknown');
    const data = candidates();
    const dirty = { ...data, graph: { ...data.graph, edges: data.graph.edges.map(e => ({
      ...e, access: 'reviewed-open' as const,
    })) } };
    expect(applyCampusWalkingSegmentAudits(dirty, 'fixture', [audit()], now)?.edges[0].access).toBe('unknown');
    expect(data.graph.edges[0].access).toBe('unknown');
  });

  it('keeps purpose-limited or unrecognised access closed on ways and endpoints', () => {
    const restrictions = ['agricultural', 'forestry', 'delivery', 'emergency',
      'discouraged', 'unknown', 'yes;private', ''];
    for (const key of ['access', 'foot']) {
      for (const value of restrictions) {
        for (const location of ['way', 'from', 'to']) {
          const tags = { [key]: value };
          const data = parseCampusWalkingOsmCandidates({
            osm3s: { timestamp_osm_base: '2026-11-24T08:00:00Z' },
            elements: [
              { ...points[0], tags: location === 'from' ? tags : {} },
              { ...points[1], tags: location === 'to' ? tags : {} },
              { type: 'way', id: 101, nodes: [1, 2],
                tags: { highway: 'footway', ...(location === 'way' ? tags : {}) }, ...revision },
            ],
          }, 'fixture', bounds, now)!;
          expect(data.graph.edges[0].access).toBe('restricted');
          // A stale candidate must not override source restrictions either.
          data.graph.edges[0].access = 'unknown';
          const graph = applyCampusWalkingSegmentAudits(data, 'fixture', [audit()], now)!;
          expect(graph.edges[0].access).toBe('restricted');
          expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 2, now)).toBeNull();
          expect(findCampusWalkingRoute(graph, 'fixture', bounds, 2, 1, now)).toBeNull();
        }
      }
    }
  });

  it('allows explicitly open access only after a matching audit', () => {
    for (const value of ['yes', 'designated', 'permissive']) {
      const data = candidates();
      data.ways[0].tags.foot = value;
      data.ways[0].tags.access = value;
      expect(findCampusWalkingRoute(data.graph, 'fixture', bounds, 1, 2, now)).toBeNull();
      const graph = applyCampusWalkingSegmentAudits(data, 'fixture', [audit()], now)!;
      expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 2, now)).not.toBeNull();
      expect(findCampusWalkingRoute(graph, 'fixture', bounds, 2, 1, now)).not.toBeNull();
    }
  });

  it('excludes a stale candidate edge when the source way directs pedestrians to a sidepath', () => {
    const data = candidates();
    data.ways[0].tags.foot = 'use_sidepath';
    const graph = applyCampusWalkingSegmentAudits(data, 'fixture', [audit()], now)!;
    expect(graph.edges.map(e => e.osmWayId)).toEqual([102]);
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 2, now)).toBeNull();
  });

  it.each(['way', 'from', 'to'] as const)(
    'rechecks the source %s when the graph restriction is overwritten',
    source => {
      const data = candidates();
      const edge = data.graph.edges[2];
      if (source !== 'way') {
        delete data.ways[1].tags.access;
        const endpoint = data.nodes.find(node => node.id === edge[source])!;
        endpoint.tags.barrier = 'gate';
      }
      expect(edge.access).toBe('restricted');
      edge.access = 'unknown';
      const graph = applyCampusWalkingSegmentAudits(data, 'fixture', [audit(3, 4, { osmWayId: 102 })], now)!;
      expect(graph.edges[2].access).toBe('restricted');
      expect(findCampusWalkingRoute(graph, 'fixture', bounds, 3, 4, now)).toBeNull();
    },
  );

  it('rejects graph geometry that does not exactly match audited OSM node identities', () => {
    const data = candidates();
    const [first, second, ...rest] = data.graph.nodes;
    const variants = [
      [{ ...first, lat: first.lat + 0.001 }, second, ...rest],
      [{ ...first, lng: first.lng + 0.001 }, second, ...rest],
      [first, first, ...rest],
      [first, ...rest],
      [first, second, ...rest, { ...first, id: 999 }],
      [{ ...first, id: 999 }, second, ...rest],
    ];
    for (const nodes of variants) {
      const changed = { ...data, graph: { ...data.graph, nodes } };
      expect(applyCampusWalkingSegmentAudits(changed, 'fixture', [audit()], now)).toBeNull();
    }
    // Node order is not an identity change; exact, reordered nodes still work.
    const reordered = { ...data, graph: { ...data.graph, nodes: [...data.graph.nodes].reverse() } };
    const graph = applyCampusWalkingSegmentAudits(reordered, 'fixture', [audit()], now)!;
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 2, now)?.nodes).toEqual([first, second]);
    expect(data.graph.nodes[0]).toEqual(first);
  });

  it('does not let a trusted audit override mapped pedestrian direction', () => {
    const cases: [Record<string, string>, CampusWalkingSegmentAudit['direction'], boolean][] = [
      [{ 'oneway:foot': 'yes' }, 'forward', true],
      [{ 'oneway:foot': 'yes' }, 'reverse', false],
      [{ 'oneway:foot': 'yes' }, 'both', false],
      [{ 'oneway:foot': '-1' }, 'reverse', true],
      [{ 'oneway:foot': '-1' }, 'forward', false],
      [{ 'foot:backward': 'no' }, 'forward', true],
      [{ 'foot:backward': 'no' }, 'both', false],
      [{ 'foot:forward': 'private' }, 'reverse', true],
      [{ 'foot:forward': 'private' }, 'forward', false],
      [{ 'access:backward': 'no' }, 'reverse', false],
      [{ 'oneway:foot': 'yes', 'foot:forward': 'no' }, 'forward', false],
      [{ 'oneway:foot': 'reversible' }, 'both', false],
      [{ 'foot:forward:conditional': 'no @ (Mo-Fr)' }, 'forward', false],
      [{ 'oneway:foot:conditional': 'yes @ (Mo-Fr)' }, 'both', false],
      [{ oneway: 'yes' }, 'forward', false],
      [{ oneway: 'yes', 'oneway:foot': 'no' }, 'both', true],
      [{ highway: 'service', oneway: 'yes' }, 'both', true],
    ];
    for (const [tags, direction, allowed] of cases) {
      const data = parseCampusWalkingOsmCandidates({
        osm3s: { timestamp_osm_base: '2026-11-24T08:00:00Z' },
        elements: [...points,
          { type: 'way', id: 101, nodes: [1, 2], tags: { highway: 'footway', ...tags }, ...revision },
        ],
      }, 'fixture', bounds, now)!;
      const graph = applyCampusWalkingSegmentAudits(data, 'fixture', [audit(1, 2, { direction })], now)!;
      expect(graph.edges[0].access).toBe(allowed ? 'reviewed-open' : 'unknown');
      expect(!!findCampusWalkingRoute(graph, 'fixture', bounds, 1, 2, now)).toBe(allowed && direction !== 'reverse');
      expect(!!findCampusWalkingRoute(graph, 'fixture', bounds, 2, 1, now)).toBe(allowed && direction !== 'forward');
    }
  });

  it('leaves an ambiguously restricted endpoint closed in both directions', () => {
    const data = parseCampusWalkingOsmCandidates({
      osm3s: { timestamp_osm_base: '2026-11-24T08:00:00Z' },
      elements: [{ ...points[0], tags: { 'foot:forward:conditional': 'no @ (Mo-Fr)' } }, points[1],
        { type: 'way', id: 101, nodes: [1, 2], tags: { highway: 'footway' }, ...revision },
      ],
    }, 'fixture', bounds, now)!;
    expect(applyCampusWalkingSegmentAudits(data, 'fixture', [audit()], now)?.edges[0].access).toBe('unknown');
  });
});
