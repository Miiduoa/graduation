import { describe, expect, it } from 'vitest';
import {
  createExampleBuildingPlan,
  MAX_BUILDING_PLAN_BYTES,
  parseBuildingPlan,
  type BuildingPlan,
  type BuildingPlanScope,
  type PlanFloor,
  type PlanPoint,
} from './buildingPlan';

const scope: BuildingPlanScope = { schoolId: 'campus-a', buildingId: 'teaching-a' };

function floor(id = '1f', elevation = 0): PlanFloor {
  return {
    id,
    label: id.toUpperCase(),
    elevation,
    height: 3.4,
    outline: [[0, 0], [12, 0], [12, 10], [0, 10]],
    rooms: [{ id: `${id}-101`, name: '測試教室', polygon: [[1, 1], [5, 1], [5, 4], [1, 4]] }],
    walls: [{ start: [0, 0], end: [12, 0], thickness: 0.2 }],
  };
}

function drawing(): BuildingPlan {
  return {
    version: 1,
    ...scope,
    name: '測試教學樓',
    units: 'm',
    floors: [floor()],
  };
}

function parse(value: unknown, target = scope) {
  return parseBuildingPlan(JSON.stringify(value), target);
}

function expectRejected(value: unknown, message: RegExp) {
  expect(parse(value)).toEqual({ ok: false, message: expect.stringMatching(message) });
}

describe('building plan import boundary', () => {
  it('round-trips the downloadable example without losing floors, walls or rooms', () => {
    const example = createExampleBuildingPlan(scope);
    const result = parse(example);
    expect(result).toEqual({ ok: true, plan: example });
    if (!result.ok) throw new Error(result.message);
    expect(parse(result.plan)).toEqual(result);
  });

  it('sorts an imported basement and adjoining upper floor by elevation', () => {
    const result = parse({ ...drawing(), floors: [floor('ground', 0), floor('basement', -3.4)] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.floors.map(({ id }) => id)).toEqual(['basement', 'ground']);
    expect(result.plan.floors[0].elevation).toBe(-3.4);
  });

  it.each([
    { schoolId: 'campus-b', buildingId: scope.buildingId },
    { schoolId: scope.schoolId, buildingId: 'teaching-b' },
  ])('rejects an import after the active location changes to $schoolId / $buildingId', (target) => {
    expect(parse(drawing(), target)).toEqual({
      ok: false,
      message: expect.stringMatching(/不屬於目前學校或建築/),
    });
  });

  it('does not turn imported verification, POI or route claims into trusted data', () => {
    const example = createExampleBuildingPlan(scope);
    const untrusted = {
      ...example,
      verified: true,
      verification: 'verified',
      navigationRoute: 'official-route',
      source: { ...example.source, verification: 'verified', verifiedAt: '2026-11-08' },
      floors: example.floors.map((item) => ({
        ...item,
        verified: true,
        rooms: item.rooms.map((room) => ({
          ...room,
          verified: true,
          poiId: 'official-room',
          navigationHref: '/map?focus=official-room',
        })),
      })),
    };
    expect(parse(untrusted)).toEqual({ ok: true, plan: example });
  });

  it.each(['cm', 'mm', 'meters', 'ft', undefined])('rejects unsupported units %s', (units) => {
    expectRejected({ ...drawing(), units }, /公尺/);
  });

  it('preserves an uncalibrated drawing as relative units through export and reimport', () => {
    const uncalibrated = { ...drawing(), units: 'relative', verified: true };
    const result = parse(uncalibrated);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.units).toBe('relative');
    expect(result.plan).not.toHaveProperty('verified');
    expect(parse(result.plan)).toEqual(result);
    expect(parse(result.plan, { ...scope, schoolId: 'another-school' }).ok).toBe(false);
  });

  it('reports malformed JSON without throwing', () => {
    expect(parseBuildingPlan('{"floors":', scope)).toEqual({
      ok: false,
      message: expect.stringMatching(/JSON/),
    });
  });

  it.each([0, -1, 10.1, '3.4', null])('rejects an unusable floor height %s', (height) => {
    expectRejected({ ...drawing(), floors: [{ ...floor(), height }] }, /樓高/);
  });

  it.each([-30.1, 150.1])('rejects a floor elevation outside the building limit: %s', (elevation) => {
    expectRejected({ ...drawing(), floors: [floor('1f', elevation)] }, /樓層高度/);
  });

  it('rejects overlapping storeys even when the file orders them from top to bottom', () => {
    expectRejected({ ...drawing(), floors: [floor('2f', 3.3), floor()] }, /樓層高度互相重疊/);
  });

  it('rejects duplicate room identities across separate floors', () => {
    const first = floor();
    const second = floor('2f', 3.4);
    second.rooms[0].id = first.rooms[0].id;
    expectRejected({ ...drawing(), floors: [first, second] }, /房間代碼不可重複/);
  });

  it('rejects duplicate floor identities before presenting a floor selector', () => {
    const second = floor('2f', 3.4);
    second.id = '1f';
    expectRejected({ ...drawing(), floors: [floor(), second] }, /樓層代碼不可重複/);
  });
});

