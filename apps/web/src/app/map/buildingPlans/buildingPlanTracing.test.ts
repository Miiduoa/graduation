import { describe, expect, it } from 'vitest';
import { parseBuildingPlan, type BuildingPlanScope, type PlanPoint } from './buildingPlan';
import { buildTracedBuildingPlan, type PlanTraceDraft } from './buildingPlanTracing';

const scope: BuildingPlanScope = { schoolId: 'campus-a', buildingId: 'teaching-a' };

function draft(): PlanTraceDraft {
  return {
    name: '教學樓描圖', floorLabel: '1F', imageWidth: 1000, imageHeight: 500,
    outline: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
    rooms: [{ id: 'room-101', name: '教室 101', polygon: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.6], [0.2, 0.6]] }],
    source: { label: '人工描圖，來源待核對', url: 'https://example.com/floor-plan' },
  };
}

function build(input: PlanTraceDraft) {
  const result = buildTracedBuildingPlan(input, scope);
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

function expectRejected(input: PlanTraceDraft, message: RegExp) {
  expect(buildTracedBuildingPlan(input, scope)).toEqual({ ok: false, message: expect.stringMatching(message) });
}

describe('unverified image tracing', () => {
  it('keeps the image aspect ratio, shifts to the outline origin and marks uncalibrated units', () => {
    const input = draft();
    const before = structuredClone(input);
    const plan = build(input);
    const floor = plan.floors[0];
    expect(plan).toMatchObject({ version: 1, ...scope, name: input.name, units: 'relative', source: input.source });
    expect(plan.floors).toHaveLength(1);
    expect(floor).toMatchObject({ id: 'traced-1', label: '1F', height: 3, elevation: 0 });
    expect(floor.outline[0]).toEqual([0, 0]);
    expect(floor.outline[2][0]).toBeCloseTo(16);
    expect(floor.outline[2][1]).toBeCloseTo(8);
    expect(floor.rooms[0]).toMatchObject({ id: 'room-101', name: '教室 101' });
    expect(floor.rooms[0].polygon[0][0]).toBeCloseTo(2);
    expect(floor.rooms[0].polygon[0][1]).toBeCloseTo(1);
    expect(floor.walls).toHaveLength(4);
    expect(floor.walls[0]).toEqual({ start: floor.outline[0], end: floor.outline[1], thickness: 0.15 });
    expect(floor.walls[3]).toEqual({ start: floor.outline[3], end: floor.outline[0], thickness: 0.15 });
    expect(input).toEqual(before);
    expect(parseBuildingPlan(JSON.stringify(plan), scope)).toEqual({ ok: true, plan });
  });

  it('scales a portrait image using its height without stretching either axis', () => {
    const input = draft();
    input.imageWidth = 500;
    input.imageHeight = 1000;
    const floor = build(input).floors[0];
    expect(floor.outline[2][0]).toBeCloseTo(8);
    expect(floor.outline[2][1]).toBeCloseTo(16);
  });

  it('permits an empty room list while keeping the manually traced outer walls', () => {
    const input = draft();
    input.rooms = [];
    expect(build(input).floors[0].rooms).toEqual([]);
  });

  it('uses only the active scope and strips unrelated trust or route claims through the import parser', () => {
    const input = Object.assign(draft(), { schoolId: 'other', buildingId: 'other', verified: true, route: 'official' });
    Object.assign(input.source, { verified: true });
    const plan = build(input);
    expect(plan.schoolId).toBe(scope.schoolId);
    expect(plan.buildingId).toBe(scope.buildingId);
    expect(plan).not.toHaveProperty('verified');
    expect(plan).not.toHaveProperty('route');
    expect(plan.source).not.toHaveProperty('verified');
  });
});

describe('measured scale calibration', () => {
  it('accepts a known image distance outside the outline and requires the supplied real floor height', () => {
    const input = draft();
    input.calibration = { start: [0, 0], end: [1, 0], metres: 50 };
    input.floorHeight = 4.2;
    const plan = build(input);
    expect(plan.units).toBe('m');
    expect(plan.floors[0].height).toBe(4.2);
    expect(plan.floors[0].outline[2][0]).toBeCloseTo(40);
    expect(plan.floors[0].outline[2][1]).toBeCloseTo(20);
  });

  it('calibrates a diagonal in pixel space, so a non-square image keeps its physical proportions', () => {
    const input = draft();
    input.calibration = { start: [0.2, 0.2], end: [0.6, 0.8], metres: 10 };
    input.floorHeight = 3.5;
    const floor = build(input).floors[0];
    // The selected 400 by 300 pixel diagonal is 500 pixels long, representing 10 m.
    expect(floor.outline[2][0]).toBeCloseTo(16);
    expect(floor.outline[2][1]).toBeCloseTo(8);
  });

  it.each([undefined, 0, 0.9, 10.1, NaN, Infinity])('rejects missing or invalid measured floor height %s', floorHeight => {
    const input = draft();
    input.calibration = { start: [0, 0], end: [1, 0], metres: 20 };
    input.floorHeight = floorHeight;
    expectRejected(input, /樓高/);
  });

  it.each([1, 10])('accepts the measured floor height boundary %s', floorHeight => {
    const input = draft();
    input.calibration = { start: [0, 0], end: [1, 0], metres: 20 };
    input.floorHeight = floorHeight;
    expect(build(input).floors[0].height).toBe(floorHeight);
  });

  it.each([0, -1, NaN, Infinity])('rejects an unusable known metre distance %s', metres => {
    const input = draft();
    input.calibration = { start: [0, 0], end: [1, 0], metres };
    input.floorHeight = 3;
    expectRejected(input, /校正距離/);
  });

  it.each([0, 0.00001, 0.0049])('rejects coincident or unreliable close calibration points %s', endX => {
    const input = draft();
    input.calibration = { start: [0, 0], end: [endX, 0], metres: 1 };
    input.floorHeight = 3;
    expectRejected(input, /校正點距離太近/);
  });

  it('retains the two-pixel minimum for a small image', () => {
    const input = draft();
    input.imageWidth = 100;
    input.imageHeight = 100;
    input.calibration = { start: [0, 0], end: [0.019, 0], metres: 1 };
    input.floorHeight = 3;
    expectRejected(input, /校正點距離太近/);
    input.calibration.end = [0.02, 0];
    expect(build(input).units).toBe('m');
  });

  it('rejects a calibrated building exceeding the common 300-unit footprint limit', () => {
    const input = draft();
    input.calibration = { start: [0, 0], end: [1, 0], metres: 400 };
    input.floorHeight = 3;
    expectRejected(input, /範圍過大/);
  });
});

describe('tracing input boundary', () => {
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid image dimensions %s', imageWidth => {
    expectRejected({ ...draft(), imageWidth }, /圖片尺寸/);
  });

  it('rejects an oversized reference before transforming points', () => {
    expectRejected({ ...draft(), imageWidth: 6000, imageHeight: 4001 }, /圖片尺寸/);
  });

  it.each([-0.001, 1.001, NaN, Infinity])('rejects an out-of-image or non-finite coordinate %s', x => {
    const input = draft();
    input.outline[0] = [x, 0.1];
    expectRejected(input, /描圖座標/);
  });

  it('also validates room and calibration coordinates before conversion', () => {
    const room = draft();
    room.rooms[0].polygon[0] = [0.2, 1.01];
    expectRejected(room, /描圖座標/);
    const calibrated = draft();
    calibrated.calibration = { start: [-0.1, 0], end: [1, 0], metres: 20 };
    calibrated.floorHeight = 3;
    expectRejected(calibrated, /描圖座標/);
  });

  it.each([2, 65])('rejects an invalid outer vertex count %s', count => {
    expectRejected({ ...draft(), outline: Array.from({ length: count }, () => [0, 0] as PlanPoint) }, /3 到 64/);
  });

  it('rejects too many rooms before constructing their transformed polygons', () => {
    const input = draft();
    input.rooms = Array.from({ length: 201 }, (_, i) => ({ ...input.rooms[0], id: `room-${i}` }));
    expectRejected(input, /200/);
  });

  it.each(['outline', 'room'] as const)('uses the existing parser to reject a self-crossing %s', target => {
    const input = draft();
    const crossing: PlanPoint[] = [[0.2, 0.2], [0.8, 0.7], [0.2, 0.8], [0.6, 0.2]];
    if (target === 'outline') { input.outline = crossing; input.rooms = []; }
    else input.rooms[0].polygon = crossing;
    expectRejected(input, /邊線互相交錯/);
  });

  it('rejects a room outside the outline even when it stays inside the image', () => {
    const input = draft();
    input.rooms[0].polygon[0] = [0, 0];
    expectRejected(input, /超出樓層外框/);
  });

  it('rejects duplicate room IDs through the common import parser', () => {
    const input = draft();
    input.rooms.push(structuredClone(input.rooms[0]));
    expectRejected(input, /房間代碼不可重複/);
  });

  it.each(['http://example.com/plan', 'javascript:alert(1)', 'https://user:password@example.com/plan'])
  ('preserves the common source URL boundary for %s', url => {
    expectRejected({ ...draft(), source: { label: '待核對', url } }, /HTTPS/);
  });

  it('requires a source label instead of silently promoting an unnamed drawing', () => {
    expectRejected({ ...draft(), source: { label: '' } }, /來源名稱/);
  });
});
