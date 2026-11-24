import type { CampusWalkingBounds, CampusWalkingGraph, WalkingEdge, WalkingNode } from './campusWalkingGraph';

// Discovery only. OSM tags, geometry and recent revisions are NOT a campus
// access audit. Never expose this candidate graph as a usable walking route.
const HIGHWAYS = ['footway', 'path', 'pedestrian', 'steps', 'service', 'living_street', 'residential'];
const MAX_NODES = 2000;
const MAX_EDGES = 4000;
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
function inBounds(n: WalkingNode, b: CampusWalkingBounds): boolean {
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

function revision(value: Record<string, unknown>, baseMs: number): Revision | null {
  const editedAt = value.timestamp;
  const editedMs = dateMillis(editedAt);
  if (!positiveId(value.version) || typeof editedAt !== 'string' ||
      editedMs === null || editedMs > baseMs) return null;
  const raw = value.tags === undefined ? {} : record(value.tags);
  if (!raw) return null;
  const entries = Object.entries(raw);
  if (entries.length > 128) return null;
  const tags: Tags = {};
  for (const [key, val] of entries) {
    if (!key || key.length > 255 || typeof val !== 'string' || val.length > 1024 ||
        ['__proto__', 'constructor', 'prototype'].includes(key)) return null;
    tags[key] = val;
  }
  return { version: value.version, editedAt, tags };
}

const restricted = (tags: Tags) =>
  ['no', 'private', 'customers', 'permit', 'destination'].includes(tags.foot ?? '') ||
  ['no', 'private', 'customers', 'permit', 'destination'].includes(tags.access ?? '') ||
  !!(tags.barrier && tags.barrier !== 'no') ||
  !!tags['access:conditional'] || !!tags['foot:conditional'] || !!tags['opening_hours'];

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

  const nodes = new Map<number, CandidateNode>();
  const ways = new Map<number, CandidateWay>();
  let references = 0;
  for (const raw of root.elements) {
    const item = record(raw);
    if (!item || !positiveId(item.id)) return null;
    const rev = revision(item, baseMs);
    if (!rev) return null;
    if (item.type === 'node') {
      if (nodes.has(item.id) || nodes.size >= MAX_NODES ||
          typeof item.lat !== 'number' || typeof item.lon !== 'number' ||
          !Number.isFinite(item.lat) || !Number.isFinite(item.lon) ||
          Math.abs(item.lat) > 90 || Math.abs(item.lon) > 180) return null;
      nodes.set(item.id, { id: item.id, lat: item.lat, lng: item.lon, ...rev });
    } else if (item.type === 'way') {
      if (ways.has(item.id) || !HIGHWAYS.includes(rev.tags.highway) ||
          !Array.isArray(item.nodes) || item.nodes.length < 2 ||
          item.nodes.length > MAX_EDGES + 1 || !item.nodes.every(positiveId)) return null;
      references += item.nodes.length - 1;
      if (references > MAX_EDGES) return null;
      ways.set(item.id, { id: item.id, nodes: [...item.nodes], ...rev });
    } else return null;
  }

  const edges: WalkingEdge[] = [];
  const seen = new Set<string>();
  for (const way of ways.values()) {
    if (way.nodes.some(id => !nodes.has(id))) return null;
    // A highway area or indoor feature is not an explicit outdoor path.
    if ((way.tags.area && way.tags.area !== 'no') ||
        (way.tags.indoor && way.tags.indoor !== 'no') || way.tags.location === 'underground') continue;
    for (let i = 1; i < way.nodes.length; i += 1) {
      const a = nodes.get(way.nodes[i - 1])!;
      const b = nodes.get(way.nodes[i])!;
      const key = [way.id, Math.min(a.id, b.id), Math.max(a.id, b.id)].join(':');
      if (a.id === b.id || seen.has(key) || (a.lat === b.lat && a.lng === b.lng)) return null;
      seen.add(key);
      if (!inBounds(a, bounds) || !inBounds(b, bounds)) continue;
      // "both" is a placeholder on a non-routable edge, not a direction audit.
      // Preserve all tags/revisions above for explicit review before promotion.
      edges.push({ from: a.id, to: b.id, osmWayId: way.id, direction: 'both',
        access: restricted(way.tags) || restricted(a.tags) || restricted(b.tags) ? 'restricted' : 'unknown' });
    }
  }
  const inside = [...nodes.values()].filter(n => inBounds(n, bounds));
  return {
    osmBaseAt, attribution: ATTRIBUTION, nodes: inside, ways: [...ways.values()],
    graph: { schoolId, nodes: inside.map(({ id, lat, lng }) => ({ id, lat, lng })), edges },
  };
}
