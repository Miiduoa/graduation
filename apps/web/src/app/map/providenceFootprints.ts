import {
  PROVIDENCE_CAMPUS_BOUNDS,
  PROVIDENCE_CAMPUS_PLACES,
} from '@campus/shared/src/providenceCampus';

/**
 * OSM 建築輪廓資料，僅用來呈現外部平面輪廓的立體擠出示意。
 * 高度不是校方測量、輪廓不代表開放通行區域或室內導航。
 */
export type ProvidenceFootprint = {
  poiId: string;
  name: string;
  sourceUrl: string;
  outline: Array<[number, number]>; // GeoJSON 順序：[經度、緯度]
  /** Validated OSM relation courtyards; never extrude these as solid roof/floor. */
  holes?: Array<Array<[number, number]>>;
  heightMeters: number;
  heightBasis: 'osm-tag' | 'illustrative';
  /** Optional OSM way revision; not a site-survey or geometry-freshness guarantee. */
  osmVersion?: number;
  osmEditedAt?: string;
};

const EARTH_RADIUS = 6_371_008.8;
const DEG = Math.PI / 180;
const ALLOWANCE = 0.0004;
const MAX_OSM_ELEMENTS = 128;
const MAX_VERTICES = 160;
const MAX_POI_OFFSET_METERS = 30;
const ILLUSTRATIVE_HEIGHT = 12;

const knownWays = new Map(
  PROVIDENCE_CAMPUS_PLACES.flatMap((place) => {
    if (place.verification !== 'cross-checked') return [];
    const match = /^https:\/\/www\.openstreetmap\.org\/way\/(\d+)$/.exec(place.sourceUrl);
    return match ? [[Number(match[1]), place] as const] : [];
  }),
);
const knownRelations = new Map(
  PROVIDENCE_CAMPUS_PLACES.flatMap((place) => {
    if (place.verification !== 'cross-checked') return [];
    const match = /^https:\/\/www\.openstreetmap\.org\/relation\/(\d+)$/.exec(place.sourceUrl);
    return match ? [[Number(match[1]), place] as const] : [];
  }),
);
const knownBuildingsByPoi = new Map(
  [...knownWays.values(), ...knownRelations.values()].map((place) => [place.id, place] as const),
);

/** Fixed audited OSM IDs only, never user-supplied queries or arbitrary relations. */
export const PROVIDENCE_OSM_BUILDING_WAY_IDS = [...knownWays.keys()];
export const PROVIDENCE_OSM_BUILDING_RELATION_IDS = [...knownRelations.keys()];

// Verified on 2026-11-12 against the OSM relation's full member list.
// Until a changed member list is reviewed, do not replace Xijia's mapped
// courtyard with an apparently solid building roof.
const VERIFIED_RELATION_MEMBERS = new Map([
  [9246899, { outer: 255783593, inner: 665651134 }],
]);

/** Overpass normally omits visibility. A source explicitly marking a way or
 * relation member invisible/deleted is not evidence of a standing building.
 * Treat malformed visibility metadata as unverified rather than guessing.
 */
function isVisibleOsmElement(element: Record<string, unknown>): boolean {
  return element.visible === undefined || element.visible === true;
}

function knownBuildingForElement(element: Record<string, unknown>) {
  if (typeof element.id !== 'number' || !Number.isSafeInteger(element.id)) return undefined;
  return element.type === 'way' ? knownWays.get(element.id)
    : element.type === 'relation' ? knownRelations.get(element.id) : undefined;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

function safeCoordinate(value: unknown): [number, number] | null {
  const record = object(value);
  if (!record || typeof record.lon !== 'number' || typeof record.lat !== 'number') return null;
  const { lon, lat } = record;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const bounds = PROVIDENCE_CAMPUS_BOUNDS;
  if (lat < bounds.south - ALLOWANCE || lat > bounds.north + ALLOWANCE ||
      lon < bounds.west - ALLOWANCE || lon > bounds.east + ALLOWANCE) return null;
  return [lon, lat];
}

function polygonAreaMeters(points: readonly [number, number][]): number {
  const origin = points[0];
  const lonScale = EARTH_RADIUS * DEG * Math.cos(origin[1] * DEG);
  const latScale = EARTH_RADIUS * DEG;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    twiceArea += ((points[index][0] - origin[0]) * lonScale) *
      ((next[1] - origin[1]) * latScale) -
      ((next[0] - origin[0]) * lonScale) *
      ((points[index][1] - origin[1]) * latScale);
  }
  return Math.abs(twiceArea) / 2;
}