describe('building geometry validation', () => {
  it.each(['outline', 'room'] as const)('rejects a self-crossing %s with nonzero signed area', (target) => {
    const plan = drawing();
    const crossing: PlanPoint[] = [[1, 1], [8, 7], [1, 8], [6, 1]];
    if (target === 'outline') {
      plan.floors[0].outline = crossing;
      plan.floors[0].rooms = [];
      plan.floors[0].walls = [];
    } else {
      plan.floors[0].rooms[0].polygon = crossing;
    }
    expectRejected(plan, /邊線互相交錯/);
  });

  it('rejects a collinear room that has no floor area', () => {
    const plan = drawing();
    plan.floors[0].rooms[0].polygon = [[1, 1], [3, 1], [5, 1]];
    expectRejected(plan, /面積/);
  });

  it('rejects a tiny tracing crossover even when the rest of the room has a large area', () => {
    const plan = drawing();
    plan.floors[0].rooms[0].polygon = [
      [1, 2], [11, 2], [11, 9], [1, 9], [5.99, 2.00001], [6.01, 1.99999], [1, 1],
    ];
    expectRejected(plan, /邊線互相交錯/);
  });

  it('rejects an enormous coordinate before constructing any geometry', () => {
    const plan = drawing();
    plan.floors[0].outline[1] = [1_000_000, 0];
    expectRejected(plan, /平面座標/);
  });

  it('rejects a non-finite JSON number rather than passing it to the renderer', () => {
    const input = JSON.stringify(drawing()).replace('"elevation":0', '"elevation":1e999');
    expect(parseBuildingPlan(input, scope)).toEqual({
      ok: false,
      message: expect.stringMatching(/樓層高度/),
    });
  });

  it('rejects a campus-sized outline even when every coordinate is within the numeric bounds', () => {
    const plan = drawing();
    plan.floors[0].outline = [[0, 0], [301, 0], [301, 10], [0, 10]];
    expectRejected(plan, /範圍過大/);
  });

  const concaveOutline: PlanPoint[] = [
    [0, 0], [10, 0], [10, 10], [7, 10], [7, 2], [6, 2], [6, 10], [0, 10],
  ];

  it('rejects a room that bridges a concave notch although its vertices and edge midpoints are inside', () => {
    const plan = drawing();
    plan.floors[0].outline = concaveOutline;
    plan.floors[0].walls = [];
    // The narrow missing strip at x=6..7 is away from each edge midpoint.
    plan.floors[0].rooms[0].polygon = [[1, 4], [9, 4], [9, 8], [1, 8]];
    expectRejected(plan, /房間範圍超出樓層外框/);
  });

  it('keeps a valid room inside a concave building and accepts the reverse winding', () => {
    const plan = drawing();
    plan.floors[0].outline = [...concaveOutline].reverse();
    plan.floors[0].walls = [];
    plan.floors[0].rooms[0].polygon = [[1, 4], [4, 4], [4, 8], [1, 8]];
    expect(parse(plan).ok).toBe(true);
  });

  it('rejects a wall bridging the same concave notch', () => {
    const plan = drawing();
    plan.floors[0].outline = concaveOutline;
    plan.floors[0].rooms = [];
    plan.floors[0].walls = [{ start: [1, 5], end: [9, 5], thickness: 0.2 }];
    expectRejected(plan, /牆面長度或位置不正確/);
  });
});

