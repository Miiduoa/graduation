/** Outdoor route calculation over a separately audited OSM graph.
 * Never snaps a POI to a path or infers connectivity from crossing coordinates.
 * The caller must supply a trusted, school-scoped audit; this module does not
 * establish actual access, entrance location, wheelchair suitability or freshness.
 */
export type WalkingNode = { id: number; lat: number; lng: number };
export type WalkingEdge = {
  from: number; to: number; osmWayId: number;
  access: 'reviewed-open' | 'unknown' | 'restricted';
  direction: 'both' | 'forward' | 'reverse';
  validUntil?: string;
};
export type CampusWalkingGraph = {
  schoolId: string;
  osmBaseAt: string;
  nodes: readonly WalkingNode[];
  edges: readonly WalkingEdge[];
};
export type CampusWalkingBounds = {
  south: number; north: number; west: number; east: number;
};
export type CampusWalkingRoute = {
  schoolId: string;
  osmBaseAt: string;
  /** Earliest traversed audit expiry; for zero distance, latest eligible incident audit expiry. */
  reviewExpiresAtMs: number;
  nodes: WalkingNode[];
  osmWayIds: number[];
  distanceMeters: number;
  attribution: 'https://www.openstreetmap.org/copyright';
};

function validId(id: number) {
  return Number.isSafeInteger(id) && id > 0;
}

function segmentMeters(a: WalkingNode, b: WalkingNode): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Shortest distance along explicit reviewed segments, or null when unavailable.
 * IDs must refer to exact audited nodes, not building centroid IDs.
 * Bounds must come from trusted campus configuration, not the graph payload.
 * Unknown/restricted edges are deliberately excluded; no straight-line fallback.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OSM_LAG_MS = 2 * DAY_MS;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function utcMillis(value: string | undefined) {
  // Match the OSM parser and audit bridge: no local-time, date-only or
  // calendar-normalized timestamps can establish freshness or expiry.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().replace('.000Z', 'Z') === value ? ms : NaN;
}

export function osmSnapshotIsFresh(osmBaseAt: string | undefined, now: number) {
  const base = utcMillis(osmBaseAt);
  return Number.isFinite(now) && Number.isFinite(base) && base <= now + MAX_CLOCK_SKEW_MS && now - base <= MAX_OSM_LAG_MS;
}

/** Recheck a cached route before use or after resume in a school-scoped UI.
 * Freshness only, not a substitute for trusted source/audit validation.
 */
export function isCampusWalkingRouteCurrent(
  route: CampusWalkingRoute, schoolId: string, now: number = Date.now(),
): boolean {
  return !!schoolId && !!route && route.schoolId === schoolId && Number.isFinite(now) &&
    osmSnapshotIsFresh(route.osmBaseAt, now) &&
    Number.isFinite(route.reviewExpiresAtMs) && now < route.reviewExpiresAtMs;
}

function reviewedOpenExpiry(edge: WalkingEdge, now: number): number | null {
  if (edge.access !== 'reviewed-open') return null;
  const expiry = utcMillis(edge.validUntil);
  return Number.isFinite(expiry) && expiry > now ? expiry : null;
}

