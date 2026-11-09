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

function heightFromOsmTags(value: unknown): { heightMeters: number; heightBasis: ProvidenceFootprint['heightBasis'] } {
  const tags = object(value);
  const raw = tags?.height;
  // 接受純公尺數值，不將英尺、樓層數或其他自由文字誤作公尺。
  if (typeof raw === 'string' && /^\d{1,3}(?:\.\d{1,2})?(?:\s*m)?$/.test(raw.trim())) {
    const height = Number(raw.trim().replace(/\s*m$/, ''));
    if (height >= 2.5 && height <= 100) return { heightMeters: height, heightBasis: 'osm-tag' };
  }
  return { heightMeters: ILLUSTRATIVE_HEIGHT, heightBasis: 'illustrative' };
}

/** Overpass JSON：不接收動態 way ID、不猜位置、不補無來源的建築。 */
export function parseProvidenceOsmFootprints(value: unknown): ProvidenceFootprint[] {
  const data = object(value);
  if (!Array.isArray(data?.elements) || data.elements.length > MAX_WAYS) return [];
  const seen = new Set<number>();
  const buildings: ProvidenceFootprint[] = [];
  for (const value of data.elements) {
    const element = object(value);
    if (element?.type !== 'way' || typeof element.id !== 'number' || !Number.isSafeInteger(element.id)) continue;
    const place = knownWays.get(element.id);
    if (!place || seen.has(element.id)) continue;
    const outline = safeOutline(element.geometry);
    if (!outline || !outlineNearPoi(outline, place)) continue;
    seen.add(element.id);
    buildings.push({
      poiId: place.id,
      name: place.name,
      sourceUrl: place.sourceUrl,
      outline,
      ...heightFromOsmTags(element.tags),
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
      (item.heightBasis !== 'illustrative' && item.heightBasis !== 'osm-tag')) continue;
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
    });
  }
  return accepted;
}
