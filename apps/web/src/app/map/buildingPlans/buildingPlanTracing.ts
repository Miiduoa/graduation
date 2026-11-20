import { parseBuildingPlan, type BuildingPlanScope, type PlanPoint } from './buildingPlan';

/** Coordinates are fractions of the reference image's width and height, not metres. */
export type PlanTraceDraft = {
  name: string;
  floorLabel: string;
  imageWidth: number;
  imageHeight: number;
  outline: PlanPoint[];
  rooms: Array<{ id: string; name: string; polygon: PlanPoint[] }>;
  calibration?: { start: PlanPoint; end: PlanPoint; metres: number };
  floorHeight?: number;
  source: { label: string; url?: string };
};

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checkPoint(point: PlanPoint): void {
  requireValue(Array.isArray(point) && point.length === 2 &&
    point.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1),
  '描圖座標必須位於圖片範圍內，並以 0 到 1 的比例表示。');
}

function checkPolygon(points: PlanPoint[]): void {
  requireValue(Array.isArray(points) && points.length >= 3 && points.length <= 64,
    '每個外框或房間需要 3 到 64 個描點。');
  points.forEach(checkPoint);
}

/** Build one unverified floor, then apply exactly the same boundary as a JSON import. */
export function buildTracedBuildingPlan(
  draft: PlanTraceDraft,
  scope: BuildingPlanScope,
): ReturnType<typeof parseBuildingPlan> {
  try {
    const { imageWidth: width, imageHeight: height } = draft;
    requireValue(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
      width * height <= 24_000_000, '圖片尺寸不正確或超過 2,400 萬像素，請重新選擇圖片。');
    checkPolygon(draft.outline);
    requireValue(Array.isArray(draft.rooms) && draft.rooms.length <= 200, '描圖最多包含 200 個房間。');
    draft.rooms.forEach(room => checkPolygon(room.polygon));
    requireValue(draft.source !== null && typeof draft.source === 'object', '請填寫圖面來源，供後續核對。');

    const longestSide = Math.max(width, height);
    let unitsPerPixel = 20 / longestSide;
    let floorHeight = 3;
    let units: 'm' | 'relative' = 'relative';
    if (draft.calibration !== undefined) {
      const { start, end, metres } = draft.calibration;
      checkPoint(start);
      checkPoint(end);
      const distance = Math.hypot((end[0] - start[0]) * width, (end[1] - start[1]) * height);
      requireValue(distance >= Math.max(2, longestSide * 0.005),
        '校正點距離太近，請選擇相距至少圖片長邊 0.5% 且至少 2 像素的兩點。');
      requireValue(typeof metres === 'number' && Number.isFinite(metres) && metres > 0,
        '校正距離必須是大於 0 的公尺數。');
      requireValue(typeof draft.floorHeight === 'number' && Number.isFinite(draft.floorHeight) &&
        draft.floorHeight >= 1 && draft.floorHeight <= 10,
      '已校正圖面需填寫 1 到 10 公尺的樓高，請依實際資料輸入。');
      unitsPerPixel = metres / distance;
      floorHeight = draft.floorHeight;
      units = 'm';
    }

    const originX = Math.min(...draft.outline.map(point => point[0]));
    const originY = Math.min(...draft.outline.map(point => point[1]));
    const convert = ([x, y]: PlanPoint): PlanPoint => [
      (x - originX) * width * unitsPerPixel,
      (y - originY) * height * unitsPerPixel,
    ];
    const outline = draft.outline.map(convert);
    return parseBuildingPlan(JSON.stringify({
      version: 1,
      schoolId: scope.schoolId,
      buildingId: scope.buildingId,
      name: draft.name,
      units,
      source: draft.source,
      floors: [{
        id: 'traced-1',
        label: draft.floorLabel,
        elevation: 0,
        height: floorHeight,
        outline,
        rooms: draft.rooms.map(room => ({ id: room.id, name: room.name, polygon: room.polygon.map(convert) })),
        walls: outline.map((start, index) => ({ start, end: outline[(index + 1) % outline.length], thickness: 0.15 })),
      }],
    }), scope);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '無法建立描圖，請檢查外框與校正資料。' };
  }
}
