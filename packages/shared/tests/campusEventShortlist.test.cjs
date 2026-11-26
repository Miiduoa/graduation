/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  campusEventShortlistKey,
  campusEventShortlistOwner,
  createCampusEventShortlistStore,
  CAMPUS_EVENT_SHORTLIST_LIMIT,
  EMPTY_CAMPUS_EVENT_SHORTLIST,
} = require('../src/campusEventShortlist.ts');

const event = { schoolId: 'pu', id: 'lecture:1', source: 'school-events', title: '天文講座' };
const key = campusEventShortlistKey('pu', 'student');

function device() {
  const values = new Map();
  const writes = [];
  return {
    values, writes,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { writes.push(key); values.set(key, value); },
  };
}

test('persists only the public label and source identity and reopens in a fresh store', async () => {
  const storage = device();
  const first = createCampusEventShortlistStore(storage);
  assert.equal(first.getSnapshot(key), EMPTY_CAMPUS_EVENT_SHORTLIST);
  assert.equal(await first.setSaved(key, { ...event, location: 'old room', attendee: 'student' }, true), true);
  assert.deepEqual(JSON.parse(storage.values.get(key)), { version: 1, items: [event] });
  const second = createCampusEventShortlistStore(storage);
  await second.load(key);
  const result = second.getSnapshot(key);
  assert.equal(second.getSnapshot(key), result);
  assert.deepEqual(result, { items: [event], ready: true, error: null });
});

test('keys the signed-in identity by school and platform account in distinct positions', () => {
  assert.equal(campusEventShortlistOwner(null, undefined), null);
  assert.equal(campusEventShortlistOwner('', ''), null);
  const owners = [
    campusEventShortlistOwner('student'), campusEventShortlistOwner(null, 'student'),
    campusEventShortlistOwner('student', 'student'), campusEventShortlistOwner('student', 'other'),
    campusEventShortlistOwner('other', 'student'), campusEventShortlistOwner(null, null),
  ];
  assert.equal(new Set(owners.map((owner) => campusEventShortlistKey('pu', owner))).size, owners.length);
});

test('isolates account, guest and school, and rejects a mismatched school on both read and write', async () => {
  const storage = device();
  const store = createCampusEventShortlistStore(storage);
  const otherSchool = campusEventShortlistKey('ntu', 'student');
  const scopes = [key, otherSchool, campusEventShortlistKey('pu', null), campusEventShortlistKey('pu', 'guest')];
  assert.equal(new Set(scopes).size, scopes.length);
  assert.notEqual(campusEventShortlistKey('a:b', 'c'), campusEventShortlistKey('a', 'b:c'));
  await store.setSaved(key, event, true);
  for (const scope of scopes.slice(1)) {
    await store.load(scope);
    assert.deepEqual(store.getSnapshot(scope).items, []);
  }
  assert.equal(await store.setSaved(otherSchool, event, true), false);
  assert.deepEqual(storage.writes, [key]);
  storage.values.set(otherSchool, storage.values.get(key));
  await store.load(otherSchool);
  assert.equal(store.getSnapshot(otherSchool).ready, false);
  assert.deepEqual(store.getSnapshot(otherSchool).items, []);
});

test('serializes concurrent operations by source and id, with idempotent writes and removals', async () => {
  const storage = device();
  const store = createCampusEventShortlistStore(storage);
  const club = { ...event, source: 'school-club-events', title: '社團同編號' };
  const pending = [event, club, event].map((item) => store.setSaved(key, item, true));
  assert.deepEqual(await Promise.all(pending), [true, true, true]);
  assert.deepEqual(store.getSnapshot(key).items, [club, event]);
  await Promise.all([store.setSaved(key, event, false), store.load(key), store.setSaved(key, event, false)]);
  assert.deepEqual(store.getSnapshot(key).items, [club]);
  assert.equal(storage.writes.length, 3);
});

test('two tabs re-read under the same storage lock before writing', async () => {
  const storage = device();
  let queue = Promise.resolve();
  const locks = [];
  storage.withLock = (scope, operation) => {
    locks.push(scope);
    const current = queue.then(operation);
    queue = current.then(() => undefined);
    return current;
  };
  const first = createCampusEventShortlistStore(storage);
  const second = createCampusEventShortlistStore(storage);
  const another = { ...event, id: 'lecture:2' };
  await Promise.all([first.setSaved(key, event, true), second.setSaved(key, another, true)]);
  assert.deepEqual(locks, [key, key]);
  await first.load(key);
  assert.deepEqual(first.getSnapshot(key).items, [another, event]);
});

test('corrupt, foreign-version and malformed documents survive a read and an attempted new save', async () => {
  const storage = device();
  const store = createCampusEventShortlistStore(storage);
  for (const raw of ['{bad', '{"version":2,"items":[]}', JSON.stringify({ version: 1, items: [event, { id: 'broken' }] })]) {
    storage.values.set(key, raw);
    await store.load(key);
    assert.equal(await store.setSaved(key, event, true), false);
    const snapshot = store.getSnapshot(key);
    assert.equal(snapshot.ready, false);
    assert.ok(snapshot.error);
    assert.deepEqual(snapshot.items, []);
    assert.equal(storage.values.get(key), raw);
    assert.deepEqual(storage.writes, []);
  }
});

test('keeps the last persisted contents after a failed write and retries after storage recovers', async () => {
  const storage = device();
  const store = createCampusEventShortlistStore(storage);
  const originalWrite = storage.setItem;
  const originalRead = storage.getItem;
  await store.setSaved(key, event, true);
  storage.setItem = () => { throw new Error('secret internal string'); };
  assert.equal(await store.setSaved(key, event, false), false);
  assert.deepEqual(store.getSnapshot(key).items, [event]);
  assert.doesNotMatch(store.getSnapshot(key).error, /secret/);
  storage.getItem = () => { throw new Error('secret read error'); };
  assert.equal(await store.setSaved(key, event, false), false);
  assert.doesNotMatch(store.getSnapshot(key).error, /secret/);
  storage.getItem = originalRead;
  storage.setItem = originalWrite;
  assert.equal(await store.setSaved(key, event, false), true);
  assert.deepEqual(store.getSnapshot(key), { items: [], ready: true, error: null });
});

test('caps total saves without silently evicting an older event and allows removal at capacity', async () => {
  const storage = device();
  const store = createCampusEventShortlistStore(storage);
  const items = Array.from({ length: CAMPUS_EVENT_SHORTLIST_LIMIT }, (_, index) => ({ ...event, id: `id-${index}` }));
  storage.values.set(key, JSON.stringify({ version: 1, items }));
  assert.equal(await store.setSaved(key, event, true), false);
  assert.equal(await store.setSaved(key, items[0], true), true);
  assert.deepEqual(storage.writes, []);
  await store.setSaved(key, items[0], false);
  assert.equal(await store.setSaved(key, event, true), true);
  assert.equal(store.getSnapshot(key).items.length, CAMPUS_EVENT_SHORTLIST_LIMIT);
});

test('notifies only subscribed scopes and stops after unsubscribe', async () => {
  const store = createCampusEventShortlistStore(device());
  let calls = 0;
  const unsubscribe = store.subscribe(key, () => { calls++; });
  await store.load(campusEventShortlistKey('pu', 'someone-else'));
  assert.equal(calls, 0);
  await store.load(key);
  assert.equal(calls, 1);
  unsubscribe();
  await store.setSaved(key, event, true);
  assert.equal(calls, 1);
});
