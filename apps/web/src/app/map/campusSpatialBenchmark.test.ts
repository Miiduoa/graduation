import { describe, expect, it } from 'vitest';
import {
  CAMPUS_SPATIAL_PRODUCTS,
  validateCampusSpatialBenchmarkRows,
  type CampusSpatialBenchmarkRow,
} from './campusSpatialBenchmark';

// All records below are synthetic validator fixtures, NOT campus observations
// or product rankings. The .invalid URLs cannot serve as field-test evidence.
function fixture(trialId: string): CampusSpatialBenchmarkRow[] {
  // Each synthetic repetition represents a separate capture time.
  const trialOffset = [...trialId].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 3_600_000, 0);
  const testedAt = new Date(Date.parse('2026-11-19T01:00:00.000Z') + trialOffset).toISOString();
  return CAMPUS_SPATIAL_PRODUCTS.map((product) => ({
    trialId, product, task: 'timetable-to-building',
    schoolId: 'pu', sceneId: 'synthetic-hall-case',
    deviceId: 'synthetic-device-A', osVersion: 'synthetic-os',
    network: 'wifi', locationPermission: 'allowed',
    textScale: '100%', startState: 'prepared',
    destinationId: 'synthetic-building', groundTruthLevel: 'building',
    groundTruthUrl: 'https://source.invalid/synthetic',
    testedAt, appVersion: 'fixture-only',
    evidenceUrl: `https://evidence.invalid/${trialId}/${product}`,
    outcome: 'correct', destinationLevel: 'building',
    buildingCorrect: true, entranceCorrect: null, floorCorrect: null,
    roomCorrect: null, routeVerified: null,
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

  it('never pools different app versions as three comparable repetitions', () => {
    const rows = [
      ...fixture('synthetic-1'), ...fixture('synthetic-2'), ...fixture('synthetic-3'),
    ];
    // Every trial has five complete, otherwise identical measurements.
    // A changed nuni build makes the second trial a separate cohort, even
    // though the task, device, destination and evidence are all valid.
    const secondNuni = rows.find((row) =>
      row.trialId === 'synthetic-2' && row.product === 'nuni')!;
    secondNuni.appVersion = 'nuni-next-release';
    const mixedVersions = validateCampusSpatialBenchmarkRows(rows);
    expect(mixedVersions.valid).toBe(true);
    expect(mixedVersions.completeTrials).toBe(3);
    expect(mixedVersions.reviewableTasks).toEqual([]);

    // It matters for each competitor too, not only for our own app.
    secondNuni.appVersion = 'fixture-only';
    const thirdApple = rows.find((row) =>
      row.trialId === 'synthetic-3' && row.product === 'apple-maps')!;
    thirdApple.appVersion = 'apple-maps-next-release';
    expect(validateCampusSpatialBenchmarkRows(rows).reviewableTasks).toEqual([]);

    thirdApple.appVersion = 'fixture-only';
    expect(validateCampusSpatialBenchmarkRows(rows).reviewableTasks).toEqual([
      'timetable-to-building',
    ]);
  });

  it('does not pool different destinations or devices to manufacture three repetitions', () => {
    const rows = [
      ...fixture('synthetic-1'), ...fixture('synthetic-2'), ...fixture('synthetic-3'),
    ];
    for (const row of rows) {
      if (row.trialId === 'synthetic-2') row.destinationId = 'another-building';
      if (row.trialId === 'synthetic-3') row.deviceId = 'another-device';
    }
    const result = validateCampusSpatialBenchmarkRows(rows);
    expect(result.valid).toBe(true);
    expect(result.completeTrials).toBe(3);
    expect(result.reviewableTasks).toEqual([]);

    // Two identical scenes and a third different one are still insufficient.
    for (const row of rows) {
      if (row.trialId === 'synthetic-3') row.deviceId = 'synthetic-device-A';
    }
    expect(validateCampusSpatialBenchmarkRows(rows).reviewableTasks).toEqual([]);
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

    const reportedRoom = fixture('synthetic-verified-room');
    reportedRoom[0] = {
      ...reportedRoom[0], groundTruthLevel: 'room', destinationLevel: 'room',
      roomCorrect: false,
    };
    for (const row of reportedRoom) row.groundTruthLevel = 'room';
    expect(validateCampusSpatialBenchmarkRows(reportedRoom).issues.join(' ')).toContain(
      'claimed indoor destination',
    );

    const reportedFloor = fixture('synthetic-verified-floor');
    for (const row of reportedFloor) row.groundTruthLevel = 'floor';
    reportedFloor[0] = {
      ...reportedFloor[0], destinationLevel: 'floor', floorCorrect: null,
    };
    expect(validateCampusSpatialBenchmarkRows(reportedFloor).issues.join(' ')).toContain(
      'claimed indoor destination',
    );

    const routes = fixture('synthetic-2').map((row) => ({
      ...row, task: 'walking-route' as const, routeVerified: false,
    }));
    expect(validateCampusSpatialBenchmarkRows(routes).issues.join(' ')).toContain('route evidence');
  });

  it.each(['entranceCorrect', 'floorCorrect', 'roomCorrect'] as const)(
    'excludes building-only evidence claiming %s from complete and reviewable trials',
    (field) => {
      const rows = [
        ...fixture('synthetic-1'), ...fixture('synthetic-2'), ...fixture('synthetic-3'),
      ];
      // Exercise both the first and later products in the trial accumulator.
      for (const trialId of ['synthetic-1', 'synthetic-2']) {
        const row = rows.find((candidate) => candidate.trialId === trialId &&
          candidate.product === (trialId === 'synthetic-1' ? 'nuni' : 'unitable'))!;
        row[field] = true;
      }
      const result = validateCampusSpatialBenchmarkRows(rows);
      expect(result.valid).toBe(false);
      expect(result.issues.join(' ')).toContain('correctness exceeds verified ground-truth evidence');
      expect(result.completeTrials).toBe(1);
      expect(result.reviewableTasks).toEqual([]);
    },
  );

  it.each(['correct', 'incorrect', 'unverified'] as const)(
    'caps each indoor correctness claim by evidence even when the outcome is %s',
    (outcome) => {
      const levels = ['none', 'building', 'entrance', 'floor', 'room'] as const;
      for (const groundTruthLevel of levels) {
        for (const level of ['entrance', 'floor', 'room'] as const) {
          const rows = fixture('synthetic-levels');
          for (const row of rows) {
            row.groundTruthLevel = groundTruthLevel;
            row.destinationLevel = groundTruthLevel;
            row.outcome = outcome;
            if (groundTruthLevel === 'entrance') row.entranceCorrect = true;
            if (groundTruthLevel === 'floor') row.floorCorrect = true;
            if (groundTruthLevel === 'room') row.roomCorrect = true;
          }
          rows[0][`${level}Correct`] = true;
          const result = validateCampusSpatialBenchmarkRows(rows);
          const supported = levels.indexOf(groundTruthLevel) >= levels.indexOf(level);
          expect(result.valid).toBe(supported);
          expect(result.completeTrials).toBe(supported && outcome !== 'unverified' ? 1 : 0);
        }
      }
    },
  );


  it('rejects building correctness when ground truth has no building evidence', () => {
    const rows = [
      ...fixture('synthetic-1'), ...fixture('synthetic-2'), ...fixture('synthetic-3'),
    ];
    for (const row of rows) {
      row.groundTruthLevel = 'none';
      row.destinationLevel = 'none';
      row.outcome = 'incorrect';
      row.buildingCorrect = true;
    }
    const result = validateCampusSpatialBenchmarkRows(rows);
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('building correctness exceeds verified ground-truth evidence');
    expect(result.completeTrials).toBe(0);
    expect(result.reviewableTasks).toEqual([]);
  });

  it('does not count a mismatched or unevidenced trial as complete', () => {
    const mismatched = fixture('synthetic-1');
    mismatched[1] = { ...mismatched[1], deviceId: 'different-device' };
    const mismatchedResult = validateCampusSpatialBenchmarkRows(mismatched);
    expect(mismatchedResult.valid).toBe(false);
    expect(mismatchedResult.issues.join(' ')).toContain('mismatched deviceId');
    expect(mismatchedResult.completeTrials).toBe(0);

    const missingEvidence = fixture('synthetic-2');
    missingEvidence[0] = { ...missingEvidence[0], evidenceUrl: '' };
    const missingResult = validateCampusSpatialBenchmarkRows(missingEvidence);
    expect(missingResult.valid).toBe(false);
    expect(missingResult.completeTrials).toBe(0);
    expect(missingResult.reviewableTasks).toEqual([]);
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

  it('does not count copied video links or timestamps as independent paired trials', () => {
    const rows = [
      ...fixture('synthetic-1'), ...fixture('synthetic-2'), ...fixture('synthetic-3'),
    ];
    // Only nuni is replayed; four other products have new captures each run.
    const first = rows.find((row) => row.trialId === 'synthetic-1' && row.product === 'nuni')!;
    for (const row of rows) {
      if (row.product === 'nuni' && row.trialId !== 'synthetic-1') {
        row.evidenceUrl = first.evidenceUrl;
        row.testedAt = first.testedAt;
      }
    }
    const replayed = validateCampusSpatialBenchmarkRows(rows);
    expect(replayed.valid).toBe(false);
    expect(replayed.issues.join(' ')).toContain('reused evidenceUrl');
    expect(replayed.issues.join(' ')).toContain('reused testedAt');
    expect(replayed.reviewableTasks).toEqual([]);

    // A separate capture URL is insufficient when its recorded capture time is reused.
    for (const row of rows) {
      if (row.product === 'nuni' && row.trialId !== 'synthetic-1') {
        row.evidenceUrl = `https://evidence.invalid/${row.trialId}/nuni`;
      }
    }
    const reusedTime = validateCampusSpatialBenchmarkRows(rows);
    expect(reusedTime.issues.join(' ')).toContain('reused testedAt');
    expect(reusedTime.reviewableTasks).toEqual([]);
  });

  it('does not accept a correct result without a destination', () => {
    const rows = fixture('synthetic-none');
    rows[0] = { ...rows[0], destinationLevel: 'none' };
    const result = validateCampusSpatialBenchmarkRows(rows);
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('no verified destination');
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
