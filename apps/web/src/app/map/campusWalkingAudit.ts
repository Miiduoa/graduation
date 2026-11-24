import type { CampusWalkingGraph, WalkingEdge, WalkingNode } from './campusWalkingGraph';
import { excludesWalkingWay, hasWalkingRestriction, type CampusWalkingOsmCandidates } from './campusWalkingOsm';

type ReviewedNode = WalkingNode & { version: number };
export type CampusWalkingSegmentAudit = {
  schoolId: string;
  osmWayId: number;
  wayVersion: number;
  // Ordered exactly as the adjacent OSM way nodes; direction is relative to it.
  from: ReviewedNode;
  to: ReviewedNode;
  direction: WalkingEdge['direction'];
  reviewedAt: string;
  validUntil: string;
  evidenceUrl: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Conservative product policy, not a claim about actual campus access hours.
const MAX_AUDIT_AGE_MS = 30 * DAY_MS;
function utcMillis(s: string): number {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s)) return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) && new Date(t).toISOString().replace('.000Z', 'Z') === s ? t : NaN;
}
function evidenceLink(s: string): boolean {
  if (typeof s !== 'string' || s.length > 2048 || !/^https:\/\//.test(s)) return false;
  try {
    const url = new URL(s);
    return !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
const key = (way: number, from: number, to: number) => [way, from, to].join(':');
function matchesNode(review: ReviewedNode, node: ReviewedNode | undefined): boolean {
  return !!node && review.id === node.id && review.version === node.version &&
    review.lat === node.lat && review.lng === node.lng;
}

// An audit may narrow mapped pedestrian access, never contradict it.
// Generic one-way tags on paths/steps are ambiguous without a foot-specific tag.
// https://wiki.openstreetmap.org/wiki/Key:oneway
function permitsAuditedDirection(
  tags: Record<string, string>, direction: WalkingEdge['direction'],
): boolean {
  if (Object.keys(tags).some(k => /^(?:foot|access|oneway)(?::[^:]+)*:conditional$/.test(k))) return false;
  let forward = true;
  let reverse = true;
  const oneway = tags['oneway:foot'];
  if (oneway === 'yes' || oneway === '1' || oneway === 'true') reverse = false;
  else if (oneway === '-1') forward = false;
  else if (oneway !== undefined && !['no', '0', 'false'].includes(oneway)) return false;
  else if (oneway === undefined &&
      ['footway', 'path', 'steps', 'pedestrian'].includes(tags.highway) &&
      tags.oneway !== undefined && !['no', '0', 'false'].includes(tags.oneway)) return false;
  const explicitlyOpen = ['yes', 'designated', 'permissive'];
  for (const prefix of ['foot', 'access']) {
    const f = tags[prefix + ':forward'];
    const r = tags[prefix + ':backward'];
    if (f !== undefined && !explicitlyOpen.includes(f)) forward = false;
    if (r !== undefined && !explicitlyOpen.includes(r)) reverse = false;
  }
  return (direction === 'reverse' || forward) && (direction === 'forward' || reverse);
}

/** Internal bridge from parsed OSM discovery to the route solver.
 * Audits must be supplied by a trusted, separately reviewed server-side
 * catalogue; this checks identity/freshness, not the truth of an evidence URL.
 * Never accept audits from URL params, client forms, or an untrusted payload.
 * Missing, stale, contradictory or restricted segments stay non-routable.
 * No actual entrance, campus access or wheelchair guarantee is inferred.
 */
export function applyCampusWalkingSegmentAudits(
  candidates: CampusWalkingOsmCandidates,
  schoolId: string,
  audits: readonly CampusWalkingSegmentAudit[],
  now: number,
): CampusWalkingGraph | null {
  const base = utcMillis(candidates.osmBaseAt);
  if (!schoolId || candidates.graph.schoolId !== schoolId ||
      candidates.graph.osmBaseAt !== candidates.osmBaseAt || !Number.isFinite(now) ||
      !Number.isFinite(base) || base > now + 5 * 60 * 1000 || now - base > 2 * DAY_MS ||
      candidates.graph.nodes.length > 2000 || candidates.graph.edges.length > 4000 ||
      candidates.nodes.length > 2000 || candidates.ways.length > 4000 ||
      audits.length > 4000) return null;
  const nodes = new Map(candidates.nodes.map(n => [n.id, n]));
  const ways = new Map(candidates.ways.map(w => [w.id, w]));
  if (nodes.size !== candidates.nodes.length || ways.size !== candidates.ways.length) return null;
  // The solver consumes graph.nodes, whereas the audit checks source revisions.
  // Reject drift between these representations rather than routing over coordinates
  // which have never been reviewed (including duplicated or missing identities).
  if (candidates.graph.nodes.length !== nodes.size) return null;
  const graphNodeIds = new Set<number>();
  for (const node of candidates.graph.nodes) {
    const source = nodes.get(node.id);
    if (!source || graphNodeIds.has(node.id) ||
        node.lat !== source.lat || node.lng !== source.lng) return null;
    graphNodeIds.add(node.id);
  }
  const reviews = new Map<string, CampusWalkingSegmentAudit>();
  const duplicates = new Set<string>();
  for (const audit of audits) {
    if (audit.schoolId !== schoolId) continue;
    const segment = key(audit.osmWayId, audit.from.id, audit.to.id);
    if (reviews.has(segment)) duplicates.add(segment);
    reviews.set(segment, audit);
  }

  const eligibleEdges = candidates.graph.edges.filter(edge => {
    const way = ways.get(edge.osmWayId);
    return !way || !excludesWalkingWay(way.tags);
  });
  const edges: WalkingEdge[] = eligibleEdges.map(edge => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    const way = ways.get(edge.osmWayId);
    // Never promote an OSM-tagged restriction, even with an older open audit.
    if (edge.access === 'restricted' ||
        (way && from && to && hasWalkingRestriction(way.tags, from.tags, to.tags))) {
      return { ...edge, access: 'restricted' };
    }
    // Reject any pre-promoted input rather than inheriting untrusted access.
    const blocked: WalkingEdge = { ...edge, access: 'unknown' };
    if (!from || !to || !way || edge.access !== 'unknown') return blocked;
    const segment = key(edge.osmWayId, edge.from, edge.to);
    const audit = reviews.get(segment);
    if (!audit || duplicates.has(segment)) return blocked;
    if (!matchesNode(audit.from, from) || !matchesNode(audit.to, to) ||
        audit.wayVersion !== way.version ||
        !way.nodes.some((id, i) => id === edge.from && way.nodes[i + 1] === edge.to) ||
        !['both', 'forward', 'reverse'].includes(audit.direction) ||
        !evidenceLink(audit.evidenceUrl) ||
        !permitsAuditedDirection(way.tags, audit.direction) ||
        !permitsAuditedDirection(from.tags, 'both') ||
        !permitsAuditedDirection(to.tags, 'both')) return blocked;

    const reviewed = utcMillis(audit.reviewedAt);
    const expiry = utcMillis(audit.validUntil);
    const edited = Math.max(utcMillis(way.editedAt), utcMillis(from.editedAt), utcMillis(to.editedAt));
    if (![reviewed, expiry, edited].every(Number.isFinite) ||
        edited > base || reviewed < edited || reviewed > now || expiry <= now ||
        expiry - reviewed > MAX_AUDIT_AGE_MS) return blocked;
    return { ...edge, access: 'reviewed-open', direction: audit.direction, validUntil: audit.validUntil };
  });
  return {
    schoolId,
    osmBaseAt: candidates.osmBaseAt,
    nodes: candidates.graph.nodes.map(n => ({ ...n })),
    edges,
  };
}
