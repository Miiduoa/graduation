import 'server-only';
import { runDefaultTronClassRetentionBatch } from './tronClassRetention';

export const TRONCLASS_RETENTION_INTERVAL_MS = 15 * 60_000;
const JITTER_MS = 60_000;
let started = false;

export function startTronClassRetentionScheduler(
  env: NodeJS.ProcessEnv = process.env,
  run: () => Promise<unknown> = () => runDefaultTronClassRetentionBatch(env),
): boolean {
  if (started || env.NEXT_RUNTIME !== 'nodejs' || env.TRONCLASS_RETENTION_ENABLED !== 'true') return false;
  started = true;
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
  return true;
}