function intersects(a: [number, number], b: [number, number],
  c: [number, number], d: [number, number]): boolean {
  const cross = (u: [number, number], v: [number, number], w: [number, number]) =>
    (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  // A polygon must also reject a non-adjacent edge touching an endpoint,
  // or overlapping a collinear edge: strict crossing alone misses both.
  const orientation = (value: number) => value > 1e-15 ? 1 : value < -1e-15 ? -1 : 0;
  const onSegment = (p: [number, number], u: [number, number], v: [number, number]) =>
    p[0] >= Math.min(u[0], v[0]) - 1e-9 && p[0] <= Math.max(u[0], v[0]) + 1e-9 &&
    p[1] >= Math.min(u[1], v[1]) - 1e-9 && p[1] <= Math.max(u[1], v[1]) + 1e-9;
  const abC = orientation(cross(a, b, c));
  const abD = orientation(cross(a, b, d));
  const cdA = orientation(cross(c, d, a));
  const cdB = orientation(cross(c, d, b));
  return (abC * abD < 0 && cdA * cdB < 0) ||
    (abC === 0 && onSegment(c, a, b)) ||
    (abD === 0 && onSegment(d, a, b)) ||
    (cdA === 0 && onSegment(a, c, d)) ||
    (cdB === 0 && onSegment(b, c, d));
}

/** A closed OSM way repeats the *same node ID* at both ends. Coordinates can
 * happen to coincide for different nodes even when the source is an open line.
 * When Overpass supplies node refs, verify they describe the same geometry
 * before treating the coordinate ring as a building. Legacy geometry-only
 * fixtures remain supported, but malformed/mismatched refs fail closed.
 */
function hasConsistentOsmWayNodes(way: Record<string, unknown>): boolean {
  const nodes = way.nodes;
  if (nodes === undefined) return true;
  if (!Array.isArray(nodes) || !Array.isArray(way.geometry) ||
      nodes.length !== way.geometry.length || nodes.length < 4) return false;
  // The same closing node ID must resolve to exactly the same coordinate.
  // safeOutline intentionally tolerates tiny coordinate-rounding gaps for
  // geometry-only payloads, but a supplied OSM node identity is stronger
  // evidence: contradictory endpoint positions cannot describe one node.
  const first = object(way.geometry[0]);
  const last = object(way.geometry[way.geometry.length - 1]);
  if (!first || !last || first.lon !== last.lon || first.lat !== last.lat) return false;
  // Every intermediate OSM node must be distinct. Repeating an ID inside
  // the ring (rather than only to close it) is not a simple building loop,
  // even when an upstream geometry array assigns that ID two different
  // coordinates. Those contradictory node/geometry pairs must fail closed.
  const interior = nodes.slice(0, -1);
  return nodes.every((id) => typeof id === 'number' &&
    Number.isSafeInteger(id) && id > 0) &&
    nodes[0] === nodes[nodes.length - 1] &&
    new Set(interior).size === interior.length;
}

function safeOutline(value: unknown): Array<[number, number]> | null {
  if (!Array.isArray(value) || value.length < 4 || value.length > MAX_VERTICES + 1) return null;
  const points: Array<[number, number]> = [];
  for (const vertex of value) {
    const point = safeCoordinate(vertex);
    if (!point) return null;
    points.push(point);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9) return null;
  points.pop();
  if (points.length < 3) return null;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    if (points[index][0] === next[0] && points[index][1] === next[1]) return null;
  }
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 2; j < points.length; j += 1) {
      if (i === 0 && j === points.length - 1) continue;
      if (intersects(points[i], points[(i + 1) % points.length],
        points[j], points[(j + 1) % points.length])) return null;
    }
  }
  const area = polygonAreaMeters(points);
  return area >= 20 && area <= 100_000 ? points : null;
}

/** A one-outer OSM multipolygon may enclose one courtyard. The source-verified
 * inner ring must remain empty in both the API payload and Three.js scene.
 * Reject fragmented, intersecting, nested or unknown members rather than
 * manufacturing closed walls from disconnected ways.
 */
