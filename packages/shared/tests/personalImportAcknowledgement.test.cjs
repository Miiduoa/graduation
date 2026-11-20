/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { parsePersonalImportSyncState } = require('../src/imports/sync.ts');
const { performPersonalImportSync } = require('../src/imports/syncEngine.ts');
require.extensions['.ts'] = original;

const now = '2026-11-07T10:00:00.000Z';
const event = (id = 'assistant-event-01', patch = {}) => ({
  id, batchId: id, kind: 'events', schoolId: 'pu', title: '資料庫複習',
  academicYear: '', semester: '', date: '2026-11-09', allDay: false,
  startTime: '14:00', endTime: '15:00', importedAt: now,
  source: { type: 'paste', name: '助理確認', line: 1, rawText: '' }, ...patch,
});
const snapshot = (records = [], revision = 1) => ({
  schoolId: 'pu', records, revision, updatedAt: revision ? now : null,
});
const state = (record = event(), patch = {}) => ({
  records: [record],
  sync: { enabled: true, base: snapshot([], 1), acknowledged: [{ record, revision: 2 }], ...patch },
});
const clone = (value) => JSON.parse(JSON.stringify(value));

function server(initial) {
  let remote = clone(initial);
  const accepted = new Map();
  const calls = [];
  return {
    calls,
    replace(value) { remote = clone(value); },
    current() { return clone(remote); },
    async transport(path, input) {
      calls.push({ path, input: clone(input) });
      if (path.endsWith('/read')) return clone(remote);
      const previous = accepted.get(input.mutationId);
      if (previous) {
        assert.deepEqual(input, previous, 'a pending write must be replayed verbatim');
        return clone(remote);
      }
      if (input.expectedRevision !== remote.revision) {
        throw Object.assign(new Error('revision conflict'), { code: 'PERSONAL_IMPORT_REVISION_CONFLICT' });
      }
      accepted.set(input.mutationId, clone(input));
      remote = snapshot(clone(input.records), remote.revision + 1);
      return clone(remote);
    },
  };
}
async function run(current, transport, resolution, checkpoints = []) {
  const result = await performPersonalImportSync('pu', current, transport, () => true, resolution, async (next) => {
    checkpoints.push(clone(next));
    Object.assign(current, clone(next));
  });
  Object.assign(current, clone(result.state));
  return result;
}

