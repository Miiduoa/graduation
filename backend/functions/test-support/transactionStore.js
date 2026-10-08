'use strict';

class FakeTimestamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
}
class Increment { constructor(by) { this.by = by; } }
const Timestamp = { fromMillis: (ms) => new FakeTimestamp(ms) };
const FieldValue = { increment: (by) => new Increment(by) };
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function clone(value) {
  if (value instanceof FakeTimestamp) return new FakeTimestamp(value.ms);
  if (value instanceof Increment) return new Increment(value.by);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}
function merge(base, patch) {
  const result = clone(base || {});
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof Increment) result[key] = (typeof result[key] === 'number' ? result[key] : 0) + value.by;
    else if (value && typeof value === 'object' && !(value instanceof FakeTimestamp) && !Array.isArray(value)) {
      result[key] = merge(result[key], value);
    } else result[key] = clone(value);
  }
  return result;
}

/** Optimistic transaction harness, not a substitute for the Firestore emulator. */
class TransactionStore {
  constructor() {
    this.rows = new Map();
    this.versions = new Map();
    this.attempts = 0;
    this.commits = 0;
    this.writeCommits = 0;
    this.getCalls = 0;
    this.failCommits = false;
    this.beforeCommit = null;
  }
  collection(name) { return this.collectionAt(name); }
  collectionAt(path) {
    return { doc: (id) => this.ref(`${path}/${id}`) };
  }
  ref(path) { return { path, collection: (name) => this.collectionAt(`${path}/${name}`) }; }
  get(path) { return clone(this.rows.get(path)); }
  put(path, value) {
    this.rows.set(path, clone(value));
    this.versions.set(path, (this.versions.get(path) || 0) + 1);
  }
  delete(path) {
    this.rows.delete(path);
    this.versions.set(path, (this.versions.get(path) || 0) + 1);
  }
  dump() { return [...this.rows.entries()].map(([key, value]) => [key, clone(value)]); }
  async runTransaction(callback) {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      this.attempts += 1;
      const readVersions = new Map();
      const writes = [];
      const tx = {
        get: async (ref) => {
          this.getCalls += 1;
          if (writes.length) throw new Error('READ_AFTER_WRITE');
          readVersions.set(ref.path, this.versions.get(ref.path) || 0);
          const data = this.get(ref.path);
          return { exists: data !== undefined, data: () => clone(data) };
        },
        create: (ref, value) => { writes.push({ path: ref.path, value: clone(value), create: true }); },
        set: (ref, value, options) => { writes.push({ path: ref.path, value: clone(value), merge: options?.merge === true }); },
      };
      const result = await callback(tx);
      if (this.beforeCommit) {
        const hook = this.beforeCommit;
        this.beforeCommit = null;
        await hook(this);
      }
      if ([...readVersions].some(([path, version]) => (this.versions.get(path) || 0) !== version)) continue;
      if (this.failCommits) throw new Error('SIMULATED_COMMIT_FAILURE');
      // Stage all effects first so failure of a later create cannot leave earlier writes.
      const pending = new Map();
      for (const write of writes) {
        const existing = pending.has(write.path) ? pending.get(write.path) : this.rows.get(write.path);
        if (write.create && existing !== undefined) throw new Error('ALREADY_EXISTS');
        pending.set(write.path, write.merge ? merge(existing, write.value) : clone(write.value));
      }
      for (const [path, value] of pending) this.put(path, value);
      this.commits += 1;
      if (writes.length) this.writeCommits += 1;
      return result;
    }
    throw new Error('TRANSACTION_RETRY_LIMIT');
  }
}
module.exports = { TransactionStore, Timestamp, FieldValue, HttpsError };
