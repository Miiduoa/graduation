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
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 3)?.nodes.map(n => n.id)).toEqual([1, 2, 3]);
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 3, 1)).toBeNull();
    expect(findCampusWalkingRoute(graph, 'fixture', bounds, 1, 4)).toBeNull();
    expect(findCampusWalkingRoute(apply([audit()]), 'fixture', bounds, 1, 3)).toBeNull();
    expect(findCampusWalkingRoute(apply([]), 'fixture', bounds, 1, 2)).toBeNull();
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
});
