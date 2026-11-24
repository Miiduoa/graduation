import { beforeEach } from 'vitest';

// jsdom provides neither Web Locks nor IndexedDB. Model the exclusive request used by event UI tests.
beforeEach(() => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request<T>(key: string, options: LockOptions, operation: () => Promise<T>) {
        const previous = queues.get(key) ?? Promise.resolve();
        const signal = options.signal;
        const run = () => {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return operation();
        };
        const result = previous.then(run, run);
        queues.set(key, result);
        return result;
      },
    },
  });
  return () => {
    if (original) Object.defineProperty(navigator, 'locks', original);
    else Reflect.deleteProperty(navigator, 'locks');
  };
});
