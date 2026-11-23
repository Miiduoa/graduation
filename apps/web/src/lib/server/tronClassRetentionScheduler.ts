import 'server-only';
import { runDefaultTronClassRetentionBatch } from './tronClassRetention';

export const TRONCLASS_RETENTION_INTERVAL_MS = 4 * 60_000;
const JITTER_MS = 60_000;
// Next.js instrumentation and route handlers can load separate module instances.
const processState = globalThis as typeof globalThis & { __tronClassRetentionSchedulerStarted?: boolean };

export function isTronClassRetentionSchedulerStarted(): boolean {
  return processState.__tronClassRetentionSchedulerStarted === true;
}

export function startTronClassRetentionScheduler(
  env: NodeJS.ProcessEnv = process.env,
  run: () => Promise<unknown> = () => runDefaultTronClassRetentionBatch(env),
): boolean {
  if (isTronClassRetentionSchedulerStarted() || env.NEXT_RUNTIME !== 'nodejs' || env.TRONCLASS_RETENTION_ENABLED !== 'true') return false;
  const schedule = (first = false) => {
    const timer = setTimeout(async () => {
      try { await run(); }
      catch { console.warn('TronClass retention failed'); }
      // Schedule after completion, not on a repeating interval: no overlapping
      // batches even when Firestore is slow or retries a transaction.
      finally { schedule(); }
    }, (first ? 0 : TRONCLASS_RETENTION_INTERVAL_MS) + Math.floor(Math.random() * JITTER_MS));
    timer.unref();
  };
  schedule(true);
  processState.__tronClassRetentionSchedulerStarted = true;
  return true;
}