describe('building plan sources and resource budgets', () => {
  it('preserves a full HTTPS source URL without fetching it', () => {
    const source = { label: '樓層配置來源', url: 'https://campus.example.edu/maps/building?lang=zh-TW#floor-1' };
    const result = parse({ ...drawing(), source });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.source).toEqual(source);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///tmp/plan.json',
    'http://campus.example.edu/floor',
    'https://user:password@campus.example.edu/floor',
    'https://user@campus.example.edu/floor',
  ])('rejects unsafe source URL %s', (url) => {
    expectRejected({ ...drawing(), source: { label: '來源', url } }, /來源網址/);
  });

  it('gives a useful Chinese message for a malformed source URL', () => {
    const result = parse({ ...drawing(), source: { label: '來源', url: '這不是完整網址' } });
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/網址/) });
    if (result.ok) throw new Error('Malformed source unexpectedly accepted');
    expect(result.message).not.toMatch(/Invalid URL/);
  });

  it('rejects an oversized JSON file even when the extra data would otherwise be ignored', () => {
    const input = JSON.stringify({ ...drawing(), padding: 'a'.repeat(MAX_BUILDING_PLAN_BYTES) });
    expect(parseBuildingPlan(input, scope)).toEqual({
      ok: false,
      message: expect.stringMatching(/圖面檔案太大/),
    });
  });

  it('counts UTF-8 bytes so a multibyte file cannot bypass the size limit', () => {
    const input = JSON.stringify({ ...drawing(), padding: '圖'.repeat(Math.ceil(MAX_BUILDING_PLAN_BYTES / 3)) });
    expect(input.length).toBeLessThan(MAX_BUILDING_PLAN_BYTES);
    expect(new TextEncoder().encode(input).byteLength).toBeGreaterThan(MAX_BUILDING_PLAN_BYTES);
    expect(parseBuildingPlan(input, scope)).toEqual({
      ok: false,
      message: expect.stringMatching(/圖面檔案太大/),
    });
  });

  it('caps the number of storeys rather than allocating one scene per imported floor', () => {
    const floors = Array.from({ length: 13 }, (_, index) => floor(`floor-${index}`, index * 3.4));
    expectRejected({ ...drawing(), floors }, /1 到 12 個樓層/);
  });

  it('caps the total room count across floors rather than just each floor', () => {
    const floors = [floor('1f'), floor('2f', 3.4)];
    for (const [index, item] of floors.entries()) {
      const room = item.rooms[0];
      item.rooms = Array.from({ length: index === 0 ? 100 : 101 }, (_, count) => ({
        ...room, id: `${item.id}-room-${count}`,
      }));
    }
    expectRejected({ ...drawing(), floors }, /最多 200 個房間/);
  });

  it('caps wall segments across floors before they become hundreds of extra meshes', () => {
    const floors = [floor('1f'), floor('2f', 3.4)];
    for (const [index, item] of floors.entries()) {
      item.walls = Array.from({ length: index === 0 ? 256 : 257 }, () => ({
        start: [1, 8], end: [11, 8], thickness: 0.2,
      }));
    }
    expectRejected({ ...drawing(), floors }, /最多 512 段牆面/);
  });

  it('bounds polygon complexity while allowing a valid 64-vertex shape', () => {
    const plan = drawing();
    plan.floors[0].rooms = [];
    plan.floors[0].walls = [];
    const circle = (count: number): PlanPoint[] => Array.from({ length: count }, (_, index) => {
      const angle = index / count * Math.PI * 2;
      return [6 + Math.cos(angle) * 4, 5 + Math.sin(angle) * 4];
    });
    plan.floors[0].outline = circle(64);
    expect(parse(plan).ok).toBe(true);
    plan.floors[0].outline = circle(65);
    expectRejected(plan, /3 到 64 個頂點/);
  });
});
