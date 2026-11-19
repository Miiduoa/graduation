/** Strict evidence gate for same-task campus-navigation comparisons.
 * This module does not generate measurements, rankings or estimated routes.
 * A verified building is not evidence of an indoor room or accessible route.
 */
export const CAMPUS_SPATIAL_PRODUCTS = [
  'nuni', 'google-maps', 'apple-maps', 'providence-guide', 'unitable',
] as const;

export const CAMPUS_SPATIAL_TASKS = [
  'building-recognition', 'timetable-to-building', 'walking-route',
  'accessibility', 'visual-performance',
] as const;

type Product = (typeof CAMPUS_SPATIAL_PRODUCTS)[number];
type Task = (typeof CAMPUS_SPATIAL_TASKS)[number];
type Outcome = 'correct' | 'incorrect' | 'unverified';
type DestinationLevel = 'none' | 'building' | 'entrance' | 'floor' | 'room';

export type CampusSpatialBenchmarkRow = {
  trialId: string;
  product: Product;
  task: Task;
  schoolId: 'pu';
  sceneId: string;
  deviceId: string;
  osVersion: string;
  network: 'wifi' | 'cellular' | 'offline';
  locationPermission: 'allowed' | 'denied';
  textScale: string;
  startState: 'fresh' | 'prepared';
  destinationId: string;
  groundTruthLevel: DestinationLevel;
  groundTruthUrl: string;
  testedAt: string;
  appVersion: string;
  evidenceUrl: string;
  outcome: Outcome;
  destinationLevel: DestinationLevel;
  buildingCorrect: boolean | null;
  entranceCorrect: boolean | null;
  floorCorrect: boolean | null;
  roomCorrect: boolean | null;
  routeVerified: boolean | null;
  steps: number | null;
  elapsedMs: number | null;
  fpsP50?: number | null;
  visualScore?: number | null;
  visualRubric?: string;
};

const CONDITIONS = [
  'schoolId', 'sceneId', 'task', 'deviceId', 'osVersion', 'network',
  'locationPermission', 'textScale', 'startState', 'destinationId',
  'groundTruthLevel', 'groundTruthUrl',
] as const;
const LEVELS: DestinationLevel[] = ['none', 'building', 'entrance', 'floor', 'room'];
const object = (v: unknown): Record<string, unknown> | null =>
  !!v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 300;
const evidenceUrl = (value: unknown) => {
  if (!text(value)) return false;
  try {
    const url = new URL(value as string);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
};
const timestamp = (value: unknown) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;
const count = (value: unknown) => value === null ||
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000);
const duration = (value: unknown) => value === null ||
  (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 3_600_000);
const triState = (value: unknown) => value === null || typeof value === 'boolean';

export type CampusSpatialBenchmarkValidation = {
  valid: boolean;
  issues: string[];
  completeTrials: number;
  /** Only evidence-complete tasks with >=3 paired trials; never an automatic winner. */
  reviewableTasks: Task[];
};

/** Group by trialId, not by product: all apps must share the exact same
 * scenario, ground truth and hardware/environment controls. Three repeated
 * paired trials are a minimum for manual comparison, NOT proof of superiority.
 */
