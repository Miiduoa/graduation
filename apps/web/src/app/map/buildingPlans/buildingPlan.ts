/** Local, unverified drawing data. Importing a plan never creates a campus POI or route. */
export type PlanPoint = [number, number];
export type PlanRoom = { id: string; name: string; polygon: PlanPoint[] };
export type PlanWall = { start: PlanPoint; end: PlanPoint; thickness: number };
export type PlanFloor = {
  id: string;
  label: string;
  elevation: number;
  height: number;
  outline: PlanPoint[];
  rooms: PlanRoom[];
  walls: PlanWall[];
};
export type BuildingPlan = {
  version: 1;
  schoolId: string;
  buildingId: string;
  name: string;
  units: 'm' | 'relative';
  source?: { label: string; url?: string };
  floors: PlanFloor[];
};
export type BuildingPlanScope = { schoolId: string; buildingId: string };

export const MAX_BUILDING_PLAN_BYTES = 256_000;
const EPSILON = 1e-7;
const MAX_ROOMS = 200;
const MAX_WALLS = 512;

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), '圖面資料格式不正確。');
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 100): string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    `${label}需填寫，且不可超過 ${max} 字。`);
  return value.trim();
}

function number(value: unknown, label: string, min: number, max: number): number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    `${label}必須是 ${min} 到 ${max} 之間的數值。`);
  return value;
}

function point(value: unknown): PlanPoint {
  requireValue(Array.isArray(value) && value.length === 2, '座標請使用 [x, y]。');
  return [number(value[0], '平面座標', -500, 500), number(value[1], '平面座標', -500, 500)];
}

function cross(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: PlanPoint, b: PlanPoint, p: PlanPoint): boolean {
  return Math.abs(cross(a, b, p)) < EPSILON &&
    p[0] >= Math.min(a[0], b[0]) - EPSILON && p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON && p[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function intersects(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  const opposite = (left: number, right: number) =>
    (left > EPSILON && right < -EPSILON) || (left < -EPSILON && right > EPSILON);
  return (opposite(abC, abD) && opposite(cdA, cdB)) ||
    onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function polygon(value: unknown, label: string): PlanPoint[] {
  requireValue(Array.isArray(value) && value.length >= 3 && value.length <= 64,
    `${label}需要 3 到 64 個頂點。`);
  const points = value.map(point);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    requireValue(Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.01, `${label}有重複或過近的頂點。`);
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      requireValue(!intersects(a, b, points[j], points[(j + 1) % points.length]),
        `${label}的邊線互相交錯，請先修正圖面。`);
    }
  }
  requireValue(Math.abs(area) >= 0.04, `${label}面積過小或沒有面積。`);
  return points;
}

function contains(outline: PlanPoint[], p: PlanPoint): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j], b = outline[i];
    if (onSegment(a, b, p)) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
      p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function segmentInside(outline: PlanPoint[], a: PlanPoint, b: PlanPoint): boolean {
  if (!contains(outline, a) || !contains(outline, b)) return false;
  // Check every interval cut by an outline vertex/intersection, including concave notches.
  const cuts = [0, 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (let i = 0; i < outline.length; i++) {
    const c = outline[i], d = outline[(i + 1) % outline.length];
    const ex = d[0] - c[0], ey = d[1] - c[1];
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < EPSILON) continue;
    const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / denominator;
    const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((left, right) => left - right);
  return cuts.slice(1).every((end, index) => {
    const t = (end + cuts[index]) / 2;
    return contains(outline, [a[0] + dx * t, a[1] + dy * t]);
  });
}

function source(value: unknown): BuildingPlan['source'] {
  if (value === undefined) return undefined;
  const input = record(value);
  const result: NonNullable<BuildingPlan['source']> = { label: text(input.label, '來源名稱', 160) };
  if (input.url !== undefined) {
    const href = text(input.url, '來源網址', 2048);
    let url: URL;
    try { url = new URL(href); } catch {
      throw new Error('來源網址格式不正確，請使用完整的 HTTPS 網址。');
    }
    requireValue(url.protocol === 'https:' && !url.username && !url.password, '來源網址需使用 HTTPS，且不可包含帳號密碼。');
    result.url = url.href;
  }
  return result;
}

export function parseBuildingPlan(input: string, scope: BuildingPlanScope):
  { ok: true; plan: BuildingPlan } | { ok: false; message: string } {
  try {
    requireValue(input.length <= MAX_BUILDING_PLAN_BYTES && new TextEncoder().encode(input).byteLength <= MAX_BUILDING_PLAN_BYTES,
      '圖面檔案太大，請使用 256 KB 以內的 JSON。');
    const data = record(JSON.parse(input));
    requireValue(data.version === 1 && (data.units === 'm' || data.units === 'relative'),
      '請使用第 1 版圖面格式，單位為公尺（m）或未校正的示意單位（relative）。');
    requireValue(data.schoolId === scope.schoolId && data.buildingId === scope.buildingId,
      '這份圖面不屬於目前學校或建築，請確認後重新匯入。');
    requireValue(Array.isArray(data.floors) && data.floors.length > 0 && data.floors.length <= 12,
      '圖面需包含 1 到 12 個樓層。');
    const floorIds = new Set<string>(), roomIds = new Set<string>();
    let wallCount = 0;
    const floors: PlanFloor[] = data.floors.map((value) => {
      const floor = record(value);
      const id = text(floor.id, '樓層代碼');
      requireValue(!floorIds.has(id), '樓層代碼不可重複。');
      floorIds.add(id);
      const outline = polygon(floor.outline, '樓層外框');
      requireValue(Array.isArray(floor.rooms) && floor.rooms.length <= MAX_ROOMS, '房間清單格式不正確或超過數量限制。');
      const rooms = floor.rooms.map((item) => {
        const room = record(item);
        const roomId = text(room.id, '房間代碼');
        requireValue(!roomIds.has(roomId) && roomIds.size < MAX_ROOMS, '房間代碼不可重複，整份圖面最多 200 個房間。');
        roomIds.add(roomId);
        const shape = polygon(room.polygon, '房間範圍');
        requireValue(shape.every((p, i) => segmentInside(outline, p, shape[(i + 1) % shape.length])),
          '房間範圍超出樓層外框，請先修正圖面。');
        return { id: roomId, name: text(room.name, '房間名稱'), polygon: shape };
      });
      requireValue(floor.walls === undefined || Array.isArray(floor.walls), '牆面清單格式不正確。');
      const walls = ((floor.walls ?? []) as unknown[]).map((item) => {
        requireValue(++wallCount <= MAX_WALLS, '整份圖面最多 512 段牆面。');
        const wall = record(item), start = point(wall.start), end = point(wall.end);
        requireValue(Math.hypot(end[0] - start[0], end[1] - start[1]) >= 0.05 && segmentInside(outline, start, end),
          '牆面長度或位置不正確，請確認牆面位於樓層範圍內。');
        return { start, end, thickness: number(wall.thickness, '牆面厚度', 0.05, 1) };
      });
      return { id, label: text(floor.label, '樓層名稱'), elevation: number(floor.elevation, '樓層高度', -30, 150),
        height: number(floor.height, '樓高', 1, 10), outline, rooms, walls };
    }).sort((a, b) => a.elevation - b.elevation);
    requireValue(floors.every((floor, i) => i === 0 || floor.elevation >= floors[i - 1].elevation + floors[i - 1].height - EPSILON),
      '樓層高度互相重疊，請先修正標高與樓高。');
    const points = floors.flatMap((floor) => floor.outline);
    requireValue(Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])) <= 300 &&
      Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])) <= 300,
    '圖面範圍過大，請以單棟建築匯入。');
    return { ok: true, plan: { version: 1, schoolId: scope.schoolId, buildingId: scope.buildingId,
      name: text(data.name, '圖面名稱'), units: data.units, source: source(data.source), floors } };
  } catch (error) {
    return { ok: false, message: error instanceof SyntaxError ? '無法讀取 JSON，請檢查圖面檔案格式。' :
      error instanceof Error ? error.message : '無法讀取圖面，請重新選擇檔案。' };
  }
}

