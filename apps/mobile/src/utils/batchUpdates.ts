import { unstable_batchedUpdates } from "react-native";

export type BatchCallback = () => void;

let pendingCallbacks: BatchCallback[] = [];
let isBatching = false;
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

export function batchUpdate(callback: BatchCallback): void {
  pendingCallbacks.push(callback);
  
  if (!isBatching) {
    scheduleBatch();
  }
}

function scheduleBatch(): void {
  if (batchTimeout) return;
  
  batchTimeout = setTimeout(() => {
    flushBatch();
  }, 0);
}

function flushBatch(): void {
  if (pendingCallbacks.length === 0) {
    batchTimeout = null;
    return;
  }

  isBatching = true;
  const callbacks = [...pendingCallbacks];
  pendingCallbacks = [];

  unstable_batchedUpdates(() => {
    callbacks.forEach((cb) => {
      try {
        cb();
      } catch (error) {
        console.error("[BatchUpdates] 執行回調時發生錯誤:", error);
      }
    });
  });

  isBatching = false;
  batchTimeout = null;

  if (pendingCallbacks.length > 0) {
    scheduleBatch();
  }
}

export function batchUpdateSync(callbacks: BatchCallback[]): void {
  unstable_batchedUpdates(() => {
    callbacks.forEach((cb) => {
      try {
        cb();
      } catch (error) {
        console.error("[BatchUpdates] 執行回調時發生錯誤:", error);
      }
    });
  });
}

export class UpdateQueue<T> {
  private queue: T[] = [];
  private processor: (items: T[]) => void;
  private batchSize: number;
  private delay: number;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    processor: (items: T[]) => void,
    options: { batchSize?: number; delay?: number } = {}
  ) {
    this.processor = processor;
    this.batchSize = options.batchSize ?? 50;
    this.delay = options.delay ?? 16;
  }

  add(item: T): void {
    this.queue.push(item);

    if (this.queue.length >= this.batchSize) {
      this.flush();
    } else if (!this.timeout) {
      this.timeout = setTimeout(() => this.flush(), this.delay);
    }
  }

  addAll(items: T[]): void {
    this.queue.push(...items);

    if (this.queue.length >= this.batchSize) {
      this.flush();
    } else if (!this.timeout) {
      this.timeout = setTimeout(() => this.flush(), this.delay);
    }
  }

  flush(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    if (this.queue.length === 0) return;

    const items = [...this.queue];
    this.queue = [];

    unstable_batchedUpdates(() => {
      this.processor(items);
    });
  }

  clear(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length;
  }
}

export function createThrottledUpdater<T>(
  setter: (value: T) => void,
  interval: number = 16
): (value: T) => void {
  let lastUpdate = 0;
  let pendingValue: T | undefined;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (value: T) => {
    const now = Date.now();
    
    if (now - lastUpdate >= interval) {
      lastUpdate = now;
      setter(value);
    } else {
      pendingValue = value;
      
      if (!timeout) {
        timeout = setTimeout(() => {
          if (pendingValue !== undefined) {
            lastUpdate = Date.now();
            setter(pendingValue);
            pendingValue = undefined;
          }
          timeout = null;
        }, interval - (now - lastUpdate));
      }
    }
  };
}

export function createDebouncedUpdater<T>(
  setter: (value: T) => void,
  delay: number = 100
): (value: T) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (value: T) => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      setter(value);
      timeout = null;
    }, delay);
  };
}
