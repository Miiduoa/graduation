import 'server-only';
import { readTronClassPlatformClosureConfig, runDefaultTronClassPlatformClosureBatch } from './tronClassPlatformClosure';

export const TRONCLASS_CLOSURE_INTERVAL_MS = 60_000;
const JITTER_MS = 5_000;
// A batch verifies the outbox, privileges and triggers before claiming work.
// New platform bindings require such a verified batch within this window.
const MAX_BATCH_AGE_MS = 10 * 60_000;
const FIRST_BATCH_WAIT_MS = 3_000;

type SchedulerState = {
  lastSuccessfulBatchAt?: number;
  firstBatch?: Promise<void>;
};

// Next.js instrumentation and route handlers can load separate module instances.
const processState = globalThis as typeof globalThis & {
  __tronClassPlatformClosureScheduler?: SchedulerState;
};

export function isTronClassPlatformClosureSchedulerReady(): boolean {
  const last = processState.__tronClassPlatformClosureScheduler?.lastSuccessfulBatchAt;
  if (last === undefined) return false;
  const age = Date.now() - last;
  return age >= 0 && age <= MAX_BATCH_AGE_MS;
}

export async function waitForTronClassPlatformClosureFirstBatch(): Promise<void> {
  const firstBatch = processState.__tronClassPlatformClosureScheduler?.firstBatch;
  if (!firstBatch) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      firstBatch,
      new Promise<void>(resolve => { timer = setTimeout(resolve, FIRST_BATCH_WAIT_MS); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function hasFailedEvents(result: unknown): boolean {
  if (!result || typeof result !== 'object' || !('failed' in result)) return false;
  const failed = (result as { failed: unknown }).failed;
  return typeof failed !== 'number' || !Number.isFinite(failed) || failed !== 0;
}

export function startTronClassPlatformClosureScheduler(
  env: Record<string, string | undefined> = process.env,
  run: () => Promise<unknown> = () => runDefaultTronClassPlatformClosureBatch(env),
) {
  if (processState.__tronClassPlatformClosureScheduler || env.NEXT_RUNTIME !== 'nodejs') return false;
  if (!readTronClassPlatformClosureConfig(env)) {
    if (env.TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED === 'true') {
      console.warn('TronClass platform account cleanup configuration is invalid');
    }
    return false;
  }
  const state: SchedulerState = {};
  processState.__tronClassPlatformClosureScheduler = state;
  let firstBatchDone!: () => void;
  state.firstBatch = new Promise<void>(resolve => { firstBatchDone = resolve; })
    .finally(() => { delete state.firstBatch; });
  const batch = async () => {
    try {
      // A batch that left any closure event for retry is not a success: new
      // platform bindings stay closed until cleanup actually completes again.
      // The default batch already logs the generalized failure.
      if (hasFailedEvents(await run())) return;
      state.lastSuccessfulBatchAt = Date.now();
    } catch {
      console.warn('TronClass platform account cleanup failed');
    }
  };
  const schedule = (first = false) => {
    const timer = setTimeout(async () => {
      try { await batch(); } finally {
        if (first) firstBatchDone();
        schedule();
      }
      // The first batch runs at once so a cold start can open bindings within
      // the short first-batch wait; later batches are spread by jitter.
    }, first ? 0 : TRONCLASS_CLOSURE_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS));
    timer.unref();
  };
  schedule(true);
  return true;
}
