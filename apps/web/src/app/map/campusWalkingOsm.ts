import type { CampusWalkingBounds, CampusWalkingGraph, WalkingEdge, WalkingNode } from './campusWalkingGraph';

// Discovery only. OSM tags, geometry and recent revisions are NOT a campus
// access audit. Never expose this candidate graph as a usable walking route.
const HIGHWAYS = ['footway', 'path', 'pedestrian', 'steps', 'service', 'living_street', 'residential'];
const MAX_NODES = 2000;
const MAX_EDGES = 4000;
// Separate work budget: discarded/duplicate outside ways still cost parser CPU.
// Allow headroom for clipping and duplicates without unbounded member scans.
const MAX_RAW_WAY_REFERENCES = 4 * MAX_EDGES;
const MAX_LAG_MS = 48 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const ATTRIBUTION = 'https://www.openstreetmap.org/copyright' as const;
type Tags = Record<string, string>;
type Revision = { version: number; editedAt: string; tags: Tags };
type CandidateNode = WalkingNode & Revision;
type CandidateWay = Revision & { id: number; nodes: number[] };

export type CampusWalkingOsmCandidates = {
  osmBaseAt: string;
  attribution: typeof ATTRIBUTION;
  // Only unknown/restricted edges; explicit audit is a separate step.
  graph: CampusWalkingGraph;
  nodes: CandidateNode[];
  ways: CandidateWay[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function dateMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().replace('.000Z', 'Z') === value ? ms : null;
}
function validBounds(b: CampusWalkingBounds): boolean {
  return [b.south, b.north, b.west, b.east].every(Number.isFinite) &&
    b.south >= -90 && b.north <= 90 && b.west >= -180 && b.east <= 180 &&
    b.south < b.north && b.west < b.east &&
    b.north - b.south <= 0.05 && b.east - b.west <= 0.05;
}
function inBounds(n: Pick<WalkingNode, 'lat' | 'lng'>, b: CampusWalkingBounds): boolean {
  return n.lat >= b.south && n.lat <= b.north && n.lng >= b.west && n.lng <= b.east;
}

/** Caller must use trusted campus configuration, never URL/user-supplied bounds.
 * Explicit way and node metadata preserve topology and evidence for later audit.
 * The query is for bounded, offline/admin discovery; no public fetch endpoint.
 */
export function buildCampusWalkingOverpassQuery(bounds: CampusWalkingBounds): string | null {
  if (!validBounds(bounds)) return null;
  const bbox = [bounds.south, bounds.west, bounds.north, bounds.east].join(',');
  return '[out:json][timeout:8][maxsize:67108864];(way["highway"~"^(' +
    HIGHWAYS.join('|') + ')$"](' + bbox + ');>;);out meta;';
}

// Cached candidates must satisfy the same tag constraints as fresh Overpass JSON.
export function validWalkingSourceTags(value: unknown): value is Tags {
  const raw = record(value);
  if (!raw) return false;
  const entries = Object.entries(raw);
  return entries.length <= 128 && entries.every(([key, val]) =>
    key.length > 0 && key.length <= 255 && typeof val === 'string' &&
    val.length <= 1024 && !['__proto__', 'constructor', 'prototype'].includes(key));
}

function revision(value: Record<string, unknown>, baseMs: number): Revision | null {
  const editedAt = value.timestamp;
  const editedMs = dateMillis(editedAt);
  if (!positiveId(value.version) || typeof editedAt !== 'string' ||
      editedMs === null || editedMs > baseMs) return null;
  const raw = value.tags === undefined ? {} : record(value.tags);
  if (!validWalkingSourceTags(raw)) return null;
  const tags: Tags = { ...raw };
  return { version: value.version, editedAt, tags };
}

// Tunnel tags can identify enclosed passages without a separate location tag.
// https://wiki.openstreetmap.org/wiki/Key:tunnel
const NEGATIVE_TUNNEL_VALUES = new Set(['no', 'false', '0']);
const NON_OUTDOOR_LOCATIONS = new Set(['indoor', 'underground', 'underwater']);
const nonOutdoor = (tags: Tags) =>
  (tags.indoor !== undefined && tags.indoor !== 'no') ||
  NON_OUTDOOR_LOCATIONS.has(tags.location?.trim().toLowerCase()) ||
  (tags.tunnel !== undefined && !NEGATIVE_TUNNEL_VALUES.has(tags.tunnel.trim().toLowerCase()));

export const excludesWalkingWay = (tags: Tags) =>
  // Cached source tags must still match the same discovery allowlist.
  !HIGHWAYS.includes(tags.highway) ||
  tags.foot === 'use_sidepath' ||
  !!(tags.area && tags.area !== 'no') ||
  nonOutdoor(tags);

// Product policy: an unrecognised or purpose-limited access value needs
// further review, not a blanket walking approval. Retain the conservative
// treatment of conflicting general and pedestrian-specific restrictions.
// https://wiki.openstreetmap.org/wiki/Key:access
const OPEN_ACCESS_VALUES = new Set(['yes', 'designated', 'permissive']);
const hasNonPublicAccess = (value: string | undefined): boolean =>
  value !== undefined && !OPEN_ACCESS_VALUES.has(value);

const restrictsWalking = (tags: Tags) =>
  nonOutdoor(tags) ||
  hasNonPublicAccess(tags.foot) ||
  hasNonPublicAccess(tags.access) ||
  // Motorroad commonly implies motor-vehicle-only access; conflicting or
  // unrecognised values must not be promoted to a reviewed walking route.
  // https://wiki.openstreetmap.org/wiki/Tag:motorroad=yes
  (tags.motorroad !== undefined && !['no', 'false', '0'].includes(tags.motorroad)) ||
  tags['motorroad:conditional'] !== undefined ||
  // Conflicting direct lifecycle tags require review, including endpoints
  // that lack a highway key. Historical namespace tags alone may describe
  // a repurposed, usable path.
  // https://wiki.openstreetmap.org/wiki/Lifecycle_prefix
  ['construction', 'disused', 'abandoned'].some(key =>
    tags[key] !== undefined && !['no', 'false', '0'].includes(tags[key])) ||
  !!(tags.barrier && tags.barrier !== 'no') ||
  // Locked gates/doors may lack a separate barrier tag. A conditional lock
  // or malformed access schedule is not a verified all-hours passage.
  // Explicit negatives match motorroad and lifecycle so locked=false/0
  // is not treated as a restriction.
  // https://wiki.openstreetmap.org/wiki/Key:locked
  (tags.locked !== undefined && !['no', 'false', '0'].includes(tags.locked)) ||
  tags['locked:conditional'] !== undefined ||
  // A conditional door/gate opening schedule or legacy access-time tags
  // cannot establish an all-hours route. open=no alone only describes the
  // default physical state (a door may be unlocked and manually operable).
  // https://wiki.openstreetmap.org/wiki/Key:open
  // https://wiki.openstreetmap.org/wiki/Key:access
  tags['open:conditional'] !== undefined ||
  ['date_on', 'date_off', 'day_on', 'day_off', 'hour_on', 'hour_off'].some(key => tags[key] !== undefined) ||
  tags['access:conditional'] !== undefined || tags['foot:conditional'] !== undefined ||
  tags.opening_hours !== undefined;

export function hasWalkingRestriction(way: Tags, from: Tags, to: Tags): boolean {
  return restrictsWalking(way) || restrictsWalking(from) || restrictsWalking(to);
}

// An identity is ambiguous if either occurrence can contribute to the graph.
function hasInScopeDuplicate(scopes: Map<number, boolean>, id: number, inside: boolean): boolean {
  if (scopes.has(id)) return inside || scopes.get(id) === true;
  scopes.set(id, inside);
  return false;
}

/** Reject partial, stale or malformed Overpass JSON. Exact OSM node identity,
 * not coordinate proximity, defines connectivity. Out-of-bounds segments are
 * omitted without clipping, snapping or jumping over missing nodes.
 */
export function parseCampusWalkingOsmCandidates(
  payload: unknown, schoolId: string, bounds: CampusWalkingBounds, now: number,
): CampusWalkingOsmCandidates | null {
  if (!schoolId.trim() || !validBounds(bounds) || !Number.isFinite(now)) return null;
  const root = record(payload);
  const metadata = record(root?.osm3s);
  const osmBaseAt = metadata?.timestamp_osm_base;
  const baseMs = dateMillis(osmBaseAt);
  if (!root || 'remark' in root || typeof osmBaseAt !== 'string' || baseMs === null ||
      baseMs > now + MAX_CLOCK_SKEW_MS || now - baseMs > MAX_LAG_MS ||
      !Array.isArray(root.elements) || root.elements.length > MAX_NODES + MAX_EDGES) return null;

  const nodeScopes = new Map<number, boolean>();
  const invalidOutsideNodeIds = new Set<unknown>();
  const nodes = new Map<number, CandidateNode>();
  const rawWays: Record<string, unknown>[] = [];
  let rawReferences = 0;
  for (const raw of root.elements) {
    const item = record(raw);
    if (!item) return null;
    if (item.type === 'way') {
      if (!Array.isArray(item.nodes)) return null;
      rawReferences += item.nodes.length;
      if (rawReferences > MAX_RAW_WAY_REFERENCES) return null;
      rawWays.push(item);
      continue;
    }
    if (item.type !== 'node' || typeof item.lat !== 'number' || typeof item.lon !== 'number' ||
        !Number.isFinite(item.lat) || !Number.isFinite(item.lon) ||
        Math.abs(item.lat) > 90 || Math.abs(item.lon) > 180) return null;
    const coordinates = { lat: item.lat, lng: item.lon };
    const inside = inBounds(coordinates, bounds);
    if (!positiveId(item.id)) {
      if (inside) return null;
      if (item.id !== undefined) invalidOutsideNodeIds.add(item.id);
      continue;
    }
    const node = { id: item.id, ...coordinates };
    if (hasInScopeDuplicate(nodeScopes, node.id, inside)) return null;
    if (nodeScopes.size > MAX_NODES) return null;
    if (!inside) continue;
    const rev = revision(item, baseMs);
    if (!rev) return null;
    nodes.set(node.id, { ...node, ...rev });
  }

  const wayScopes = new Map<number, boolean>();
  const ways = new Map<number, CandidateWay>();
  for (const item of rawWays) {
    if (!Array.isArray(item.nodes)) return null;
    const ids: unknown[] = item.nodes;
    let hasCampusNode = false;
    let hasMissingNode = false;
    let hasMissingEndpoint = false;
    for (const [index, id] of ids.entries()) {
      const scope = positiveId(id) ? nodeScopes.get(id) :
        invalidOutsideNodeIds.has(id) ? false : undefined;
      if (scope === true) hasCampusNode = true;
      if (scope === undefined) {
        hasMissingNode = true;
        if (index === 0 || index === ids.length - 1) hasMissingEndpoint = true;
      }
    }

    // Discard incomplete ways only when both endpoints are known outside
    // (or the sole node is known outside) and no member is known inside.
    const incomplete = ids.length < 2 || hasMissingNode;
    if (incomplete && (hasCampusNode || hasMissingEndpoint || ids.length === 0)) return null;
    const validReferences = ids.every(positiveId);
    if (!validReferences && hasCampusNode) return null;
    if (!positiveId(item.id)) {
      if (hasCampusNode) return null;
      continue;
    }
    const repeated = wayScopes.has(item.id);
    if (hasInScopeDuplicate(wayScopes, item.id, hasCampusNode)) return null;
    if (repeated) {
      ways.delete(item.id);
      continue;
    }
    if (incomplete || !validReferences) continue;
    const rev = revision(item, baseMs);
    if (!rev || !HIGHWAYS.includes(rev.tags.highway)) {
      if (hasCampusNode) return null;
      continue;
    }
    ways.set(item.id, { id: item.id, nodes: ids, ...rev });
  }

  // Only retained ways consume the segment budget.
  let references = 0;
  for (const way of ways.values()) {
    references += way.nodes.length - 1;
    if (references > MAX_EDGES) return null;
  }
  const edges: WalkingEdge[] = [];
  const seen = new Set<string>();
  for (const way of ways.values()) {
    if (!wayScopes.get(way.id) || excludesWalkingWay(way.tags)) continue;
    for (let i = 1; i < way.nodes.length; i += 1) {
      const a = nodes.get(way.nodes[i - 1]);
      const b = nodes.get(way.nodes[i]);
      // Out-of-bounds segments are not candidates; do not fail the whole batch
      // because a skipped way has duplicate or coincident nodes.
      if (!a || !b) continue;
      const key = [way.id, Math.min(a.id, b.id), Math.max(a.id, b.id)].join(':');
      if (a.id === b.id || seen.has(key) || (a.lat === b.lat && a.lng === b.lng)) return null;
      seen.add(key);
      // "both" is a placeholder on a non-routable edge, not a direction audit.
      // Preserve all tags/revisions above for explicit review before promotion.
      edges.push({ from: a.id, to: b.id, osmWayId: way.id, direction: 'both',
        access: hasWalkingRestriction(way.tags, a.tags, b.tags) ? 'restricted' : 'unknown' });
    }
  }
  const inside = [...nodes.values()];
  return {
    osmBaseAt, attribution: ATTRIBUTION, nodes: inside,
    ways: [...ways.values()].map(way => ({ ...way, nodes: [...way.nodes] })),
    graph: { schoolId, osmBaseAt, nodes: inside.map(({ id, lat, lng }) => ({ id, lat, lng })), edges },
  };
}