/** Fictional geometry for learning the format; deliberately unrelated to a real campus. */
export function createExampleBuildingPlan(scope: BuildingPlanScope): BuildingPlan {
  return {
    version: 1, ...scope, name: '兩層教學空間・示意', units: 'm',
    source: { label: '虛構範例，僅示範圖面格式與樓層操作' },
    floors: [0, 1].map((level) => ({
      id: `example-${level + 1}`, label: `${level + 1}F`, elevation: level * 3.4, height: 3.4,
      outline: [[0, 0], [22, 0], [22, 14], [0, 14]],
      rooms: [
        { id: `example-${level + 1}-a`, name: `範例教室 ${level + 1}01`, polygon: [[0.3, 0.3], [9.8, 0.3], [9.8, 5.8], [0.3, 5.8]] },
        { id: `example-${level + 1}-b`, name: `範例教室 ${level + 1}02`, polygon: [[12.2, 0.3], [21.7, 0.3], [21.7, 5.8], [12.2, 5.8]] },
        { id: `example-${level + 1}-c`, name: `範例自習室 ${level + 1}03`, polygon: [[0.3, 8.2], [21.7, 8.2], [21.7, 13.7], [0.3, 13.7]] },
      ],
      walls: [
        { start: [0, 0], end: [22, 0], thickness: 0.2 },
        { start: [22, 0], end: [22, 14], thickness: 0.2 },
        { start: [22, 14], end: [0, 14], thickness: 0.2 },
        { start: [0, 14], end: [0, 0], thickness: 0.2 },
        { start: [10, 0], end: [10, 6], thickness: 0.15 },
        { start: [12, 0], end: [12, 6], thickness: 0.15 },
        { start: [0, 6], end: [8, 6], thickness: 0.15 },
        { start: [14, 6], end: [22, 6], thickness: 0.15 },
        { start: [0, 8], end: [9, 8], thickness: 0.15 },
        { start: [13, 8], end: [22, 8], thickness: 0.15 },
      ],
    })),
  };
}