export function validateCampusSpatialBenchmarkRows(rows: readonly unknown[]): CampusSpatialBenchmarkValidation {
  const issues: string[] = [];
  const trials = new Map<string, {
    baseline: Record<string, unknown>;
    products: Set<Product>;
    appVersions: Map<Product, string>;
    verified: boolean;
  }>();
  const taintedTrials = new Set<string>();
  // Detect replayed captures within the same scenario/product across different trial IDs.
  // A shared cross-product video is allowed; recycled runs from one product are not.
  const observedCaptures = new Map<string, string>();
  if (!Array.isArray(rows) || rows.length === 0) {
    return { valid: false, issues: ['No actual benchmark measurements supplied'], completeTrials: 0, reviewableTasks: [] };
  }
  rows.forEach((candidate, index) => {
    const row = object(candidate);
    const prefix = `row ${index + 1}`;
    if (!row) { issues.push(`${prefix}: not an object`); return; }
    const requiredText = [
      'trialId', 'sceneId', 'deviceId', 'osVersion', 'textScale',
      'destinationId', 'appVersion',
    ];
    for (const field of requiredText) {
      if (!text(row[field])) issues.push(`${prefix}: invalid ${field}`);
    }
    if (!evidenceUrl(row.evidenceUrl) || !evidenceUrl(row.groundTruthUrl)) {
      issues.push(`${prefix}: HTTPS evidence and ground-truth URLs are required`);
    }
    if (!timestamp(row.testedAt)) issues.push(`${prefix}: invalid testedAt`);
    if (!CAMPUS_SPATIAL_PRODUCTS.includes(row.product as Product)) {
      issues.push(`${prefix}: unknown product`); return;
    }
    if (!CAMPUS_SPATIAL_TASKS.includes(row.task as Task) || row.schoolId !== 'pu' ||
        !['wifi', 'cellular', 'offline'].includes(String(row.network)) ||
        !['allowed', 'denied'].includes(String(row.locationPermission)) ||
        !['fresh', 'prepared'].includes(String(row.startState))) {
      issues.push(`${prefix}: invalid campus/task/conditions`);
    }
    if (!LEVELS.includes(row.groundTruthLevel as DestinationLevel) ||
        !LEVELS.includes(row.destinationLevel as DestinationLevel) ||
        !['correct', 'incorrect', 'unverified'].includes(String(row.outcome))) {
      issues.push(`${prefix}: invalid result classification`);
    }
    if (!triState(row.buildingCorrect) || !triState(row.entranceCorrect) ||
        !triState(row.floorCorrect) || !triState(row.roomCorrect) || !triState(row.routeVerified) ||
        !count(row.steps) || !duration(row.elapsedMs)) {
      issues.push(`${prefix}: invalid accuracy, steps or elapsed time`);
    }
    if (row.fpsP50 !== undefined && row.fpsP50 !== null &&
        (typeof row.fpsP50 !== 'number' || !Number.isFinite(row.fpsP50) ||
          row.fpsP50 <= 0 || row.fpsP50 > 240)) {
      issues.push(`${prefix}: invalid measured fpsP50`);
    }
    if (row.visualScore !== undefined && row.visualScore !== null &&
        ((typeof row.visualScore !== 'number' || !Number.isInteger(row.visualScore)) || (row.visualScore as number) < 1 ||
          (row.visualScore as number) > 5 || !text(row.visualRubric))) {
      issues.push(`${prefix}: visual ratings require a 1–5 score and named rubric`);
    }
    // Missing durations and steps cannot support speed/effort comparisons.
    // Keep 'unverified' entries for honest coverage tracking, but exclude them
    // from the complete-trial count below.
    if (row.outcome !== 'unverified' && (row.steps === null || row.elapsedMs === null)) {
      issues.push(`${prefix}: measured steps and elapsedMs required for a claimed outcome`);
    }
    if (row.task === 'visual-performance' && row.outcome !== 'unverified' &&
        (typeof row.fpsP50 !== 'number' || !Number.isFinite(row.fpsP50) ||
          typeof row.visualScore !== 'number' || !Number.isInteger(row.visualScore) ||
          !text(row.visualRubric))) {
      issues.push(`${prefix}: performance comparison requires measured FPS and rated visual rubric`);
    }
    if (row.outcome === 'correct' && row.destinationLevel === 'none') {
      issues.push(`${prefix}: a correct task cannot have no verified destination`);
    }
    if (row.outcome === 'correct' && (
        (row.destinationLevel === 'entrance' && row.entranceCorrect !== true) ||
        (row.destinationLevel === 'floor' && row.floorCorrect !== true) ||
        (row.destinationLevel === 'room' && row.roomCorrect !== true))) {
      issues.push(`${prefix}: claimed indoor destination exceeds verified location accuracy`);
    }
    if (row.roomCorrect === true && row.buildingCorrect !== true) {
      issues.push(`${prefix}: room correctness requires verified building correctness`);
    }
    const unsupportedIndoorLevels = (['building', 'entrance', 'floor', 'room'] as const).filter((level) =>
      row[`${level}Correct`] === true &&
      LEVELS.indexOf(row.groundTruthLevel as DestinationLevel) < LEVELS.indexOf(level));
    for (const level of unsupportedIndoorLevels) {
      issues.push(`${prefix}: ${level} correctness exceeds verified ground-truth evidence`);
    }
    if (row.outcome === 'correct' &&
        (row.buildingCorrect !== true ||
          LEVELS.indexOf(row.destinationLevel as DestinationLevel) >
            LEVELS.indexOf(row.groundTruthLevel as DestinationLevel) ||
          (row.task === 'walking-route' && row.routeVerified !== true))) {
      issues.push(`${prefix}: success exceeds verified destination or route evidence`);
    }
    const id = row.trialId;
    if (!text(id)) return;
    if (evidenceUrl(row.evidenceUrl) && timestamp(row.testedAt)) {
      const scenario = JSON.stringify([row.product, ...CONDITIONS.map((field) => row[field])]);
      const observations = [
        ['evidenceUrl', new URL(row.evidenceUrl as string).href],
        ['testedAt', row.testedAt as string],
      ] as const;
      for (const [field, value] of observations) {
        const key = JSON.stringify([scenario, field, value]);
        const previousTrial = observedCaptures.get(key);
        if (previousTrial && previousTrial !== id) {
          issues.push(`${prefix}: reused ${field} across trials ${previousTrial} and ${id}`);
        } else {
          observedCaptures.set(key, id as string);
        }
      }
    }
    const found = trials.get(id as string);
    const verified = row.outcome !== 'unverified' && unsupportedIndoorLevels.length === 0;
    if (!found) {
      trials.set(id as string, {
        baseline: row, products: new Set([row.product as Product]),
        appVersions: new Map([[row.product as Product, row.appVersion as string]]),
        verified,
      });
    } else {
      if (found.products.has(row.product as Product)) issues.push(`${prefix}: duplicate product in trial ${id}`);
      found.products.add(row.product as Product);
      found.appVersions.set(row.product as Product, row.appVersion as string);
      found.verified &&= verified;
      for (const field of CONDITIONS) {
        if (found.baseline[field] !== row[field]) {
          issues.push(`${prefix}: mismatched ${field} in trial ${id}`);
        }
      }
    }
    if (text(id) && issues.some((issue) => issue.startsWith(`${prefix}:`))) {
      taintedTrials.add(id as string);
    }
  });
  let completeTrials = 0;
  // Repetitions must use one exact scenario. Three unrelated destinations or
  // devices under the same task name are not a paired benchmark.
  const countsByScenario = new Map<string, { task: Task; count: number }>();
  for (const [id, trial] of trials) {
    const missing = CAMPUS_SPATIAL_PRODUCTS.filter((product) => !trial.products.has(product));
    if (missing.length) issues.push(`trial ${id}: missing comparisons: ${missing.join(', ')}`);
    else if (trial.verified && !taintedTrials.has(id)) {
      completeTrials += 1;
      // A repeated scenario must also keep each app's exact tested build.
      // Different releases may legitimately be recorded, but must form
      // separate comparison cohorts rather than a synthetic three-run result.
      const key = JSON.stringify([
        CONDITIONS.map((field) => trial.baseline[field]),
        CAMPUS_SPATIAL_PRODUCTS.map((product) => trial.appVersions.get(product)),
      ]);
      const scenario = countsByScenario.get(key);
      if (scenario) scenario.count += 1;
      else countsByScenario.set(key, { task: trial.baseline.task as Task, count: 1 });
    }
  }
  return {
    valid: issues.length === 0, issues, completeTrials,
    reviewableTasks: issues.length === 0
      ? CAMPUS_SPATIAL_TASKS.filter((task) =>
          [...countsByScenario.values()].some((scenario) => scenario.task === task && scenario.count >= 3))
      : [],
  };
}
