/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  campusEventShortlistKey,
  createCampusEventShortlistStore,
  EMPTY_CAMPUS_EVENT_SHORTLIST,
} = require('../src/campusEventShortlist.ts');

const key = campusEventShortlistKey('pu', 'student');
const item = { schoolId: 'pu', id: 'lecture', source: 'school-events', title: '講座' };
const stored = JSON.stringify({ version: 1, items: [item] });

function device() {
  let raw = stored;
  return {
    getItem: () => raw,
    setItem: (_key, value) => { raw = value; },
  };
}

const options = { evictIdleSnapshots: true };

test('returning to an idle scope reads the current device copy instead of displaying stale items', async () => {
  const storage = device();
  const store = createCampusEventShortlistStore(storage, options);
  const unsubscribe = store.subscribe(key, () => {});
  await store.load(key);
  assert.deepEqual(store.getSnapshot(key).items, [item]);
  unsubscribe();
  // Another tab changed the copy while the event screen was not mounted.
  storage.setItem(key, JSON.stringify({ version: 1, items: [] }));
  assert.equal(store.getSnapshot(key), EMPTY_CAMPUS_EVENT_SHORTLIST);
  const next = store.subscribe(key, () => {});
  await store.load(key);
  assert.deepEqual(store.getSnapshot(key), { items: [], ready: true, error: null });
  next();
});

test('an idle scope discards a late read after the last subscriber leaves', async () => {
  let finish;
  let started;
  const reading = new Promise(resolve => { started = resolve; });
  const storage = { getItem: () => new Promise(resolve => { finish = resolve; started(); }), setItem: () => {} };
  const store = createCampusEventShortlistStore(storage, options);
  const unsubscribe = store.subscribe(key, () => {});
  const pending = store.load(key);
  await reading;
  unsubscribe();
  finish(stored);
  await pending;
  assert.equal(store.getSnapshot(key), EMPTY_CAMPUS_EVENT_SHORTLIST);
});

test('keeps a live snapshot for the remaining subscriber and clears it when all leave', async () => {
  const store = createCampusEventShortlistStore(device(), options);
  const first = store.subscribe(key, () => {});
  const second = store.subscribe(key, () => {});
  await store.load(key);
  const snapshot = store.getSnapshot(key);
  first();
  assert.equal(store.getSnapshot(key), snapshot);
  second();
  assert.equal(store.getSnapshot(key), EMPTY_CAMPUS_EVENT_SHORTLIST);
});

test('finishes a requested storage mutation even if the user leaves, without retaining idle data', async () => {
  const storage = device();
  let finish;
  let started;
  const writing = new Promise(resolve => { started = resolve; });
  const write = storage.setItem;
  storage.setItem = (scope, value) => new Promise(resolve => {
    finish = () => { write(scope, value); resolve(); };
    started();
  });
  const store = createCampusEventShortlistStore(storage, options);
  const unsubscribe = store.subscribe(key, () => {});
  await store.load(key);
  const pending = store.setSaved(key, item, false);
  await writing;
  unsubscribe();
  finish();
  assert.equal(await pending, true);
  assert.deepEqual(JSON.parse(storage.getItem(key)).items, []);
  assert.equal(store.getSnapshot(key), EMPTY_CAMPUS_EVENT_SHORTLIST);
});

test('a late read from a prior subscription cannot populate a newly mounted scope', async () => {
  const reads = [];
  const storage = { getItem: () => new Promise(resolve => { reads.push(resolve); }), setItem: () => {} };
  const store = createCampusEventShortlistStore(storage, options);
  const unsubscribe = store.subscribe(key, () => {});
  const prior = store.load(key);
  await Promise.resolve();
  unsubscribe();
  const next = store.subscribe(key, () => {});
  const current = store.load(key);
  reads[0](stored);
  await prior;
  assert.equal(store.getSnapshot(key), EMPTY_CAMPUS_EVENT_SHORTLIST);
  await Promise.resolve();
  reads[1](JSON.stringify({ version: 1, items: [] }));
  await current;
  assert.deepEqual(store.getSnapshot(key), { items: [], ready: true, error: null });
  next();
});