describe('single-event acknowledgements validate their evidence', () => {
  test('accepts a scoped event without claiming to replace the full base or enabling sync', () => {
    const current = state(event(), { enabled: false });
    const parsed = parsePersonalImportSyncState(current.sync, 'pu');
    assert.deepEqual(parsed, current.sync);
    assert.notEqual(parsed.acknowledged[0].record, current.sync.acknowledged[0].record);
  });

  for (const [name, acknowledgement] of [
    ['another school', { record: event('foreign', { schoolId: 'ntu' }), revision: 2 }],
    ['a grade record', { record: { ...event(), kind: 'grades' }, revision: 2 }],
    ['a zero revision', { record: event(), revision: 0 }],
    ['a fractional revision', { record: event(), revision: 1.5 }],
    ['an unsafe revision', { record: event(), revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['missing evidence', { revision: 2 }],
    ['extra fields', { record: event(), revision: 2, owner: 'another-account' }],
    ['invalid event contents', { record: event('invalid', { startTime: '20:00', endTime: '10:00' }), revision: 2 }],
  ]) {
    test(`rejects ${name}`, () => {
      assert.throws(() => parsePersonalImportSyncState({ enabled: false, base: null, acknowledged: [acknowledgement] }, 'pu'));
    });
  }

  test('rejects duplicate event IDs, duplicate semantic identities, and oversized metadata', () => {
    const first = { record: event(), revision: 2 };
    for (const acknowledged of [
      [first, first],
      [first, { record: event('different-id'), revision: 3 }],
      Array.from({ length: 2001 }, () => first),
      { record: first },
    ]) {
      assert.throws(() => parsePersonalImportSyncState({ enabled: false, base: null, acknowledged }, 'pu'));
    }
  });

  test('rejects a full base contradicting an event observed at the same revision', () => {
    assert.throws(() => parsePersonalImportSyncState(state().sync, 'ntu'));
    assert.throws(() => parsePersonalImportSyncState(state(event(), { base: snapshot([], 2) }).sync, 'pu'), /同版本/);
    assert.doesNotThrow(() => parsePersonalImportSyncState(state(event(), { base: snapshot([event()], 2) }).sync, 'pu'));
  });
});

describe('single-event evidence participates in the existing three-way merge', () => {
  test('does not resurrect a server-deleted mirrored event with an old full base', async () => {
    const current = state();
    const api = server(snapshot([], 3));
    const result = await run(current, api.transport);
    assert.deepEqual(result.state.records, []);
    assert.deepEqual(result.state.sync.base, snapshot([], 3));
    assert.equal(result.state.sync.acknowledged, undefined);
    assert.equal(api.calls.filter((call) => call.path.endsWith('/write')).length, 0);
  });

  test('does not resurrect a deletion when sync was never enabled before the mirror', async () => {
    const current = state(event(), { base: null });
    const api = server(snapshot([], 3));
    const result = await run(current, api.transport);
    assert.deepEqual(result.state.records, []);
    assert.equal(api.current().revision, 3);
  });

  test('preserves unrelated unsynced rows while retiring the acknowledged deletion', async () => {
    const current = state();
    const localOnly = event('local-only', { title: '未同步自訂行程', date: '2026-11-10' });
    current.records.push(localOnly);
    const api = server(snapshot([], 3));
    const result = await run(current, api.transport);
    assert.deepEqual(result.state.records, [localOnly]);
    assert.deepEqual(api.current().records, [localOnly]);
  });

  test('requires review when a local edit competes with a later remote deletion', async () => {
    const current = state();
    current.records[0] = { ...current.records[0], location: '圖書館' };
    const api = server(snapshot([], 3));
    const result = await run(current, api.transport);
    assert.equal(result.conflicts.length, 1);
    assert.deepEqual(result.conflicts[0].remote, []);
    assert.equal(result.conflicts[0].local[0].location, '圖書館');
    assert.deepEqual(result.review.acknowledged, current.sync.acknowledged);
    assert.equal(api.calls.length, 1);
    assert.equal(current.sync.base.revision, 1);
    assert.equal(current.sync.acknowledged[0].revision, 2);
  });

  test('takes later remote edits when the local mirror is unchanged', async () => {
    const newer = event(undefined, { location: '新教室' });
    const current = state();
    const api = server(snapshot([newer], 3));
    const result = await run(current, api.transport);
    assert.deepEqual(result.state.records, [newer]);
    assert.equal(result.state.sync.acknowledged, undefined);
    assert.equal(api.calls.length, 1);
  });

  test('honors a deliberate local deletion after mirroring', async () => {
    const current = state();
    current.records = [];
    const api = server(snapshot([event()], 3));
    const result = await run(current, api.transport);
    assert.deepEqual(result.state.records, []);
    assert.deepEqual(api.current().records, []);
  });

  test('uses a newer full base instead of an older single-event acknowledgement', async () => {
    const newer = event(undefined, { location: '已同步教室' });
    const current = state(event(), { base: snapshot([newer], 3) });
    current.records = [newer];
    const api = server(snapshot([], 4));
    const result = await run(current, api.transport);
    assert.deepEqual(result.state.records, []);
    assert.equal(api.calls.length, 1);
  });

  for (const [name, remote] of [
    ['older than the observation', snapshot([], 1)],
    ['missing the row at its observed revision', snapshot([], 2)],
    ['changing the row at its observed revision', snapshot([event(undefined, { location: 'different' })], 2)],
  ]) {
    test(`blocks a snapshot ${name} without changing state`, async () => {
      const current = state();
      const before = clone(current);
      const api = server(remote);
      const checkpoints = [];
      await assert.rejects(run(current, api.transport, undefined, checkpoints));
      assert.deepEqual(current, before);
      assert.deepEqual(checkpoints, []);
      assert.equal(api.calls.length, 1);
    });
  }

  test('invalidates prior conflict choices when single-event evidence changes', async () => {
    const current = state();
    current.records[0] = { ...event(), location: '本機修改' };
    const api = server(snapshot([event(undefined, { location: '遠端修改' })], 4));
    const first = await run(current, api.transport);
    const resolution = { ...first.review, choices: { [first.conflicts[0].key]: 'local' } };
    current.sync.acknowledged[0].revision = 3;
    await assert.rejects(run(current, api.transport, resolution), /又有變更/);
    assert.equal(api.calls.filter((call) => call.path.endsWith('/write')).length, 0);
  });

  test('keeps disabled sync untouched and performs no transport', async () => {
    const current = state(event(), { enabled: false });
    const before = clone(current);
    const result = await run(current, async () => assert.fail('disabled sync must not use a transport'));
    assert.deepEqual(result.state, before);
  });
});

describe('uncertain full-ledger writes retain single-event evidence', () => {
  test('checkpoints exact pending payload plus acknowledgement and replays without resurrection', async () => {
    const current = state();
    const localOnly = event('local-only', { title: '未同步安排', date: '2026-11-10' });
    current.records.push(localOnly);
    const api = server(snapshot([event()], 2));
    const beforeBase = clone(current.sync.base);
    await assert.rejects(run(current, async (path, input) => {
      const result = await api.transport(path, input);
      if (path.endsWith('/write')) throw new Error('lost response');
      return result;
    }), /lost response/);
    const pending = clone(current.sync.pending);
    assert.deepEqual(current.sync.base, beforeBase);
    assert.deepEqual(current.sync.acknowledged, [{ record: event(), revision: 2 }]);
    assert.deepEqual(pending.records, [event(), localOnly]);
    api.replace(snapshot([localOnly], 4));
    const result = await run(current, api.transport);
    assert.deepEqual(result.state.records, [localOnly]);
    assert.equal(result.state.sync.pending, undefined);
    assert.equal(result.state.sync.acknowledged, undefined);
    const writes = api.calls.filter((call) => call.path.endsWith('/write'));
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].input, { schoolId: 'pu', ...pending });
    assert.equal(api.current().revision, 4);
  });

  test('retains observations newer than a recovered pending baseline until full merge succeeds', async () => {
    const original = event();
    const other = event('other', { title: '舊同步資料', date: '2026-11-11' });
    const current = state(original, {
      base: snapshot([], 1),
      pending: { mutationId: 'pending-exact-01', expectedRevision: 1, records: [other] },
      acknowledged: [{ record: original, revision: 3 }],
    });
    current.records.push(other);
    const pending = clone(current.sync.pending);
    const remote = snapshot([other], 4);
    const calls = [];
    const checkpoints = [];
    const result = await run(current, async (path, input) => {
      calls.push({ path, input: clone(input) });
      assert.equal(path, 'personal-imports/write');
      assert.deepEqual(input, { schoolId: 'pu', ...pending });
      return clone(remote);
    }, undefined, checkpoints);
    assert.equal(calls.length, 1);
    assert.equal(checkpoints[0].sync.base.revision, 2);
    assert.deepEqual(checkpoints[0].sync.base.records, [other]);
    assert.deepEqual(checkpoints[0].sync.acknowledged, [{ record: original, revision: 3 }]);
    assert.deepEqual(result.state.records, [other]);
    assert.equal(result.state.sync.acknowledged, undefined);
  });

  test('keeps pending and observations untouched when replay cannot be confirmed', async () => {
    const current = state(event(), {
      pending: { mutationId: 'pending-exact-02', expectedRevision: 2, records: [event()] },
    });
    const before = clone(current);
    const api = server(snapshot([], 4));
    const result = await run(current, api.transport);
    assert.equal(result.conflicts[0].reason, 'unconfirmed');
    assert.deepEqual(current, before);
    assert.deepEqual(result.review.acknowledged, before.sync.acknowledged);
    assert.deepEqual(api.calls[0].input, { schoolId: 'pu', ...before.sync.pending });
  });
});
