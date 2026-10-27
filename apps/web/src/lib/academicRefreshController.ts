export type AcademicRefreshOutcome =
  | 'ready'
  | 'unavailable'
  | 'reconnect'
  | 'permission'
  | 'unconfigured';

export type AcademicAutomaticStatus =
  | 'off'
  | 'waiting'
  | 'updating'
  | 'offline'
  | 'hidden'
  | 'blocked'
  | 'retrying';

export const ACADEMIC_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
export const ACADEMIC_REFRESH_MAX_BACKOFF_MS = 30 * 60 * 1_000;

export interface AcademicRefreshEnvironment {
  now(): number;
  visible(): boolean;
  online(): boolean;
  schedule(callback: () => void, delayMs: number): number;
  cancel(timer: number): void;
  subscribe(callback: () => void): () => void;
}

export interface AcademicRefreshController {
  refresh(): Promise<void>;
  setAutomatic(enabled: boolean): void;
  dispose(): void;
}

/** One controller belongs to one account, campus and record kind. It stores no data. */
export function createAcademicRefreshController(options: {
  read: () => Promise<AcademicRefreshOutcome>;
  environment: AcademicRefreshEnvironment;
  onStatus?: (status: AcademicAutomaticStatus) => void;
}): AcademicRefreshController {
  const env = options.environment;
  let automatic = false;
  let disposed = false;
  let blocked = false;
  let failures = 0;
  let dueAt = env.now();
  let timer: number | undefined;
  let pending: Promise<void> | null = null;
  let status: AcademicAutomaticStatus | undefined;

  function clearTimer() {
    if (timer !== undefined) env.cancel(timer);
    timer = undefined;
  }

  function reconcile() {
    if (disposed) return;
    clearTimer();
    const nextStatus: AcademicAutomaticStatus = !automatic
      ? 'off'
      : blocked
        ? 'blocked'
        : !env.online()
          ? 'offline'
          : !env.visible()
            ? 'hidden'
            : pending
              ? 'updating'
              : failures
                ? 'retrying'
                : 'waiting';
    if (status !== nextStatus) {
      status = nextStatus;
      options.onStatus?.(status);
    }
    if (!automatic || blocked || pending || !env.online() || !env.visible()) return;
    timer = env.schedule(() => {
      timer = undefined;
      if (disposed || !automatic || blocked || !env.online() || !env.visible()) {
        reconcile();
        return;
      }
      void perform(false);
    }, Math.max(0, dueAt - env.now()));
  }

  function perform(manual: boolean): Promise<void> {
    if (disposed) return Promise.resolve();
    // Repeated clicks and focus/online events share the existing read.
    if (pending) return pending;
    if (!manual && (!automatic || blocked || !env.visible() || !env.online())) {
      reconcile();
      return Promise.resolve();
    }
    if (manual) blocked = false;
    clearTimer();
    // Lock before invoking read(), including if it throws synchronously.
    pending = Promise.resolve()
      .then(() => (disposed ? undefined : options.read()))
      .catch((): AcademicRefreshOutcome => 'unavailable')
      .then((outcome) => {
        if (disposed || outcome === undefined) return;
        blocked = outcome === 'reconnect' || outcome === 'permission' || outcome === 'unconfigured';
        failures = outcome === 'ready' ? 0 : Math.min(failures + 1, 8);
        const delay = outcome === 'ready'
          ? ACADEMIC_REFRESH_INTERVAL_MS
          : Math.min(
              ACADEMIC_REFRESH_INTERVAL_MS * 2 ** (failures - 1),
              ACADEMIC_REFRESH_MAX_BACKOFF_MS,
            );
        dueAt = env.now() + delay;
      })
      .finally(() => {
        pending = null;
        reconcile();
      });
    reconcile();
    return pending;
  }

  const unsubscribe = env.subscribe(reconcile);
  return {
    refresh: () => perform(true),
    setAutomatic(enabled) {
      if (disposed) return;
      automatic = enabled;
      reconcile();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      unsubscribe();
    },
  };
}

/** Uses foreground events only; it never registers a worker or stores credentials. */
export function browserAcademicRefreshEnvironment(): AcademicRefreshEnvironment {
  return {
    now: () => Date.now(),
    visible: () => document.visibilityState !== 'hidden',
    online: () => navigator.onLine !== false,
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (timer) => window.clearTimeout(timer),
    subscribe(callback) {
      document.addEventListener('visibilitychange', callback);
      window.addEventListener('online', callback);
      window.addEventListener('offline', callback);
      window.addEventListener('focus', callback);
      return () => {
        document.removeEventListener('visibilitychange', callback);
        window.removeEventListener('online', callback);
        window.removeEventListener('offline', callback);
        window.removeEventListener('focus', callback);
      };
    },
  };
}
