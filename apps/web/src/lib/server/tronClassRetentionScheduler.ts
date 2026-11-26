import 'server-only';
import { runDefaultTronClassRetentionBatch, type TronClassRetentionResult } from './tronClassRetention';

export const TRONCLASS_RETENTION_INTERVAL_MS = 4 * 60_000;
const JITTER_MS = 60_000;
const MAX_SWEEP_AGE_MS = 30 * 60_000;
const FIRST_SWEEP_WAIT_MS = 3_000;

type SchedulerState = {
  lastSuccessfulSweepAt?: number;
  firstSweep?: Promise<void>;
};

// Next.js instrumentation and route handlers can load separate module instances.
const processState = globalThis as typeof globalThis & { __tronClassRetentionScheduler?: SchedulerState };

export function isTronClassRetentionSchedulerReady(): boolean {
  const lastSuccessfulSweepAt = processState.__tronClassRetentionScheduler?.lastSuccessfulSweepAt;
  if (lastSuccessfulSweepAt === undefined) return false;
  const age = Date.now() - lastSuccessfulSweepAt;
  return age >= 0 && age <= MAX_SWEEP_AGE_MS;
}

export async function waitForTronClassRetentionFirstSweep(): Promise<void> {
  const firstSweep = processState.__tronClassRetentionScheduler?.firstSweep;
  if (!firstSweep) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      firstSweep,
      new Promise<void>(resolve => { timer = setTimeout(resolve, FIRST_SWEEP_WAIT_MS); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function startTronClassRetentionScheduler(
  env: NodeJS.ProcessEnv = process.env,
  run: () => Promise<TronClassRetentionResult> = () => runDefaultTronClassRetentionBatch(env),
): boolean {
  if (processState.__tronClassRetentionScheduler || env.NEXT_RUNTIME !== 'nodejs' || env.TRONCLASS_RETENTION_ENABLED !== 'true') return false;
  const state: SchedulerState = {};
  processState.__tronClassRetentionScheduler = state;

  const sweep = async () => {
    try {
      const result = await run();
      if (!result.skipped) state.lastSuccessfulSweepAt = Date.now();
    } catch {
      console.warn('TronClass retention failed');
    }

    // Schedule after completion so slow Firestore batches never overlap.
    try {
      const timer = setTimeout(sweep, TRONCLASS_RETENTION_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS));
      timer.unref();
    } catch {
      console.warn('TronClass retention scheduling failed');
    }
  };

  state.firstSweep = Promise.resolve().then(sweep).finally(() => { delete state.firstSweep; });
  return true;
}