function pointStrictlyInsideRing(point: [number, number], ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, prev = ring.length - 1; i < ring.length; prev = i, i += 1) {
    const a = ring[prev];
    const b = ring[i];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function holeStrictlyInsideOuter(
  hole: readonly [number, number][], outline: readonly [number, number][],
): boolean {
  // No hole point or edge may touch/cross the outer ring. Testing all hole
  // vertices + all edge pairs also covers concave outer footprints.
  if (!hole.every((point) => pointStrictlyInsideRing(point, outline))) return false;
  for (let i = 0; i < hole.length; i += 1) {
    for (let j = 0; j < outline.length; j += 1) {
      if (intersects(hole[i], hole[(i + 1) % hole.length],
        outline[j], outline[(j + 1) % outline.length])) return false;
    }
  }
  return polygonAreaMeters(outline) - polygonAreaMeters(hole) >= 20;
}

function safeSimpleRelationGeometry(element: Record<string, unknown>):
  { outline: Array<[number, number]>; holes: Array<Array<[number, number]>> } | null {
  if (object(element.tags)?.type !== 'multipolygon') return null;
  const members = element.members;
  // Only one closed outer ring and at most one closed inner ring are currently
  // supported. Real OSM relation 9246899 has outer 255783593 / inner 665651134.
  if (!Array.isArray(members) || members.length < 1 || members.length > 2) return null;
  const ways = members.map(object);
  if (ways.some((way) => !way || !isVisibleOsmElement(way) || way.type !== 'way' ||
      typeof way.ref !== 'number' || !Number.isSafeInteger(way.ref))) return null;
  const outerMembers = ways.filter((way) => way?.role === 'outer');
  const innerMembers = ways.filter((way) => way?.role === 'inner');
  if (outerMembers.length !== 1 || outerMembers.length + innerMembers.length !== ways.length ||
      innerMembers.length > 1) return null;
  if (innerMembers.length && innerMembers[0]?.ref === outerMembers[0]?.ref) return null;
  const audited = VERIFIED_RELATION_MEMBERS.get(element.id as number);
  if (audited && (outerMembers[0]?.ref !== audited.outer ||
      innerMembers.length !== 1 || innerMembers[0]?.ref !== audited.inner)) {
    // In particular, a truncated/changed Xijia relation must not fill its
    // previously verified courtyard with an invented roof.
    return null;
  }
  if (!outerMembers[0] || !hasConsistentOsmWayNodes(outerMembers[0]) ||
      (innerMembers.length > 0 && (!innerMembers[0] ||
        !hasConsistentOsmWayNodes(innerMembers[0])))) return null;
  // A node ID identifies one OSM coordinate globally, not once per ring.
  // When both member ways expose node refs, a shared ID would mean the
  // courtyard touches the outer wall or the source assigns one node to two
  // different coordinates. Either case must not become a 3D building.
  if (innerMembers.length) {
    const outerNodes = outerMembers[0].nodes;
    const innerNodes = innerMembers[0]?.nodes;
    if (Array.isArray(outerNodes) && Array.isArray(innerNodes)) {
      const outerIds = new Set(outerNodes.slice(0, -1));
      if (innerNodes.slice(0, -1).some((id) => outerIds.has(id))) return null;
    }
  }
  const outline = safeOutline(outerMembers[0].geometry);
  if (!outline) return null;
  if (!innerMembers.length) return { outline, holes: [] };
  const hole = safeOutline(innerMembers[0]?.geometry);
  if (!hole || !holeStrictlyInsideOuter(hole, outline)) return null;
  return { outline, holes: [hole] };
}

/** Safe client-side revalidation of already-open rings serialized by the API. */
function safeClientRing(value: unknown): Array<[number, number]> | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > MAX_VERTICES) return null;
  const points = value.map((pair: unknown) =>
    Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'number' && typeof pair[1] === 'number'
      ? { lon: pair[0], lat: pair[1] } : null);
  if (points.some((entry) => entry === null)) return null;
  return safeOutline([...points, points[0]]);
}

/** Ensure a verified OSM way/relation still covers (or is very close to) its named POI.
 * A moved or re-tagged way elsewhere on campus must not inherit the old POI's name.
 * The 30 m slack covers map alignment errors; it is not a room/entrance coordinate.
 */
