import { describe, expect, it } from 'vitest';
import {
  MAX_BUILDING_PLAN_BYTES,
  parseBuildingPlan,
  type BuildingPlan,
  type BuildingPlanScope,
  type PlanFloor,
  type PlanPoint,
} from './buildingPlan';
import {
  appendBuildingPlanFloor,
  suggestBuildingPlanFloorAlignment,
  removeBuildingPlanFloor,
  updateBuildingPlanFloor,
  type BuildingPlanFloorPlacement,
} from './buildingPlanFloors';

const scope: BuildingPlanScope = { schoolId: 'campus-a', buildingId: 'teaching-a' };
const placement: BuildingPlanFloorPlacement = {
  sourceFloorId: 'traced-1', label: '2F', elevation: 3.4, offsetX: 0, offsetY: 0, rotationDegrees: 0,
};

function floor(id = 'traced-1', elevation = 0): PlanFloor {
  return {
    id, label: elevation === 0 ? '1F' : '2F', elevation, height: 3.4,
    outline: [[0, 0], [12, 0], [12, 10], [0, 10]],
    rooms: [{ id: `${id}-room`, name: '研討室', polygon: [[1, 1], [5, 1], [5, 4], [1, 4]] }],
    walls: [{ start: [0, 0], end: [12, 0], thickness: 0.2 }],
  };
}

function drawing(): BuildingPlan {
  return {
    version: 1, ...scope, name: '測試教學樓', units: 'm',
    source: { label: '圖面來源', url: 'https://campus.example.edu/maps/1f' },
    floors: [floor()],
  };
}

function twoFloors(): BuildingPlan {
  return { ...drawing(), floors: [floor(), floor('second', 3.4)] };
}

function append(incoming = drawing(), override: Partial<BuildingPlanFloorPlacement> = {}, base = drawing()) {
  return appendBuildingPlanFloor(base, incoming, scope, { ...placement, ...override });
}

function expectRejected(result: { ok: boolean; message?: string }, message: RegExp) {
  expect(result).toEqual({ ok: false, message: expect.stringMatching(message) });
}

function checkValid(plan: BuildingPlan) {
  expect(parseBuildingPlan(JSON.stringify(plan), scope)).toEqual({ ok: true, plan });
}

