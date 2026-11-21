import 'server-only';
import { readTronClassPlatformClosureConfig, runDefaultTronClassPlatformClosureBatch } from './tronClassPlatformClosure';

export const TRONCLASS_CLOSURE_INTERVAL_MS = 60_000;
const JITTER_MS = 5_000;
let started = false;

export function startTronClassPlatformClosureScheduler(
  env: Record<string, string | undefined> = process.env,
  run: () => Promise<unknown> = () => runDefaultTronClassPlatformClosureBatch(env),
) {
  if (started || env.NEXT_RUNTIME !== 'nodejs') return false;
  if (!readTronClassPlatformClosureConfig(env)) {
    if (env.TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED === 'true') {
      console.warn('TronClass platform account cleanup configuration is invalid');
    }
    return false;
  }
  started = true;
  const schedule = (first = false) => {
    const timer = setTimeout(async () => {
      try { await run(); }
      catch { console.warn('TronClass platform account cleanup failed'); }
      finally { schedule(); }
    }, (first ? 0 : TRONCLASS_CLOSURE_INTERVAL_MS) + Math.floor(Math.random() * JITTER_MS));
    timer.unref();
  };
  schedule(true);
  return true;
}
