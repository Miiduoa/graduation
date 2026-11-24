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
  return Number.isFinite(base) && base <= now + MAX_CLOCK_SKEW_MS && now - base <= MAX_OSM_LAG_MS;
}

function reviewedOpenAt(edge: WalkingEdge, now: number) {
  if (edge.access !== 'reviewed-open') return false;
  const expiry = utcMillis(edge.validUntil);
  return Number.isFinite(expiry) && expiry > now;
}

export function findCampusWalkingRoute(
  graph: CampusWalkingGraph, schoolId: string, bounds: CampusWalkingBounds,
  start: number, end: number, now: number = Date.now(),
): CampusWalkingRoute | null {
  if (!schoolId || graph.schoolId !== schoolId || !validId(start) || !validId(end) ||
      graph.nodes.length > 2000 || graph.edges.length > 4000 ||
      !Number.isFinite(now) ||
      !osmSnapshotIsFresh(graph.osmBaseAt, now) ||
      ![bounds.south, bounds.north, bounds.west, bounds.east].every(Number.isFinite) ||
      bounds.south < -90 || bounds.north > 90 || bounds.west < -180 || bounds.east > 180 ||
      bounds.south >= bounds.north || bounds.west >= bounds.east) return null;

  const nodes = new Map<number, WalkingNode>();
  for (const node of graph.nodes) {
    if (!validId(node.id) || nodes.has(node.id) ||
        !Number.isFinite(node.lat) || !Number.isFinite(node.lng) ||
        node.lat < bounds.south || node.lat > bounds.north ||
        node.lng < bounds.west || node.lng > bounds.east) return null;
    nodes.set(node.id, node);
  }
  if (!nodes.has(start) || !nodes.has(end)) return null;

  type Arc = { to: number; way: number; meters: number };
  const adjacency = new Map<number, Arc[]>();
  const add = (from: number, arc: Arc) => {
    const arcs = adjacency.get(from) ?? [];
    arcs.push(arc);
    adjacency.set(from, arcs);
  };
  const seen = new Set<string>();
  for (const edge of graph.edges) {
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
    if (!reviewedOpenAt(edge, now)) continue;
    if (edge.direction !== 'reverse') add(a.id, { to: b.id, way: edge.osmWayId, meters });
    if (edge.direction !== 'forward') add(b.id, { to: a.id, way: edge.osmWayId, meters });
  }

  // Bounded Dijkstra; only positive, sourced graph edges can be traversed.
  const distance = new Map<number, number>([[start, 0]]);
  const previous = new Map<number, { from: number; way: number }>();
  const settled = new Set<number>();
  while (true) {
    let current: number | undefined;
    let best = Infinity;
    for (const [id, cost] of distance) {
      if (!settled.has(id) && (cost < best || (cost === best && current !== undefined && id < current))) {
        current = id;
        best = cost;
      }
    }
    if (current === undefined) return null;
    if (current === end) break;
    settled.add(current);
    for (const arc of adjacency.get(current) ?? []) {
      const cost = best + arc.meters;
      if (cost < (distance.get(arc.to) ?? Infinity)) {
        distance.set(arc.to, cost);
        previous.set(arc.to, { from: current, way: arc.way });
      }
    }
  }

  const routeNodes: WalkingNode[] = [];
  const osmWayIds: number[] = [];
  let current = end;
  for (;;) {
    const node = nodes.get(current);
    if (!node) return null;
    routeNodes.push({ ...node });
    if (current === start) break;
    const step = previous.get(current);
    if (!step) return null;
    osmWayIds.push(step.way);
    current = step.from;
  }
  return {
    nodes: routeNodes.reverse(), osmWayIds: osmWayIds.reverse(),
    distanceMeters: distance.get(end) ?? 0,
    attribution: 'https://www.openstreetmap.org/copyright',
  };
}
