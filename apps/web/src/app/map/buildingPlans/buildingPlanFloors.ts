import {
  parseBuildingPlan,
  type BuildingPlan,
  type BuildingPlanScope,
  type PlanFloor,
  type PlanPoint,
  type PlanSource,
} from './buildingPlan';

export type BuildingPlanFloorPlacement = {
  sourceFloorId: string;
  label: string;
  elevation: number;
  offsetX: number;
  offsetY: number;
  rotationDegrees: 0 | 90 | 180 | 270;
};

export type BuildingPlanFloorDetails = { label: string; elevation: number; height: number };
type PlanResult = ReturnType<typeof parseBuildingPlan>;
type AppendResult = { ok: true; plan: BuildingPlan; addedFloorId: string } | { ok: false; message: string };

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Reuse the file boundary before and after editing, including its UTF-8 budget. */
function checkedPlan(plan: BuildingPlan, scope: BuildingPlanScope): BuildingPlan {
  let json: string;
  try { json = JSON.stringify(plan); } catch { throw new Error('圖面資料格式不正確，無法調整樓層。'); }
  const result = parseBuildingPlan(json, scope);
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

function errorResult(error: unknown): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : '無法調整樓層，請確認圖面資料。' };
}

function findFloor(plan: BuildingPlan, id: string): PlanFloor {
  const floor = plan.floors.find(item => item.id === id);
  requireValue(floor, '找不到指定樓層，請重新選擇。');
  return floor;
}

function availableId(prefix: string, used: Set<string>): string {
  // At most 12 floors / 200 rooms reach this function after parsing.
  let suffix = 1;
  while (used.has(`${prefix}-${suffix}`)) suffix++;
  const id = `${prefix}-${suffix}`;
  used.add(id);
  return id;
}

function floorSource(plan: BuildingPlan, floor: PlanFloor): PlanSource {
  return floor.source ?? plan.source ?? { label: `${plan.name}（原檔未提供來源）` };
}

/** The diagram uses downward-positive Y, so a 90° turn is clockwise on screen. */
function turnedPoint([x, y]: PlanPoint, degrees: BuildingPlanFloorPlacement['rotationDegrees']): PlanPoint {
  switch (degrees) {
    case 90: return [-y, x];
    case 180: return [-x, -y];
    case 270: return [y, -x];
    default: return [x, y];
  }
}

/** A quarter turn around the file's own (0, 0), then an explicit translation. */
function placedPoint(point: PlanPoint, placement: BuildingPlanFloorPlacement): PlanPoint {
  const [x, y] = turnedPoint(point, placement.rotationDegrees);
  return [x + placement.offsetX, y + placement.offsetY];
}

export type BuildingPlanFloorAlignmentAnchors = {
  referenceA: PlanPoint | undefined;
  referenceB: PlanPoint | undefined;
  incomingA: PlanPoint | undefined;
  incomingB: PlanPoint | undefined;
};
export type BuildingPlanFloorAlignmentResult =
  | { ok: true; rotationDegrees: BuildingPlanFloorPlacement['rotationDegrees']; offsetX: number; offsetY: number; errorMetres: number }
  | { ok: false; message: string };

const ALIGNMENT_TOLERANCE_METRES = 0.25;
const ALIGNMENT_MIN_DISTANCE_METRES = 0.5;

/**
 * Match two manually identified pairs of outline corners without guessing scale.
 * Anchor A is exact; B checks whether the quarter-turn is geometrically credible.
 */
export function suggestBuildingPlanFloorAlignment(anchors: BuildingPlanFloorAlignmentAnchors): BuildingPlanFloorAlignmentResult {
  const points = [anchors.referenceA, anchors.referenceB, anchors.incomingA, anchors.incomingB];
  if (!points.every(point => point && point.length === 2 && point.every(Number.isFinite))) {
    return { ok: false, message: '請在兩份圖面各選兩個有效的對應角點。' };
  }
  const { referenceA, referenceB, incomingA, incomingB } = anchors as {
    referenceA: PlanPoint; referenceB: PlanPoint; incomingA: PlanPoint; incomingB: PlanPoint;
  };
  const referenceDistance = Math.hypot(referenceB[0] - referenceA[0], referenceB[1] - referenceA[1]);
  const incomingDistance = Math.hypot(incomingB[0] - incomingA[0], incomingB[1] - incomingA[1]);
  if (Math.min(referenceDistance, incomingDistance) < ALIGNMENT_MIN_DISTANCE_METRES) {
    return { ok: false, message: '每份圖面的 A、B 對位點至少要相距 0.5 公尺，請選不同且較遠的角點。' };
  }
  if (Math.abs(referenceDistance - incomingDistance) > ALIGNMENT_TOLERANCE_METRES) {
    return { ok: false, message: '兩組對位點距離不一致（超過 0.25 公尺），請核對比例與對應位置；系統不會自動縮放圖面。' };
  }
  const turns = [0, 90, 180, 270] as const;
  const options = turns.map(rotationDegrees => {
    const a = turnedPoint(incomingA, rotationDegrees);
    const b = turnedPoint(incomingB, rotationDegrees);
    const offsetX = referenceA[0] - a[0];
    const offsetY = referenceA[1] - a[1];
    const errorMetres = Math.hypot(b[0] + offsetX - referenceB[0], b[1] + offsetY - referenceB[1]);
    return { rotationDegrees, offsetX, offsetY, errorMetres };
  });
  options.sort((a, b) => a.errorMetres - b.errorMetres);
  const best = options[0];
  if (best.errorMetres > ALIGNMENT_TOLERANCE_METRES) {
    return { ok: false, message: '兩組對位點無法以 90° 的倍數旋轉對齊（誤差超過 0.25 公尺）。請確認角點或改用手動位移與旋轉。' };
  }
  return { ok: true, ...best };
}