function outlineNearPoi(outline: readonly [number, number][], place: { lat: number; lng: number }): boolean {
  const lonScale = EARTH_RADIUS * DEG * Math.cos(place.lat * DEG);
  const latScale = EARTH_RADIUS * DEG;
  const vertices = outline.map(([lon, lat]) => [
    (lon - place.lng) * lonScale, (lat - place.lat) * latScale,
  ] as const);
  let inside = false;
  for (let i = 0; i < vertices.length; i += 1) {
    const [ax, ay] = vertices[i];
    const [bx, by] = vertices[(i + 1) % vertices.length];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const position = lengthSquared > 0
      ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared))
      : 0;
    const nearestX = ax + position * dx;
    const nearestY = ay + position * dy;
    if (nearestX * nearestX + nearestY * nearestY <= MAX_POI_OFFSET_METERS ** 2) return true;
    if ((ay > 0) !== (by > 0) && ax + (-ay * dx) / dy > 0) inside = !inside;
  }
  return inside;
}

/** Whitelisted IDs can be edited in OSM. A former building or roof-only way must
 * not be rendered as an occupied, full-height campus building. Unclear tags fail closed.
 */
// Non-building/ambiguous values sometimes survive old OSM edits on an audited way.
// A matching way ID alone must not turn explicit negative tags into a campus block.
const NON_BUILDING_VOLUMES = new Set([
  'no', 'false', '0', 'none', 'unknown', 'maybe',
  'proposed', 'planned', 'construction', 'demolished', 'destroyed',
  'ruins', 'ruined', 'collapsed', 'abandoned', 'disused', 'derelict', 'roof', 'bridge',
]);
// A way can retain building=yes while carrying a lifecycle tag for a removed,
// abandoned or unfinished building. Treat contradictory tags as needing review:
// this is a map volume, not proof of a standing, accessible campus building.
const LIFECYCLE_BUILDING_TAGS = [
  'abandoned:building', 'disused:building', 'demolished:building',
  'destroyed:building', 'removed:building', 'razed:building',
  'construction:building', 'proposed:building', 'planned:building',
  'ruins:building', 'ruined:building',
] as const;
// Older tagging also puts the lifecycle state directly on the building,
// e.g. building=yes + ruins=yes. A verified way ID alone does not prove the
// original full-height campus volume still exists.
const LIFECYCLE_STATUS_TAGS = [
  'abandoned', 'disused', 'demolished', 'destroyed', 'removed',
  'razed', 'ruins', 'ruined', 'construction', 'proposed', 'planned',
] as const;

function isStandingBuilding(value: unknown): boolean {
  const tags = object(value);
  const classification = tags?.building;
  if (typeof classification !== 'string') return false;
  const kind = classification.trim().toLowerCase();
  if (!kind || NON_BUILDING_VOLUMES.has(kind) || kind === 'part') return false;
  // A closed OSM way tagged area=no is a line, not a polygon, even if an
  // old building=* tag remains. Never extrude its enclosed space into walls.
  // Unknown/invalid area markers are ambiguous and require source review.
  const area = tags?.area;
  if (area !== undefined && (typeof area !== 'string' ||
      !['yes', 'true', '1'].includes(area.trim().toLowerCase()))) return false;
  // OSM building:part marks an individual section of a larger building. This
  // renderer only extrudes audited whole-building ways from the ground and
  // cannot reconstruct a part's neighbouring volumes or real base elevation.
  // Even building=yes + building:part=yes is not a verified full building.
  // An explicitly negative flag is safe; blank/non-string tags are ambiguous.
  const buildingPart = tags?.['building:part'];
  if (buildingPart !== undefined &&
      (typeof buildingPart !== 'string' ||
        !['no', 'false', '0'].includes(buildingPart.trim().toLowerCase()))) return false;
  // A raised building part cannot be drawn as a ground-to-roof extrusion.
  // We do not yet have verified floor/base elevations for elevated OSM ways.
  // Unknown units or ambiguous offset values must not become a fictitious wall.
  const zeroOffset = (value: unknown) => typeof value === 'string' &&
    /^0+(?:\.0+)?(?:\s*m)?$/i.test(value.trim());
  for (const key of ['min_height', 'building:min_level']) {
    const offset = tags?.[key];
    if (offset !== undefined && !zeroOffset(offset)) return false;
  }
  // This renderer extrudes from the ground. OSM can also describe a roof,
  // underground footprint, bridge or other feature at a different elevation.
  // Without verified bottom elevations, drawing those as surface walls would
  // claim a real 3D building that the source does not establish.
  const location = tags?.location;
  if (location !== undefined && (typeof location !== 'string' ||
      !['surface', 'ground'].includes(location.trim().toLowerCase()))) return false;
  // Non-zero OSM layers describe relative vertical ordering, not a surveyed
  // building base height. Preserve normal buildings with an explicit layer=0.
  const layer = tags?.layer;
  if (layer !== undefined && (typeof layer !== 'string' ||
      !/^[+]?0+$/.test(layer.trim()))) return false;
  for (const key of ['bridge', 'tunnel']) {
    const marker = tags?.[key];
    if (marker !== undefined && (typeof marker !== 'string' ||
        !['no', 'false', '0'].includes(marker.trim().toLowerCase()))) return false;
  }
  return ![...LIFECYCLE_BUILDING_TAGS, ...LIFECYCLE_STATUS_TAGS].some((tag) => {
    const status = tags?.[tag];
    // OSM lifecycle flags are usually strings. A present but unrecognized
    // value must not silently certify a standing campus building.
    // A present lifecycle marker with an empty/null value is ambiguous, not
    // an explicit "no". Fail closed rather than drawing an intact building.
    return status !== undefined &&
      (typeof status !== 'string' || !['no', 'false', '0'].includes(status.trim().toLowerCase()));
  });
}

