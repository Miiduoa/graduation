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
  heightMeters: number;
  heightBasis: 'osm-tag' | 'illustrative';
  /** Optional OSM way revision; not a site-survey or geometry-freshness guarantee. */
  osmVersion?: number;
  osmEditedAt?: string;
};

const EARTH_RADIUS = 6_371_008.8;
const DEG = Math.PI / 180;
const ALLOWANCE = 0.0004;
const MAX_WAYS = 128;
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

/** 只向 OSM 查詢已在本專案與官方地圖交叉核對的建築 way。 */
export const PROVIDENCE_OSM_BUILDING_WAY_IDS = [...knownWays.keys()];

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

/** Ensure a verified OSM way still covers (or is very close to) its named POI.
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
  // OSM recommends `m`; explicit metre/meter aliases are discouraged but
  // unambiguous. Accept them rather than silently hiding a sourced building.
  // Keep the required space for spelled-out aliases; never guess other units.
  const metric = /^(\d{1,3}(?:\.\d{1,6})?)(?:\s*m|\s+(?:metre|metres|meter|meters))?$/.exec(label);
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
  if (!Array.isArray(data?.elements) || data.elements.length > MAX_WAYS) return [];
  // A single OSM way cannot have two simultaneous outlines in one Overpass reply.
  // Failing closed avoids a forged/partial first entry winning merely by order,
  // even when its duplicate is missing tags or has invalid geometry.
  const returnedKnownIds = new Set<number>();
  for (const candidate of data.elements) {
    const item = object(candidate);
    if (item?.type !== 'way' || typeof item.id !== 'number' || !knownWays.has(item.id)) continue;
    if (returnedKnownIds.has(item.id)) return [];
    returnedKnownIds.add(item.id);
  }
  const seen = new Set<number>();
  const buildings: ProvidenceFootprint[] = [];
  for (const value of data.elements) {
    const element = object(value);
    if (element?.type !== 'way' || typeof element.id !== 'number' || !Number.isSafeInteger(element.id)) continue;
    const place = knownWays.get(element.id);
    if (!place || seen.has(element.id) || !isStandingBuilding(element.tags)) continue;
    const outline = safeOutline(element.geometry);
    if (!outline || !outlineNearPoi(outline, place)) continue;
    const height = heightFromOsmTags(element.tags);
    if (!height) continue;
    seen.add(element.id);
    buildings.push({
      poiId: place.id,
      name: place.name,
      sourceUrl: place.sourceUrl,
      outline,
      ...height,
      ...osmWayRevision(element),
    });
  }
  // 與共用靜宜地點名錄保持同順序，而非依伺服器回傳順序。
  const order = new Map(PROVIDENCE_CAMPUS_PLACES.map((p, index) => [p.id, index]));
  return buildings.sort((a, b) => (order.get(a.poiId) ?? 999) - (order.get(b.poiId) ?? 999));
}

/** 將已篩過的資料再於使用端核對，不信任外來 JSON 的名稱與 URL。 */
export function parseProvidenceFootprintResponse(value: unknown): ProvidenceFootprint[] {
  const data = object(value);
  if (data?.schoolId !== 'pu' || !Array.isArray(data.buildings) || data.buildings.length > knownWays.size) return [];
  // A trusted POI cannot have two different footprints in one API snapshot.
  // Reject the entire inconsistent payload, even if the second record has an
  // invalid name/shape. Never pick whichever duplicate arrived first.
  const knownPoiIds = new Set([...knownWays.values()].map((place) => place.id));
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
    const place = PROVIDENCE_CAMPUS_PLACES.find((p) => p.id === item.poiId && p.verification === 'cross-checked' &&
      knownWays.has(Number(p.sourceUrl.split('/').at(-1))));
    if (!place || item.name !== place.name || item.sourceUrl !== place.sourceUrl) continue;
    if (typeof item.heightMeters !== 'number' || !Number.isFinite(item.heightMeters) ||
      item.heightMeters < 2.5 || item.heightMeters > 100 ||
      (item.heightBasis !== 'illustrative' && item.heightBasis !== 'osm-tag') ||
      (item.heightBasis === 'illustrative' && item.heightMeters !== ILLUSTRATIVE_HEIGHT)) continue;
    if (!Array.isArray(item.outline) || item.outline.length < 3 || item.outline.length > MAX_VERTICES) continue;
    const geometry = item.outline.map((pair: unknown) =>
      Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'number' && typeof pair[1] === 'number'
        ? { lon: pair[0], lat: pair[1] } : null);
    if (geometry.some((entry: unknown) => entry === null)) continue;
    const closed = [...geometry, geometry[0]];
    const outline = safeOutline(closed);
    if (!outline || !outlineNearPoi(outline, place)) continue;
    seen.add(item.poiId);
    accepted.push({
      poiId: place.id, name: place.name, sourceUrl: place.sourceUrl, outline,
      heightMeters: item.heightMeters, heightBasis: item.heightBasis,
      ...osmWayRevision({ version: item.osmVersion, timestamp: item.osmEditedAt }),
    });
  }
  return accepted;
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
  const buildings = parseProvidenceFootprintResponse(data);
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
