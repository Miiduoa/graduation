import { describe, expect, it } from 'vitest';
import {
  CAMPUS_SPATIAL_PRODUCTS,
  validateCampusSpatialBenchmarkRows,
  type CampusSpatialBenchmarkRow,
} from './campusSpatialBenchmark';

// All records below are synthetic validator fixtures, NOT campus observations
// or product rankings. The .invalid URLs cannot serve as field-test evidence.
function fixture(trialId: string): CampusSpatialBenchmarkRow[] {
  return CAMPUS_SPATIAL_PRODUCTS.map((product) => ({
    trialId, product, task: 'timetable-to-building',
    schoolId: 'pu', sceneId: 'synthetic-hall-case',
    deviceId: 'synthetic-device-A', osVersion: 'synthetic-os',
    network: 'wifi', locationPermission: 'allowed',
    textScale: '100%', startState: 'prepared',
    destinationId: 'synthetic-building', groundTruthLevel: 'building',
    groundTruthUrl: 'https://source.invalid/synthetic',
    testedAt: '2026-11-19T01:00:00.000Z', appVersion: 'fixture-only',
    evidenceUrl: `https://evidence.invalid/${trialId}/${product}`,
    outcome: 'correct', destinationLevel: 'building',
    buildingCorrect: true, roomCorrect: null, routeVerified: null,
    steps: 2, elapsedMs: 2000, fpsP50: null, visualScore: null,
  }));
}

describe('campus spatial benchmark evidence gate', () => {
  it('requires three complete paired repetitions before a task is reviewable', () => {
    const one = validateCampusSpatialBenchmarkRows(fixture('synthetic-1'));
    expect(one.valid).toBe(true);
    expect(one.completeTrials).toBe(1);
    expect(one.reviewableTasks).toEqual([]);

    const result = validateCampusSpatialBenchmarkRows([
      ...fixture('synthetic-1'), ...fixture('synthetic-2'), ...fixture('synthetic-3'),
    ]);
    expect(result.valid).toBe(true);
    expect(result.completeTrials).toBe(3);
    expect(result.reviewableTasks).toEqual(['timetable-to-building']);
  });

  it('cannot compare a run missing UniTable or with repeated results from one product', () => {
    const incomplete = fixture('synthetic-1').filter((row) => row.product !== 'unitable');
    expect(validateCampusSpatialBenchmarkRows(incomplete).issues.join(' ')).toContain('unitable');
    const repeated = [...fixture('synthetic-1'), fixture('synthetic-1')[0]];
    expect(validateCampusSpatialBenchmarkRows(repeated).issues.join(' ')).toContain('duplicate product');
  });

  it('rejects different devices, settings, task, or destination as a matched trial', () => {
    const changed = fixture('synthetic-1');
    changed[1] = { ...changed[1], deviceId: 'different-device', destinationId: 'wrong-building' };
    const result = validateCampusSpatialBenchmarkRows(changed);
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('mismatched deviceId');
    expect(result.issues.join(' ')).toContain('mismatched destinationId');
  });

  it('never counts building-only evidence as a correct room or walking route', () => {
    const rooms = fixture('synthetic-1');
    rooms[0] = { ...rooms[0], destinationLevel: 'room', roomCorrect: true };
    expect(validateCampusSpatialBenchmarkRows(rooms).issues.join(' ')).toContain('exceeds verified destination');

    const routes = fixture('synthetic-2').map((row) => ({
      ...row, task: 'walking-route' as const, routeVerified: false,
    }));
    expect(validateCampusSpatialBenchmarkRows(routes).issues.join(' ')).toContain('route evidence');
  });

  it('requires real evidence links, plausible measurements, and a visual rubric', () => {
    const rows = fixture('synthetic-1');
    rows[0] = {
      ...rows[0], evidenceUrl: 'file:///private/photo.png',
      elapsedMs: -1, fpsP50: 999, visualScore: 5,
    };
    const result = validateCampusSpatialBenchmarkRows(rows);
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('HTTPS evidence');
    expect(result.issues.join(' ')).toContain('elapsed time');
    expect(result.issues.join(' ')).toContain('fpsP50');
    expect(result.issues.join(' ')).toContain('named rubric');

    const missing = fixture('synthetic-2');
    missing[0] = { ...missing[0], steps: null, elapsedMs: null };
    expect(validateCampusSpatialBenchmarkRows(missing).issues.join(' ')).toContain('measured steps');

    const visual = fixture('synthetic-3').map((row) => ({
      ...row, task: 'visual-performance' as const,
    }));
    expect(validateCampusSpatialBenchmarkRows(visual).issues.join(' ')).toContain('measured FPS');
  });

  it('does not turn missing or unverified observations into a comparative claim', () => {
    expect(validateCampusSpatialBenchmarkRows([]).valid).toBe(false);
    const rows = [...fixture('synthetic-1'), ...fixture('synthetic-2'), ...fixture('synthetic-3')];
    rows[0] = { ...rows[0], outcome: 'unverified', buildingCorrect: null };
    const result = validateCampusSpatialBenchmarkRows(rows);
    expect(result.valid).toBe(true);
    expect(result.completeTrials).toBe(2);
    expect(result.reviewableTasks).toEqual([]);
  });
});