/** Only copy audited OSM way revision fields, never editor names or account IDs.
 * Node positions may change without updating the parent way's revision.
 */
function osmWayRevision(value: Record<string, unknown>): Pick<ProvidenceFootprint, 'osmVersion' | 'osmEditedAt'> {
  const version = value.version;
  const timestamp = value.timestamp;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 ||
      typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)) return {};
  const time = Date.parse(timestamp);
  // An upstream edit time substantially in the future is not a credible
  // provenance label. Keep the valid outline, but omit the dubious revision.
  // Allow a small clock skew across Overpass, our server and the device.
  if (!Number.isFinite(time) || time > Date.now() + 5 * 60 * 1000 ||
      new Date(time).toISOString().replace('.000Z', 'Z') !== timestamp) return {};
  return { osmVersion: version, osmEditedAt: timestamp };
}

function heightFromOsmTags(value: unknown):
  { heightMeters: number; heightBasis: ProvidenceFootprint['heightBasis'] } | null {
  const tags = object(value);
  const raw = tags?.height;
  // A missing height is visibly illustrative. An explicitly present but
  // unreadable height is *not* evidence that the building is 12 metres tall:
  // omit its volume until the unit/value can be verified.
  if (raw === undefined) return { heightMeters: ILLUSTRATIVE_HEIGHT, heightBasis: 'illustrative' };
  // OSM heights default to metres; explicit feet and canonical feet/inches
  // are also documented. Only convert unambiguous units, never infer levels.
  if (typeof raw !== 'string') return null;
  const label = raw.trim();
  const metric = /^(\d{1,3}(?:\.\d{1,6})?)(?:\s*m)?$/.exec(label);
  const feet = /^(\d{1,3}(?:\.\d{1,6})?)\s+(?:ft|feet)$/i.exec(label);
  const feetInches = /^(\d{1,3})'(?:([0-9]{1,2})")?$/.exec(label);
  if (feetInches && Number(feetInches[2] ?? 0) >= 12) return null;
  const height = metric ? Number(metric[1]) :
    feet ? Number(feet[1]) * 0.3048 :
      feetInches ? Number(feetInches[1]) * 0.3048 + Number(feetInches[2] ?? 0) * 0.0254 : NaN;
  return Number.isFinite(height) && height >= 2.5 && height <= 100
    ? { heightMeters: height, heightBasis: 'osm-tag' } : null;
}

