export type AssignmentSync = {
  state: 'updating' | 'synced' | 'offline' | 'error' | 'paused';
  updatedAt: string | null;
};

/** 自有課程沿用授權清單端點；同時最多一筆請求，離開前景即失效。 */
export function startAssignmentLive<T>(options: {
  read(): Promise<T>;
  initialDelay?: number;
  receive(value: T): void;
  revision?(): number;
  clear(): void;
  status(value: AssignmentSync): void;
  active(): boolean;
  online(): boolean;
  subscribe(changed: () => void): () => void;
}) {
  let stopped = false;
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let updatedAt: string | null = null;
  let denied = false;
  let failures = 0;
  let reading = false;
  let resume = false;
  let stopEvents: (() => void) | null = null;
  function unsubscribe() {
    stopEvents?.();
    stopEvents = null;
  }
  const status = (state: AssignmentSync['state']) => options.status({ state, updatedAt });
  async function read(run: number) {
    const revision = options.revision?.();
    reading = true;
    status('updating');
    try {
      const value = await options.read();
      if (stopped || version !== run) return;
      if (revision !== options.revision?.()) { restart(); return; }
      if (!options.active() || !options.online()) {
        restart();
        return;
      }
      failures = 0;
      options.receive(value);
      updatedAt = new Date().toISOString();
      status('synced');
    } catch (error) {
      if (stopped || version !== run) return;
      failures = Math.min(failures + 1, 5);
      const code = error as { status?: number; code?: string };
      if ([401, 403, 404].includes(code.status ?? 0) || code.code === 'SESSION_CHANGED') {
        denied = true;
        updatedAt = null;
        unsubscribe();
        options.clear();
      }
      status(options.online() ? 'error' : 'offline');
    } finally {
      reading = false;
      if (resume && !stopped && !denied) {
        resume = false;
        restart();
      }
    }
    if (!stopped && version === run && !denied)
      timer = setTimeout(() => {
        void read(run);
      }, Math.min(60000, 2500 * 2 ** failures));
  }
  function restart() {
    version += 1;
    clearTimeout(timer);
    if (stopped || denied) return;
    if (!options.active()) {
      status('paused');
      return;
    }
    if (!options.online()) {
      status('offline');
      return;
    }
    if (reading) {
      resume = true;
      return;
    }
    void read(version);
  }
  stopEvents = options.subscribe(restart);
  if (options.initialDelay && !reading && options.active() && options.online())
    timer = setTimeout(restart, options.initialDelay);
  else if (!reading) restart();
  return () => {
    stopped = true;
    version += 1;
    clearTimeout(timer);
    unsubscribe();
  };
}

export function assignmentSyncLabel(value: AssignmentSync): string {
  return {
    updating: '更新中',
    synced: '已同步',
    offline: '離線',
    error: '暫時無法更新',
    paused: '已暫停更新',
  }[value.state];
}

/** 跨手動更新、分頁與前景切換，實際讀取仍依序完成。 */
export function assignmentReader<T>() {
  let pending: Promise<unknown> | null = null;
  return (read: () => Promise<T>): Promise<T> => {
    const next = pending ? pending.then(read, read) : read();
    pending = next;
    const done = () => { if (pending === next) pending = null; };
    void next.then(done, done);
    return next;
  };
}
