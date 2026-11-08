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

/** A quarter turn around the file's own (0, 0), then an explicit translation. */
function placedPoint([x, y]: PlanPoint, placement: BuildingPlanFloorPlacement): PlanPoint {
  let turned: PlanPoint;
  switch (placement.rotationDegrees) {
    case 90: turned = [-y, x]; break;
    case 180: turned = [-x, -y]; break;
    case 270: turned = [y, -x]; break;
    default: turned = [x, y];
  }
  return [turned[0] + placement.offsetX, turned[1] + placement.offsetY];
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
