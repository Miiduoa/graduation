import type { CampusWalkingGraph, WalkingEdge, WalkingNode } from './campusWalkingGraph';
import type { CampusWalkingOsmCandidates } from './campusWalkingOsm';

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
  if (!schoolId || candidates.graph.schoolId !== schoolId || !Number.isFinite(now) ||
      !Number.isFinite(base) || base > now + 5 * 60 * 1000 || now - base > 2 * DAY_MS ||
      candidates.graph.nodes.length > 2000 || candidates.graph.edges.length > 4000 ||
      candidates.nodes.length > 2000 || candidates.ways.length > 4000 ||
      audits.length > 4000) return null;
  const nodes = new Map(candidates.nodes.map(n => [n.id, n]));
  const ways = new Map(candidates.ways.map(w => [w.id, w]));
  if (nodes.size !== candidates.nodes.length || ways.size !== candidates.ways.length) return null;
  const reviews = new Map<string, CampusWalkingSegmentAudit>();
  const duplicates = new Set<string>();
  for (const audit of audits) {
    if (audit.schoolId !== schoolId) continue;
    const segment = key(audit.osmWayId, audit.from.id, audit.to.id);
    if (reviews.has(segment)) duplicates.add(segment);
    reviews.set(segment, audit);
  }

  const edges: WalkingEdge[] = candidates.graph.edges.map(edge => {
    // Never promote an OSM-tagged restriction, even with an older open audit.
    // Reject any pre-promoted input rather than inheriting untrusted access.
    const blocked: WalkingEdge = { ...edge, access: edge.access === 'restricted' ? 'restricted' : 'unknown' };
    if (edge.access !== 'unknown') return blocked;
    const segment = key(edge.osmWayId, edge.from, edge.to);
    const audit = reviews.get(segment);
    if (!audit || duplicates.has(segment)) return blocked;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    const way = ways.get(edge.osmWayId);
    if (!from || !to || !way ||
        !matchesNode(audit.from, from) || !matchesNode(audit.to, to) ||
        audit.wayVersion !== way.version ||
        !way.nodes.some((id, i) => id === edge.from && way.nodes[i + 1] === edge.to) ||
        !['both', 'forward', 'reverse'].includes(audit.direction) ||
        !evidenceLink(audit.evidenceUrl)) return blocked;

    const reviewed = utcMillis(audit.reviewedAt);
    const expiry = utcMillis(audit.validUntil);
    const edited = Math.max(utcMillis(way.editedAt), utcMillis(from.editedAt), utcMillis(to.editedAt));
    if (![reviewed, expiry, edited].every(Number.isFinite) ||
        reviewed < edited || reviewed > now || expiry <= now ||
        expiry - reviewed > MAX_AUDIT_AGE_MS) return blocked;
    return { ...edge, access: 'reviewed-open', direction: audit.direction };
  });
  return {
    schoolId,
    nodes: candidates.graph.nodes.map(n => ({ ...n })),
    edges,
  };
}
