'use strict';

const { EventEmitter } = require('node:events');
const { installShutdownHandlers } = require('./flyRuntime');
const { startFirestoreTriggerRunner, tryAcquireLease } = require('./firestoreTriggerRunner');

function createMemoryDb() {
  const store = new Map();
  function makeDoc(path) {
    return {
      path,
      collection(name) {
        return {
          doc(id) {
            return makeDoc(`${path}/${name}/${id}`);
          },
        };
      },
      async get() {
        const rec = store.get(path);
        return { exists: Boolean(rec), data: () => rec };
      },
      async set(data, opts = {}) {
        const prev = store.get(path);
        store.set(path, opts.merge && prev ? { ...prev, ...data } : { ...data });
      },
    };
  }
  return {
    store,
    collection: (name) => ({
      doc: (id) => makeDoc(`${name}/${id}`),
    }),
    async runTransaction(fn) {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
      };
      return fn(tx);
    },
  };
}

test('SIGTERM and SIGINT release the Firestore lease before exit', async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const db = createMemoryDb();
    const runner = await startFirestoreTriggerRunner({
      db,
      triggers: [],
      holderId: `pid-${signal}`,
      now: () => 1_000,
      leaseMs: 45_000,
      heartbeatMs: 60_000,
    });
    expect(runner.isHoldingLease()).toBe(true);

    const proc = new EventEmitter();
    const exit = jest.fn();
    installShutdownHandlers(
      proc,
      async () => {
        await runner.stop();
      },
      { exit },
    );

    proc.emit(signal);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(runner.isHoldingLease()).toBe(false);
    expect(await tryAcquireLease(db, { holderId: 'next', now: () => 1_000, leaseMs: 45_000 })).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  }
});

test('shutdown handlers only run once even if both signals fire', async () => {
  const proc = new EventEmitter();
  const exit = jest.fn();
  const stop = jest.fn(async () => {});
  installShutdownHandlers(proc, stop, { exit });
  proc.emit('SIGTERM');
  proc.emit('SIGINT');
  await new Promise((resolve) => setImmediate(resolve));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith(0);
});
