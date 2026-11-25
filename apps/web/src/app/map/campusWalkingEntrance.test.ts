import { describe, expect, it } from 'vitest';
import { routeToCampusEntrance, type CampusEntranceReview } from './campusWalkingEntrance';
import type { CampusWalkingSegmentAudit } from './campusWalkingAudit';
import { isCampusWalkingRouteCurrent } from './campusWalkingGraph';
import { parseCampusWalkingOsmCandidates } from './campusWalkingOsm';

// Synthetic geometry, IDs, reviews and evidence; not a real campus.
const bounds = { south: 10, north: 10.01, west: 20, east: 20.01 };
const now = Date.parse('2026-11-24T08:01:00Z');
const revision = { version: 1, timestamp: '2026-11-20T00:00:00Z' };
const origin = { id: 1, lat: 10.001, lng: 20.001, version: 1 };
const entrance = { id: 2, lat: 10.001, lng: 20.002, version: 1 };
const destination = { id: 'fixture-building', name: 'Fixture building', category: '教學大樓',
  lat: 10.002, lng: 20.003, building: 'Fixture', floor: '2' };
const candidates = (tags: Record<string, string> = { entrance: 'main' }) =>
  parseCampusWalkingOsmCandidates({
    osm3s: { timestamp_osm_base: '2026-11-24T08:00:00Z' },
    elements: [
      { ...origin, lon: origin.lng, type: 'node', ...revision },
      { ...entrance, lon: entrance.lng, type: 'node', tags, ...revision },
      { id: 101, type: 'way', nodes: [1, 2], tags: { highway: 'footway' }, ...revision },
    ],
  }, 'fixture', bounds, now)!;
const review: CampusEntranceReview = { schoolId: 'fixture', destination, entrance,
  reviewedAt: '2026-11-23T08:00:00Z', validUntil: '2026-11-25T00:00:00Z',
  evidenceUrl: 'https://example.invalid/entrance' };
const segment: CampusWalkingSegmentAudit = { schoolId: 'fixture', osmWayId: 101, wayVersion: 1,
  from: origin, to: entrance, direction: 'both', reviewedAt: review.reviewedAt,
  validUntil: '2026-12-01T00:00:00Z', evidenceUrl: 'https://example.invalid/segment' };
const plan = (reviews: CampusEntranceReview[] = [review], audits = [segment]) =>
  routeToCampusEntrance(candidates(), 'fixture', bounds, 1, destination, reviews, audits, now);

describe('reviewed outdoor entrance route handoff', () => {
  it('ends at the reviewed entrance rather than the marker or indoor floor', () => {
    const result = plan();
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('missing route');
    expect(result.route.nodes.map(node => node.id)).toEqual([1, 2]);
    expect(result.route.nodes[1]).toMatchObject({ lat: entrance.lat, lng: entrance.lng });
    expect(result.route.attribution).toBe('https://www.openstreetmap.org/copyright');
    expect(result.entranceEvidenceUrl).toBe(review.evidenceUrl);
    const expiry = Date.parse(review.validUntil);
    expect(result.route.reviewExpiresAtMs).toBe(expiry);
    expect(isCampusWalkingRouteCurrent(result.route, 'fixture', expiry - 1)).toBe(true);
    expect(isCampusWalkingRouteCurrent(result.route, 'fixture', expiry)).toBe(false);
  });

  it('distinguishes an unverified entrance from an unavailable network', () => {
    expect(plan([]).status).toBe('unverified-entrance');
    expect(plan([review, review]).status).toBe('unverified-entrance');
    expect(plan([{ ...review, schoolId: 'other' }]).status).toBe('unverified-entrance');
    expect(plan([review, { ...review, schoolId: 'other' }]).status).toBe('ready');
    expect(plan([review], []).status).toBe('route-unavailable');
    expect(routeToCampusEntrance(candidates(), 'fixture', bounds, 99, destination,
      [review], [segment], now).status).toBe('route-unavailable');
  });

  it('requires matching destination identity and a current exact source revision', () => {
    for (const changed of [
      { ...destination, name: 'Other' }, { ...destination, category: 'Other' },
      { ...destination, lat: 10.003 }, { ...destination, lng: 20.004 },
      { ...destination, building: 'Other' }, { ...destination, floor: '3' },
    ]) expect(routeToCampusEntrance(candidates(), 'fixture', bounds, 1, changed,
      [review], [segment], now).status).toBe('unverified-entrance');
    for (const changed of [
      { ...review, entrance: { ...entrance, version: 2 } },
      { ...review, entrance: { ...entrance, lng: 20.004 } },
      { ...review, validUntil: '2026-11-24T08:01:00Z' },
      { ...review, reviewedAt: '2026-11-19T00:00:00Z' },
      { ...review, evidenceUrl: 'http://example.invalid/entrance' },
    ]) expect(plan([changed]).status).toBe('unverified-entrance');
    const invalidTags: Record<string, string>[] = [{}, { entrance: 'exit' }, { entrance: 'service' }, { entrance: 'no' }];
    for (const tags of invalidTags) {
      expect(routeToCampusEntrance(candidates(tags), 'fixture', bounds, 1, destination,
        [review], [segment], now).status).toBe('unverified-entrance');
    }
    expect(routeToCampusEntrance(candidates({ entrance: 'main', locked: 'yes' }), 'fixture',
      bounds, 1, destination, [review], [segment], now).status).toBe('route-unavailable');
  });
});