export function findCampusWalkingRoute(
  graph: CampusWalkingGraph, schoolId: string, bounds: CampusWalkingBounds,
  start: number, end: number, now: number = Date.now(),
): CampusWalkingRoute | null {
  if (!schoolId || !graph || !bounds || graph.schoolId !== schoolId || !validId(start) || !validId(end) ||
      !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) ||
      graph.nodes.length > 2000 || graph.edges.length > 4000 ||
      !Number.isFinite(now) ||
      !osmSnapshotIsFresh(graph.osmBaseAt, now) ||
      ![bounds.south, bounds.north, bounds.west, bounds.east].every(Number.isFinite) ||
      bounds.south < -90 || bounds.north > 90 || bounds.west < -180 || bounds.east > 180 ||
      bounds.south >= bounds.north || bounds.west >= bounds.east) return null;

  const nodes = new Map<number, WalkingNode>();
  for (const node of graph.nodes) {
    if (!node || typeof node !== 'object' || !validId(node.id) || nodes.has(node.id) ||
        !Number.isFinite(node.lat) || !Number.isFinite(node.lng) ||
        node.lat < bounds.south || node.lat > bounds.north ||
        node.lng < bounds.west || node.lng > bounds.east) return null;
    nodes.set(node.id, node);
  }
  if (!nodes.has(start) || !nodes.has(end)) return null;

  type Arc = { to: number; way: number; meters: number; expiresAt: number };
  const adjacency = new Map<number, Arc[]>();
  const add = (from: number, arc: Arc) => {
    const arcs = adjacency.get(from) ?? [];
    arcs.push(arc);
    adjacency.set(from, arcs);
  };
  const seen = new Set<string>();
  let sameNodeReviewExpiry = -Infinity;
  for (const edge of graph.edges) {
    if (!edge || typeof edge !== 'object') return null;
    const a = nodes.get(edge.from);
    const b = nodes.get(edge.to);
    if (!a || !b || a.id === b.id || !validId(edge.osmWayId) ||
        !['reviewed-open', 'unknown', 'restricted'].includes(edge.access) ||
        !['both', 'forward', 'reverse'].includes(edge.direction)) return null;
    // Conflicting or repeated declarations of the same way segment cannot be
    // resolved by input order, even when one of them is marked restricted.
    const key = [edge.osmWayId, Math.min(a.id, b.id), Math.max(a.id, b.id)].join(':');
    if (seen.has(key)) return null;
    seen.add(key);
    const meters = segmentMeters(a, b);
    if (!Number.isFinite(meters) || meters <= 0) return null;
    const expiresAt = reviewedOpenExpiry(edge, now);
    if (expiresAt === null) continue;
    if (start === end && (edge.from === start || edge.to === start)) {
      sameNodeReviewExpiry = Math.max(sameNodeReviewExpiry, expiresAt);
    }
    if (edge.direction !== 'reverse') add(a.id, { to: b.id, way: edge.osmWayId, meters, expiresAt });
    if (edge.direction !== 'forward') add(b.id, { to: a.id, way: edge.osmWayId, meters, expiresAt });
  }

  // A zero-distance result still represents a location on the reviewed network.
  // A discovered but isolated, restricted or expired node is not a verified arrival.
  if (start === end && !Number.isFinite(sameNodeReviewExpiry)) return null;

  // Bounded Dijkstra with a binary min-heap. Keep the distance, expiry and
  // node-ID ordering identical to the linear scan without revisiting settled
  // nodes on every iteration. Stale entries are discarded on removal.
  const distance = new Map<number, number>([[start, 0]]);
  const pathExpiry = new Map<number, number>([[start, Infinity]]);
  const previous = new Map<number, { from: number; way: number; expiresAt: number }>();
  const settled = new Set<number>();
  type QueueEntry = { id: number; cost: number; expiry: number };
  const queue: QueueEntry[] = [];
  const precedes = (a: QueueEntry, b: QueueEntry) =>
    a.cost < b.cost || (a.cost === b.cost &&
      (a.expiry > b.expiry || (a.expiry === b.expiry && a.id < b.id)));
  const enqueue = (entry: QueueEntry) => {
    let index = queue.length;
    queue.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!precedes(entry, queue[parent])) break;
      queue[index] = queue[parent];
      index = parent;
    }
    queue[index] = entry;
  };
  const dequeue = (): QueueEntry | undefined => {
    const first = queue[0];
    const last = queue.pop();
    if (last === undefined || queue.length === 0) return first;
    let index = 0;
    while (2 * index + 1 < queue.length) {
      let child = 2 * index + 1;
      const right = child + 1;
      if (right < queue.length && precedes(queue[right], queue[child])) child = right;
      if (!precedes(queue[child], last)) break;
      queue[index] = queue[child];
      index = child;
    }
    queue[index] = last;
    return first;
  };
  enqueue({ id: start, cost: 0, expiry: Infinity });
  while (true) {
    const entry = dequeue();
    if (!entry) return null;
    const { id: current, cost: best, expiry: bestExpiry } = entry;
    if (settled.has(current) || distance.get(current) !== best ||
        pathExpiry.get(current) !== bestExpiry) continue;
    if (current === end) break;
    settled.add(current);
    for (const arc of adjacency.get(current) ?? []) {
      const cost = best + arc.meters;
      const expiry = Math.min(bestExpiry, arc.expiresAt);
      const oldCost = distance.get(arc.to) ?? Infinity;
      const oldExpiry = pathExpiry.get(arc.to) ?? -Infinity;
      const oldStep = previous.get(arc.to);
      // Stable provenance for parallel ways with identical distance and expiry.
      const preferredWay = oldStep?.from === current && arc.way < oldStep.way;
      if (!settled.has(arc.to) && (cost < oldCost || (cost === oldCost &&
          (expiry > oldExpiry || (expiry === oldExpiry && preferredWay))))) {
        distance.set(arc.to, cost);
        pathExpiry.set(arc.to, expiry);
        previous.set(arc.to, { from: current, way: arc.way, expiresAt: arc.expiresAt });
        if (cost !== oldCost || expiry !== oldExpiry) {
          enqueue({ id: arc.to, cost, expiry });
        }
      }
    }
  }

  const routeNodes: WalkingNode[] = [];
  const osmWayIds: number[] = [];
  let reviewExpiresAtMs = start === end ? sameNodeReviewExpiry : Infinity;
  let current = end;
  for (;;) {
    const node = nodes.get(current);
    if (!node) return null;
    routeNodes.push({ ...node });
    if (current === start) break;
    const step = previous.get(current);
    if (!step) return null;
    osmWayIds.push(step.way);
    reviewExpiresAtMs = Math.min(reviewExpiresAtMs, step.expiresAt);
    current = step.from;
  }
  return {
    schoolId, osmBaseAt: graph.osmBaseAt, reviewExpiresAtMs,
    nodes: routeNodes.reverse(), osmWayIds: osmWayIds.reverse(),
    distanceMeters: distance.get(end) ?? 0,
    attribution: 'https://www.openstreetmap.org/copyright',
  };
}