/** Add one chosen floor without assuming equal image origins, scales or storey heights. */
export function appendBuildingPlanFloor(
  base: BuildingPlan,
  incoming: BuildingPlan,
  scope: BuildingPlanScope,
  placement: BuildingPlanFloorPlacement,
): AppendResult {
  try {
    const current = checkedPlan(base, scope);
    const source = checkedPlan(incoming, scope);
    requireValue(current.units === 'm' && source.units === 'm',
      '組合樓層需先將兩份圖面校正為公尺；未校正的圖片不一定具有相同比例。');
    const original = findFloor(source, placement.sourceFloorId);
    requireValue(typeof placement.offsetX === 'number' && Number.isFinite(placement.offsetX) &&
      typeof placement.offsetY === 'number' && Number.isFinite(placement.offsetY), '樓層平移需填寫有限的數值。');
    requireValue([0, 90, 180, 270].includes(placement.rotationDegrees), '樓層旋轉僅支援 0、90、180 或 270 度。');

    const floorIds = new Set(current.floors.map(floor => floor.id));
    const roomIds = new Set(current.floors.flatMap(floor => floor.rooms.map(room => room.id)));
    const addedFloorId = availableId('assembled-floor', floorIds);
    const floor: PlanFloor = {
      id: addedFloorId,
      label: placement.label,
      elevation: placement.elevation,
      height: original.height,
      outline: original.outline.map(point => placedPoint(point, placement)),
      rooms: original.rooms.map(room => ({
        id: availableId('assembled-room', roomIds),
        name: room.name,
        polygon: room.polygon.map(point => placedPoint(point, placement)),
      })),
      walls: original.walls.map(wall => ({
        start: placedPoint(wall.start, placement),
        end: placedPoint(wall.end, placement),
        thickness: wall.thickness,
      })),
      source: floorSource(source, original),
    };
    const plan = checkedPlan({
      ...current,
      source: { label: '多份圖面組合，請逐層核對來源' },
      floors: [...current.floors.map(item => ({ ...item, source: floorSource(current, item) })), floor],
    }, scope);
    return { ok: true, plan, addedFloorId };
  } catch (error) {
    return errorResult(error);
  }
}

/** Keep horizontal geometry and identities unchanged when editing storey details. */
export function updateBuildingPlanFloor(
  input: BuildingPlan,
  scope: BuildingPlanScope,
  floorId: string,
  details: BuildingPlanFloorDetails,
): PlanResult {
  try {
    const current = checkedPlan(input, scope);
    const original = findFloor(current, floorId);
    const updated: PlanFloor = { ...original, label: details.label, elevation: details.elevation, height: details.height };
    return { ok: true, plan: checkedPlan({
      ...current,
      floors: current.floors.map(floor => floor.id === floorId ? updated : floor),
    }, scope) };
  } catch (error) {
    return errorResult(error);
  }
}

/** Removing a floor neither moves nor renumbers the remaining storeys. */
export function removeBuildingPlanFloor(
  input: BuildingPlan,
  scope: BuildingPlanScope,
  floorId: string,
): PlanResult {
  try {
    const current = checkedPlan(input, scope);
    findFloor(current, floorId);
    requireValue(current.floors.length > 1, '圖面至少需要保留一個樓層；如要重做，請使用清除圖面。');
    return { ok: true, plan: checkedPlan({
      ...current,
      floors: current.floors.filter(floor => floor.id !== floorId),
    }, scope) };
  } catch (error) {
    return errorResult(error);
  }
}