/** Overpass JSON：不接收動態 way ID、不猜位置、不補無來源的建築。 */
export function parseProvidenceOsmFootprints(value: unknown): ProvidenceFootprint[] {
  const data = object(value);
  if (!Array.isArray(data?.elements) || data.elements.length > MAX_OSM_ELEMENTS) return [];
  // A known way/relation cannot appear twice in one Overpass reply. Fail closed
  // even if the second copy lacks valid geometry or tags.
  const returnedKnownIds = new Set<string>();
  for (const candidate of data.elements) {
    const item = object(candidate);
    if (!item || !knownBuildingForElement(item)) continue;
    const identity = `${item.type}:${item.id}`;
    if (returnedKnownIds.has(identity)) return [];
    returnedKnownIds.add(identity);
  }
  const seen = new Set<string>();
  const buildings: ProvidenceFootprint[] = [];
  for (const value of data.elements) {
    const element = object(value);
    if (!element) continue;
    const place = knownBuildingForElement(element);
    const identity = `${element.type}:${element.id}`;
    if (!place || seen.has(identity) || !isVisibleOsmElement(element) ||
        !isStandingBuilding(element.tags)) continue;
    const geometry = element.type === 'way'
      ? (() => {
          if (!hasConsistentOsmWayNodes(element)) return null;
          const outline = safeOutline(element.geometry);
          return outline ? { outline, holes: [] } : null;
        })()
      : safeSimpleRelationGeometry(element);
    if (!geometry || !outlineNearPoi(geometry.outline, place)) continue;
    const height = heightFromOsmTags(element.tags);
    if (!height) continue;
    seen.add(identity);
    buildings.push({
      poiId: place.id,
      name: place.name,
      sourceUrl: place.sourceUrl,
      outline: geometry.outline,
      ...(geometry.holes.length ? { holes: geometry.holes } : {}),
      ...height,
      // Relation revisions describe the relation, not its member-way geometry.
      // The existing UI labels revisions as "OSM way", so never mislabel them.
      ...(element.type === 'way' ? osmWayRevision(element) : {}),
    });
  }
  // 與共用靜宜地點名錄保持同順序，而非依伺服器回傳順序。
  const order = new Map(PROVIDENCE_CAMPUS_PLACES.map((p, index) => [p.id, index]));
  return buildings.sort((a, b) => (order.get(a.poiId) ?? 999) - (order.get(b.poiId) ?? 999));
}

/** 將已篩過的資料再於使用端核對，不信任外來 JSON 的名稱與 URL。 */
export function parseProvidenceFootprintResponse(value: unknown): ProvidenceFootprint[] {
  const data = object(value);
  if (data?.schoolId !== 'pu' || !Array.isArray(data.buildings) ||
      data.buildings.length > knownBuildingsByPoi.size) return [];
  // A trusted POI cannot have two different footprints in one API snapshot.
  // Reject the entire inconsistent payload, even if the second record has an
  // invalid name/shape. Never pick whichever duplicate arrived first.
  const knownPoiIds = new Set(knownBuildingsByPoi.keys());
  const returnedPoiIds = new Set<string>();
  for (const candidate of data.buildings) {
    const id = object(candidate)?.poiId;
    if (typeof id !== 'string' || !knownPoiIds.has(id)) continue;
    if (returnedPoiIds.has(id)) return [];
    returnedPoiIds.add(id);
  }
  const seen = new Set<string>();
  const accepted: ProvidenceFootprint[] = [];
  for (const value of data.buildings) {
    const item = object(value);
    if (typeof item?.poiId !== 'string' || seen.has(item.poiId)) continue;
    const place = knownBuildingsByPoi.get(item.poiId);
    if (!place || item.name !== place.name || item.sourceUrl !== place.sourceUrl) continue;
    if (typeof item.heightMeters !== 'number' || !Number.isFinite(item.heightMeters) ||
      item.heightMeters < 2.5 || item.heightMeters > 100 ||
      (item.heightBasis !== 'illustrative' && item.heightBasis !== 'osm-tag') ||
      (item.heightBasis === 'illustrative' && item.heightMeters !== ILLUSTRATIVE_HEIGHT)) continue;
    const outline = safeClientRing(item.outline);
    if (!outline || !outlineNearPoi(outline, place)) continue;
    // Missing the audited courtyard is not equivalent to a solid roof,
    // including when an older cached/API response omits its holes field.
    if (item.sourceUrl === 'https://www.openstreetmap.org/relation/9246899' &&
        item.holes === undefined) continue;
    // The client must revalidate ring containment and reject forged holes on
    // ordinary ways. Missing/invalid holes must never become a solid courtyard.
    if (item.holes !== undefined && !place.sourceUrl.includes('/relation/')) continue;
    if (item.holes !== undefined &&
        (!Array.isArray(item.holes) || item.holes.length !== 1)) continue;
    const hole = Array.isArray(item.holes) ? safeClientRing(item.holes[0]) : null;
    if (item.holes !== undefined && (!hole || !holeStrictlyInsideOuter(hole, outline))) continue;
    seen.add(item.poiId);
    accepted.push({
      poiId: place.id, name: place.name, sourceUrl: place.sourceUrl, outline,
      ...(hole ? { holes: [hole] } : {}),
      heightMeters: item.heightMeters, heightBasis: item.heightBasis,
      // A relation's revision does not date the geometry of its member way.
      // Never trust relation metadata as the UI's "OSM way" revision.
      ...(place.sourceUrl.startsWith('https://www.openstreetmap.org/way/')
        ? osmWayRevision({ version: item.osmVersion, timestamp: item.osmEditedAt }) : {}),
    });
  }
  return accepted;
}