describe('assembling calibrated floors', () => {
  it('adds a floor with colliding file IDs without renaming any existing floor or room', () => {
    const base = drawing(), incoming = drawing();
    incoming.source = { label: '另一張圖面', url: 'https://campus.example.edu/maps/2f' };
    const snapshots = [JSON.stringify(base), JSON.stringify(incoming)];
    const result = append(incoming, {}, base);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.floors).toHaveLength(2);
    const first = result.plan.floors[0], added = result.plan.floors[1];
    expect(first).toEqual({ ...base.floors[0], source: base.source });
    expect(added.id).toBe(result.addedFloorId);
    expect(added.id).not.toBe(first.id);
    expect(added.rooms[0].id).not.toBe(first.rooms[0].id);
    expect(added).toMatchObject({ label: '2F', elevation: 3.4, height: 3.4, source: incoming.source });
    expect(added.outline).toEqual(incoming.floors[0].outline);
    expect(added.rooms[0].name).toBe('研討室');
    expect(result.plan.name).toBe(base.name);
    expect(result.plan.source).toEqual({ label: '多份圖面組合，請逐層核對來源' });
    expect([JSON.stringify(base), JSON.stringify(incoming)]).toEqual(snapshots);
    checkValid(result.plan);
  });

  it('reserves identifiers already used by earlier assembled floors and rooms', () => {
    const base = drawing();
    base.floors[0].id = 'assembled-floor-1';
    base.floors[0].rooms[0].id = 'assembled-room-1';
    base.floors[0].rooms.push({ ...base.floors[0].rooms[0], id: 'assembled-room-2', name: '另一間' });
    const incoming = drawing();
    incoming.floors[0].rooms.push({ ...incoming.floors[0].rooms[0], id: 'incoming-extra' });
    const result = append(incoming, {}, base);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const ids = result.plan.floors.flatMap(item => item.rooms.map(room => room.id));
    expect(new Set(ids).size).toBe(4);
    expect(new Set(result.plan.floors.map(item => item.id)).size).toBe(2);
    expect(result.plan.floors[0].rooms.map(room => room.id)).toEqual(['assembled-room-1', 'assembled-room-2']);
    checkValid(result.plan);
  });

  it('translates all added geometry by the explicit offsets while leaving the base coordinates unchanged', () => {
    const base = drawing();
    const result = append(drawing(), { offsetX: 2, offsetY: -3 }, base);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const added = result.plan.floors[1];
    expect(added.outline).toEqual([[2, -3], [14, -3], [14, 7], [2, 7]]);
    expect(added.rooms[0].polygon).toEqual([[3, -2], [7, -2], [7, 1], [3, 1]]);
    expect(added.walls).toEqual([{ start: [2, -3], end: [14, -3], thickness: 0.2 }]);
    expect(result.plan.floors[0].outline).toEqual(base.floors[0].outline);
    checkValid(result.plan);
  });

  it.each([
    [90, [[2, 3], [2, 15], [-8, 15], [-8, 3]], [[1, 4], [1, 8], [-2, 8], [-2, 4]], [2, 15]],
    [180, [[2, 3], [-10, 3], [-10, -7], [2, -7]], [[1, 2], [-3, 2], [-3, -1], [1, -1]], [-10, 3]],
    [270, [[2, 3], [2, -9], [12, -9], [12, 3]], [[3, 2], [3, -2], [6, -2], [6, 2]], [2, -9]],
  ] as const)('rotates %s degrees around the file origin before translating', (rotationDegrees, outline, room, wallEnd) => {
    const result = append(drawing(), { rotationDegrees, offsetX: 2, offsetY: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const added = result.plan.floors[1];
    expect(added.outline).toEqual(outline);
    expect(added.rooms[0].polygon).toEqual(room);
    expect(added.walls).toEqual([{ start: [2, 3], end: wallEnd, thickness: 0.2 }]);
    checkValid(result.plan);
  });

  it('does not recenter an incoming file whose origin is not its outline corner', () => {
    const incoming = drawing();
    incoming.floors[0].outline = [[10, 20], [22, 20], [22, 30], [10, 30]];
    incoming.floors[0].rooms = [];
    incoming.floors[0].walls = [{ start: [10, 20], end: [22, 20], thickness: 0.3 }];
    const result = append(incoming, { rotationDegrees: 90, offsetX: 5, offsetY: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.floors[1].outline).toEqual([[-15, 17], [-15, 29], [-25, 29], [-25, 17]]);
    expect(result.plan.floors[1].walls).toEqual([{ start: [-15, 17], end: [-15, 29], thickness: 0.3 }]);
  });

  it('takes exactly the selected floor from a multi-floor file and uses the entered elevation directly', () => {
    const incoming = twoFloors();
    incoming.floors[1].elevation = 20;
    incoming.floors[1].height = 4;
    incoming.floors[1].rooms[0].name = '二樓選定房間';
    const result = append(incoming, { sourceFloorId: 'second', label: '夾層', elevation: -4 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.floors).toHaveLength(2);
    expect(result.plan.floors[0]).toMatchObject({ id: result.addedFloorId, label: '夾層', elevation: -4, height: 4 });
    expect(result.plan.floors[0].rooms.map(room => room.name)).toEqual(['二樓選定房間']);
    expect(result.plan.floors[1].id).toBe('traced-1');
  });

  it('preserves each floor source instead of relabelling every floor with the incoming building URL', () => {
    const base = drawing(), incoming = drawing();
    base.floors[0].source = { label: '原圖一樓', url: 'https://campus.example.edu/revision/a' };
    incoming.floors[0].source = { label: '新增樓層圖', url: 'https://campus.example.edu/revision/b' };
    const result = append(incoming, {}, base);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.floors.map(item => item.source)).toEqual([base.floors[0].source, incoming.floors[0].source]);
    expect(result.plan.source).not.toHaveProperty('url');
    checkValid(result.plan);
  });

  it('keeps an absent source explicit instead of borrowing a source from another file', () => {
    const base = drawing(), incoming = drawing();
    delete base.source;
    delete incoming.source;
    incoming.name = '第二張圖';
    const result = append(incoming, {}, base);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.floors.map(item => item.source)).toEqual([
      { label: '測試教學樓（原檔未提供來源）' }, { label: '第二張圖（原檔未提供來源）' },
    ]);
  });

  it('does not share mutable coordinates or sources with either input', () => {
    const base = drawing(), incoming = drawing();
    const snapshots = [JSON.stringify(base), JSON.stringify(incoming)];
    const result = append(incoming, {}, base);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    result.plan.floors[0].outline[0][0] = 100;
    result.plan.floors[1].rooms[0].polygon[0][0] = 200;
    result.plan.floors[1].source!.label = '修改輸出';
    expect([JSON.stringify(base), JSON.stringify(incoming)]).toEqual(snapshots);
  });
});

describe('assembly boundaries', () => {
  it.each(['base', 'incoming'] as const)('rejects an uncalibrated %s instead of assuming two image scales match', (target) => {
    const base = drawing(), incoming = drawing();
    (target === 'base' ? base : incoming).units = 'relative';
    const snapshots = [JSON.stringify(base), JSON.stringify(incoming)];
    expectRejected(append(incoming, {}, base), /校正為公尺/);
    expect([JSON.stringify(base), JSON.stringify(incoming)]).toEqual(snapshots);
  });

  it('also rejects two relative files even though their unit strings match', () => {
    expectRejected(append({ ...drawing(), units: 'relative' }, {}, { ...drawing(), units: 'relative' }), /相同比例/);
  });

  it.each([
    ['base', 'schoolId'], ['base', 'buildingId'], ['incoming', 'schoolId'], ['incoming', 'buildingId'],
  ] as const)('rejects a %s file with a different %s before assembly', (target, field) => {
    const base = drawing(), incoming = drawing();
    (target === 'base' ? base : incoming)[field] = 'another-scope';
    expectRejected(append(incoming, {}, base), /不屬於目前學校或建築/);
  });

  it('rejects a missing source floor instead of choosing the first floor', () => {
    expectRejected(append(drawing(), { sourceFloorId: 'missing' }), /找不到指定樓層/);
  });

  it.each([NaN, Infinity, -Infinity, '2', null])('rejects invalid horizontal offsets: %s', (value) => {
    expectRejected(append(drawing(), { offsetX: value as number }), /平移/);
    expectRejected(append(drawing(), { offsetY: value as number }), /平移/);
  });

  it.each([-90, 45, 360, NaN, '90', null])('rejects unsupported rotation: %s', (value) => {
    expectRejected(append(drawing(), { rotationDegrees: value as BuildingPlanFloorPlacement['rotationDegrees'] }), /旋轉/);
  });

  it.each([NaN, Infinity, -30.1, 150.1, '3.4', null])('rejects invalid elevation: %s', (value) => {
    expectRejected(append(drawing(), { elevation: value as number }), /樓層高度/);
  });

  it.each(['', ' ', '樓'.repeat(101)])('rejects an invalid display label', (label) => {
    expectRejected(append(drawing(), { label }), /樓層名稱/);
  });

  it('rejects vertical overlap without shifting either floor automatically', () => {
    const base = drawing(), incoming = drawing();
    const snapshots = [JSON.stringify(base), JSON.stringify(incoming)];
    expectRejected(append(incoming, { elevation: 3.39 }, base), /互相重疊/);
    expect([JSON.stringify(base), JSON.stringify(incoming)]).toEqual(snapshots);
  });

  it('rechecks the combined extent and individual coordinates after a translation', () => {
    expectRejected(append(drawing(), { offsetX: 301 }), /範圍過大/);
    expectRejected(append(drawing(), { offsetY: 501 }), /平面座標/);
  });

  it('validates all of an incoming file, including a broken floor that was not selected', () => {
    const incoming = twoFloors();
    incoming.floors[1].rooms[0].polygon = [[30, 30], [40, 30], [40, 40], [30, 40]];
    expectRejected(append(incoming), /房間範圍超出/);
  });

  it('does not accept a thirteenth floor even if both input files are within the per-file limit', () => {
    const base = drawing();
    base.floors = Array.from({ length: 12 }, (_, index) => floor(`floor-${index}`, index * 3.4));
    expectRejected(append(drawing(), { elevation: 12 * 3.4 }, base), /1 到 12 個樓層/);
  });

  it('enforces the combined room and wall budgets', () => {
    const base = drawing(), incoming = drawing();
    base.floors[0].rooms = Array.from({ length: 200 }, (_, index) => ({ ...base.floors[0].rooms[0], id: `room-${index}` }));
    expectRejected(append(incoming, {}, base), /最多 200 個房間/);
    base.floors[0].rooms = [];
    base.floors[0].walls = Array.from({ length: 512 }, () => ({ start: [0, 0], end: [12, 0], thickness: 0.2 }));
    expectRejected(append(incoming, {}, base), /最多 512 段牆面/);
  });

  it('applies the UTF-8 file budget to the combined result, not only to individual files', () => {
    const base = drawing(), incoming = drawing();
    const ring: PlanPoint[] = Array.from({ length: 64 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return [Number((6 + Math.cos(angle) * 4).toFixed(6)), Number((5 + Math.sin(angle) * 4).toFixed(6))];
    });
    for (const plan of [base, incoming]) {
      plan.floors[0].rooms = Array.from({ length: 100 }, (_, index) => ({
        id: `room-${index}`, name: '教'.repeat(100), polygon: ring,
      }));
      checkValid(plan);
      expect(new TextEncoder().encode(JSON.stringify(plan)).byteLength).toBeLessThan(MAX_BUILDING_PLAN_BYTES);
    }
    expectRejected(append(incoming, {}, base), /圖面檔案太大/);
  });

  it('rejects an oversized input even if the extra data would be stripped from the result', () => {
    const incoming = { ...drawing(), padding: '圖'.repeat(90_000) };
    expectRejected(append(incoming), /圖面檔案太大/);
  });

  it('rejects an unsafe floor source URL and strips verification or navigation claims from accepted files', () => {
    const incoming = drawing();
    incoming.floors[0].source = { label: '來源', url: 'javascript:alert(1)' };
    expectRejected(append(incoming), /來源網址/);
    incoming.floors[0].source = { label: '來源', url: 'https://campus.example.edu/2f' };
    const untrusted = { ...incoming, verified: true, navigationHref: '/map?focus=official', floors: [{
      ...incoming.floors[0], verified: true,
      source: { ...incoming.floors[0].source, verified: true },
      rooms: incoming.floors[0].rooms.map(room => ({ ...room, verified: true, poiId: 'official-room' })),
    }] };
    const result = append(untrusted);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan).not.toHaveProperty('verified');
    expect(result.plan).not.toHaveProperty('navigationHref');
    expect(result.plan.floors[1]).not.toHaveProperty('verified');
    expect(result.plan.floors[1].source).not.toHaveProperty('verified');
    expect(result.plan.floors[1].rooms[0]).not.toHaveProperty('poiId');
    checkValid(result.plan);
  });
});

