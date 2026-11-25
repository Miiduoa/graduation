import type { MapLocation } from './mapService';
import { applyCampusWalkingSegmentAudits, type CampusWalkingSegmentAudit } from './campusWalkingAudit';
import { findCampusWalkingRoute, isCampusWalkingRouteCurrent, type CampusWalkingBounds, type CampusWalkingRoute, type WalkingNode } from './campusWalkingGraph';
import type { CampusWalkingOsmCandidates } from './campusWalkingOsm';

type Destination = Pick<MapLocation, 'id' | 'name' | 'category' | 'lat' | 'lng' | 'building' | 'floor'>;

export type CampusEntranceReview = {
  schoolId: string;
  destination: Destination;
  entrance: WalkingNode & { version: number };
  reviewedAt: string;
  validUntil: string;
  evidenceUrl: string;
};

type EntranceRouteResult =
  | { status: 'unverified-entrance' | 'route-unavailable' }
  | { status: 'ready'; route: CampusWalkingRoute; entranceEvidenceUrl: string; destination: Readonly<Destination> };

function sameDestination(a: Destination, b: Destination): boolean {
  return a.id === b.id && a.name === b.name && a.category === b.category &&
    a.lat === b.lat && a.lng === b.lng && a.building === b.building && a.floor === b.floor;
}

/** Before displaying a previously planned entrance route, verify that the
 * current school, exact origin, destination and OSM snapshot still match.
 * Only for results from the trusted planner; replan on audit/catalogue changes.
 */
export function isCampusEntranceRouteCurrent(
  result: EntranceRouteResult,
  schoolId: string,
  originNodeId: number,
  destination: Destination,
  osmBaseAt: string,
  now: number,
): boolean {
  return result.status === 'ready' &&
    result.route.nodes[0]?.id === originNodeId &&
    result.route.osmBaseAt === osmBaseAt &&
    sameDestination(result.destination, destination) &&
    isCampusWalkingRouteCurrent(result.route, schoolId, now);
}

const MAX_REVIEW_MS = 30 * 86400000;
function utcMillis(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().replace('.000Z', 'Z') === value ? ms : NaN;
}
function validEvidence(value: string): boolean {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('https://')) return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

/**
 * Resolve a map destination to an independently reviewed entrance on an audited
 * outdoor network. The catalogue, bounds and exact origin node must come from
 * trusted campus data; do not derive them from a GPS snap or user-submitted audit.
 * A ready result means a route to the entrance only, never to an indoor room.
 */
export function routeToCampusEntrance(
  candidates: CampusWalkingOsmCandidates,
  schoolId: string,
  bounds: CampusWalkingBounds,
  originNodeId: number,
  destination: Destination,
  entranceReviews: readonly CampusEntranceReview[],
  segmentAudits: readonly CampusWalkingSegmentAudit[],
  now: number,
): EntranceRouteResult {
  if (!schoolId || candidates.graph.schoolId !== schoolId || !Number.isFinite(now) ||
      !destination.id || !destination.name || !Number.isFinite(destination.lat) ||
      !Number.isFinite(destination.lng) || entranceReviews.length > 2000) {
    return { status: 'unverified-entrance' };
  }
  const matches = entranceReviews.filter(review =>
    review.schoolId === schoolId && review.destination.id === destination.id);
  if (matches.length !== 1) return { status: 'unverified-entrance' };
  const review = matches[0];
  const place = review.destination;
  if (!sameDestination(place, destination)) {
    return { status: 'unverified-entrance' };
  }
  const reviewed = utcMillis(review.reviewedAt);
  const expiry = utcMillis(review.validUntil);
  const base = utcMillis(candidates.osmBaseAt);
  const entrance = review.entrance;
  const source = candidates.nodes.find(node => node.id === entrance.id);
  const edited = source ? utcMillis(source.editedAt) : NaN;
  if (!source || !Number.isSafeInteger(entrance.id) || entrance.id <= 0 ||
      !Number.isSafeInteger(entrance.version) || entrance.version <= 0 ||
      source.version !== entrance.version || source.lat !== entrance.lat || source.lng !== entrance.lng ||
      ![reviewed, expiry, base, edited].every(Number.isFinite) || edited > base ||
      reviewed < edited || reviewed > now || expiry <= now || expiry - reviewed > MAX_REVIEW_MS ||
      !validEvidence(review.evidenceUrl)) {
    return { status: 'unverified-entrance' };
  }
  // Require an explicit entrance tag; do not reinterpret exits, service doors
  // or an ordinary path node as a verified public building entrance.
  if (!['yes', 'main', 'secondary'].includes(source.tags?.entrance ?? '')) {
    return { status: 'unverified-entrance' };
  }
  const graph = applyCampusWalkingSegmentAudits(candidates, schoolId, segmentAudits, now);
  const route = graph && findCampusWalkingRoute(graph, schoolId, bounds, originNodeId, entrance.id, now);
  if (!route) return { status: 'route-unavailable' };
  return {
    status: 'ready',
    route: { ...route, reviewExpiresAtMs: Math.min(route.reviewExpiresAtMs, expiry) },
    entranceEvidenceUrl: review.evidenceUrl,
    destination: { id: destination.id, name: destination.name, category: destination.category,
      lat: destination.lat, lng: destination.lng, building: destination.building, floor: destination.floor },
  };
}