/** OSM way edit metadata cannot postdate the source database snapshot.
 * Retain otherwise verified outlines, but never show a contradictory revision
 * as provenance. Allow five minutes for upstream clock skew.
 */
export function stripOsmRevisionsAfter(
  footprints: ProvidenceFootprint[],
  sourceAsOfMs: number,
): ProvidenceFootprint[] {
  const latestPossibleEdit = sourceAsOfMs + 5 * 60 * 1000;
  return footprints.map((footprint) => {
    if (!footprint.osmEditedAt ||
        Date.parse(footprint.osmEditedAt) <= latestPossibleEdit) return footprint;
    const withoutUnverifiableRevision = { ...footprint };
    delete withoutUnverifiableRevision.osmVersion;
    delete withoutUnverifiableRevision.osmEditedAt;
    return withoutUnverifiableRevision;
  });
}

/** Verify that API geometry still has a trustworthy source and recent fetch date.
 * Client clocks may differ by a few minutes, but a forged/far-future timestamp,
 * stale CDN response, or unrelated API payload must not be portrayed as current OSM.
 */
export function parseProvidenceFootprintSnapshot(value: unknown, now = Date.now()): {
  buildings: ProvidenceFootprint[]; fetchedAt: string; stale: boolean; osmBaseAt: string | null;
} | null {
  const data = object(value);
  if (!data || data.schoolId !== 'pu' || data.source !== 'OpenStreetMap' ||
      typeof data.fetchedAt !== 'string' || typeof data.stale !== 'boolean' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.fetchedAt) ||
      !Number.isFinite(now)) return null;
  const fetchedAtMs = Date.parse(data.fetchedAt);
  if (!Number.isFinite(fetchedAtMs) || new Date(fetchedAtMs).toISOString() !== data.fetchedAt) return null;
  // Fetch time is not the Overpass database replication time. Retain older
  // snapshots without this optional field, but reject misleading metadata.
  const osmBaseAt = data.osmBaseAt;
  if (osmBaseAt !== undefined && osmBaseAt !== null) {
    if (typeof osmBaseAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(osmBaseAt)) return null;
    const baseMs = Date.parse(osmBaseAt);
    if (!Number.isFinite(baseMs) ||
        new Date(baseMs).toISOString().replace('.000Z', 'Z') !== osmBaseAt ||
        baseMs > fetchedAtMs + 5 * 60 * 1000 ||
        fetchedAtMs - baseMs > 48 * 60 * 60 * 1000) return null;
  }
  const ageMs = now - fetchedAtMs;
  const day = 24 * 60 * 60 * 1000;
  // Match both server expiry clocks: HTTP fetch age and, when supplied,
  // the older Overpass replication state. A CDN must not extend either one.
  if (ageMs >= 7 * day || ageMs < -5 * 60 * 1000 ||
      (typeof osmBaseAt === 'string' && now - Date.parse(osmBaseAt) >= 7 * day)) return null;
  // A revised OSM way must not appear newer than the map database that
  // supplied it. Without replication metadata, fall back to HTTP fetch time.
  // Inconsistent revision labels are removed; separately validated geometry
  // remains available, with its existing illustrative/sourced height caveats.
  const buildings = stripOsmRevisionsAfter(
    parseProvidenceFootprintResponse(data),
    typeof osmBaseAt === 'string' ? Date.parse(osmBaseAt) : fetchedAtMs,
  );
  if (!buildings.length) return null;
  return {
    buildings, fetchedAt: data.fetchedAt,
    // A response can be cached upstream even after its Overpass replication
    // timestamp passes the server's 48-hour freshness deadline. Do not trust
    // stale=false from an intermediary when the device can verify the age.
    stale: data.stale || ageMs >= day || (typeof osmBaseAt === 'string' &&
      now - Date.parse(osmBaseAt) >= 48 * 60 * 60 * 1000),
    osmBaseAt: typeof osmBaseAt === 'string' ? osmBaseAt : null,
  };
}