describe('editing floor details', () => {
  it('updates the label, absolute elevation and height without moving or renumbering horizontal geometry', () => {
    const plan = twoFloors();
    const snapshot = JSON.stringify(plan);
    const result = updateBuildingPlanFloor(plan, scope, 'second', { label: '  B1  ', elevation: -4, height: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.floors.map(item => item.id)).toEqual(['second', 'traced-1']);
    expect(result.plan.floors[0]).toEqual({ ...plan.floors[1], label: 'B1', elevation: -4, height: 4 });
    expect(result.plan.floors[1]).toEqual(plan.floors[0]);
    expect(JSON.stringify(plan)).toBe(snapshot);
    checkValid(result.plan);
  });

  it('keeps relative units when adjusting an existing uncalibrated drawing', () => {
    const plan: BuildingPlan = { ...drawing(), units: 'relative' };
    const result = updateBuildingPlanFloor(plan, scope, 'traced-1', { label: '示意樓層', elevation: 10, height: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.units).toBe('relative');
    expect(result.plan.floors[0]).toMatchObject({ label: '示意樓層', elevation: 10, height: 2 });
    expect(result.plan.source).toEqual(plan.source);
  });

  it.each([
    { label: '', elevation: 3.4, height: 3.4 },
    { label: '2F', elevation: NaN, height: 3.4 },
    { label: '2F', elevation: Infinity, height: 3.4 },
    { label: '2F', elevation: 151, height: 3.4 },
    { label: '2F', elevation: 3.4, height: 0 },
    { label: '2F', elevation: 3.4, height: 10.1 },
    { label: '2F', elevation: 3.4, height: NaN },
  ])('rejects invalid details without changing the input: %s', (details) => {
    const plan = twoFloors(), snapshot = JSON.stringify(plan);
    expect(updateBuildingPlanFloor(plan, scope, 'second', details).ok).toBe(false);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it('refuses a changed height that would overlap an existing floor without lifting that floor', () => {
    expectRejected(updateBuildingPlanFloor(twoFloors(), scope, 'traced-1', { label: '1F', elevation: 0, height: 4 }), /互相重疊/);
  });

  it('rejects missing floor IDs and cross-scope edits', () => {
    const details = { label: '2F', elevation: 3.4, height: 3.4 };
    expectRejected(updateBuildingPlanFloor(twoFloors(), scope, 'missing', details), /找不到指定樓層/);
    expectRejected(updateBuildingPlanFloor(twoFloors(), { ...scope, schoolId: 'another' }, 'second', details), /不屬於目前學校/);
  });

  it('preserves per-floor source provenance and returns independent data', () => {
    const plan = drawing();
    plan.floors[0].source = { label: '該層圖面', url: 'https://campus.example.edu/1f' };
    const snapshot = JSON.stringify(plan);
    const result = updateBuildingPlanFloor(plan, scope, 'traced-1', { label: 'GF', elevation: 0, height: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.floors[0].source).toEqual(plan.floors[0].source);
    result.plan.floors[0].source!.label = '修改輸出';
    result.plan.floors[0].rooms[0].polygon[0][0] = 50;
    expect(JSON.stringify(plan)).toBe(snapshot);
  });
});

describe('removing floors', () => {
  it('removes only the selected floor, leaving remaining coordinates, elevation, IDs and sources intact', () => {
    const plan = twoFloors();
    plan.floors[1].source = { label: '二樓來源', url: 'https://campus.example.edu/2f' };
    const snapshot = JSON.stringify(plan);
    const result = removeBuildingPlanFloor(plan, scope, 'traced-1');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.floors).toEqual([plan.floors[1]]);
    expect(result.plan.source).toEqual(plan.source);
    expect(JSON.stringify(plan)).toBe(snapshot);
    checkValid(result.plan);
  });

  it('refuses to remove the only floor', () => {
    expectRejected(removeBuildingPlanFloor(drawing(), scope, 'traced-1'), /至少需要保留一個樓層/);
  });

  it('refuses a missing floor without removing a different floor', () => {
    expectRejected(removeBuildingPlanFloor(twoFloors(), scope, 'missing'), /找不到指定樓層/);
  });

  it('validates scope and all original geometry before removal', () => {
    const plan = twoFloors();
    expectRejected(removeBuildingPlanFloor(plan, { ...scope, buildingId: 'another' }, 'traced-1'), /不屬於目前學校/);
    plan.floors[1].height = 0;
    expectRejected(removeBuildingPlanFloor(plan, scope, 'second'), /樓高/);
  });
});

describe('two-point floor alignment suggestions', () => {
  it.each([
    [0, [9, 6]],
    [90, [5, 10]],
    [180, [1, 6]],
    [270, [5, 2]],
  ] as const)('finds an exact %s-degree quarter-turn using corresponding corners', (rotationDegrees, b) => {
    const sourceA: PlanPoint = [10, 20], sourceB: PlanPoint = [14, 20];
    const a: PlanPoint = [5, 6];
    const snapshots = JSON.stringify([sourceA, sourceB, a, b]);
    const result = suggestBuildingPlanFloorAlignment({
      referenceA: a, referenceB: [...b], incomingA: sourceA, incomingB: sourceB,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.rotationDegrees).toBe(rotationDegrees);
    expect(result.errorMetres).toBe(0);
    expect(JSON.stringify([sourceA, sourceB, a, b])).toBe(snapshots);
  });

  it('honours the first anchor exactly instead of silently stretching incoming geometry', () => {
    const result = suggestBuildingPlanFloorAlignment({
      referenceA: [5, 7], referenceB: [17, 7],
      incomingA: [2, 3], incomingB: [2, -9],
    });
    expect(result).toEqual({ ok: true, rotationDegrees: 90, offsetX: 8, offsetY: 5, errorMetres: 0 });
  });

  it('allows a small rounding mismatch but keeps the first anchor fixed', () => {
    const result = suggestBuildingPlanFloorAlignment({
      referenceA: [0, 0], referenceB: [10.15, 0.1],
      incomingA: [0, 0], incomingB: [10, 0],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.rotationDegrees).toBe(0);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(result.errorMetres).toBeCloseTo(Math.hypot(0.15, 0.1));
  });

  it.each([
    ['different scales', [0, 0], [12, 0], [0, 0], [10, 0], /距離不一致/],
    ['non-quarter-turn rotation', [0, 0], [7.07106781, 7.07106781], [0, 0], [10, 0], /90°/],
    ['same reference anchor', [0, 0], [0, 0], [0, 0], [10, 0], /0.5 公尺/],
    ['same source anchor', [0, 0], [10, 0], [0, 0], [0, 0], /0.5 公尺/],
    ['invalid anchor', [0, 0], [10, 0], [0, NaN], [10, 0], /有效/],
  ] as const)('rejects %s instead of creating an unreliable transform', (_, referenceA, referenceB, incomingA, incomingB, message) => {
    const result = suggestBuildingPlanFloorAlignment({
      referenceA: [...referenceA], referenceB: [...referenceB],
      incomingA: [...incomingA], incomingB: [...incomingB],
    });
    expect(result).toEqual({ ok: false, message: expect.stringMatching(message) });
  });

  it('rejects an omitted anchor rather than defaulting to another corner', () => {
    expect(suggestBuildingPlanFloorAlignment({
      referenceA: [0, 0], referenceB: [10, 0], incomingA: undefined, incomingB: [10, 0],
    })).toEqual({ ok: false, message: expect.stringMatching(/有效/) });
  });
});
