/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
let lost, formFields;
if (process.env.LOST_FOUND_COMPILED) {
  lost = require(path.join(process.env.LOST_FOUND_COMPILED, 'contracts.js'));
  formFields = require(path.join(process.env.LOST_FOUND_COMPILED, 'lostFoundFields.js'));
} else {
  const ts = require('typescript');
  const original = require.extensions['.ts'];
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  lost = require('../src/nuniLostFound.ts');
  formFields = require('../src/lostFoundFields.ts');
  require.extensions['.ts'] = original;
}
const id = `plf_${randomUUID()}`;
const fields = { type: 'lost', title: '藍色水壺', description: '有星星貼紙', category: 'other',
  location: '圖書館', date: '2026-11-07', contactInfo: 'owner@example.test' };
const input = { schoolId: 'pu', id, mutationId: randomUUID(), fields };
const item = (extra = {}) => ({ ...fields, id, schoolId: 'pu', status: 'open', version: 1,
  createdAt: '2026-11-07T06:00:00.000Z', updatedAt: '2026-11-07T06:00:00.000Z', resolvedAt: null, isOwner: true, ...extra });
const target = { schoolId: 'pu', id };
const command = { ...target, expectedVersion: 1, mutationId: randomUUID() };
const summary = (extra = {}) => { const { contactInfo: _contact, ...value } = item(extra); return value; };

test('editable-field projection omits absent contact but preserves explicit clearing and values', () => {
  const { contactInfo: _contact, ...withoutContact } = fields;
  const omitted = formFields.pickLostFoundFields({ ...withoutContact, id, schoolId: 'pu' });
  assert.deepEqual(omitted, withoutContact);
  assert.equal(Object.hasOwn(omitted, 'contactInfo'), false);
  assert.equal(Object.hasOwn(formFields.pickLostFoundFields({ ...fields, contactInfo: '' }), 'contactInfo'), true);
  assert.equal(formFields.pickLostFoundFields({ ...fields, contactInfo: '' }).contactInfo, '');
  assert.equal(formFields.pickLostFoundFields(fields).contactInfo, fields.contactInfo);
});

test('all platform lost-found actions use POST bodies with the existing bounded transport', async () => {
  const calls = [];
  const client = lost.createNuniLostFound(async (route, body) => {
    calls.push({ route, body });
    if (route.endsWith('/list')) return { schoolId: 'pu', items: [summary()], nextCursor: null };
    if (route.endsWith('/export')) return { schoolId: 'pu', items: [item()], nextCursor: null };
    if (route.endsWith('/remove')) return { ...target, removed: true };
    if (route.endsWith('/resolve')) return { item: item({ version: 2, status: 'resolved', contactInfo: '', resolvedAt: '2026-11-07T06:01:00.000Z' }) };
    if (route.endsWith('/update')) return { item: item({ version: 2 }) };
    return { item: item() };
  });
  assert.equal((await client.list({ schoolId: 'pu' })).items[0].contactInfo, undefined);
  assert.equal((await client.get(target)).contactInfo, fields.contactInfo);
  assert.equal((await client.create(input)).version, 1);
  assert.equal((await client.update({ ...command, fields })).version, 2);
  assert.equal((await client.resolve(command)).contactInfo, '');
  assert.equal((await client.remove(command)).removed, true);
  assert.equal((await client.export({ schoolId: 'pu' })).items[0].isOwner, true);
  assert.deepEqual(calls.map(call => call.route), ['list', 'get', 'create', 'update', 'resolve', 'remove', 'export'].map(action => `lost-found/${action}`));
});

for (const schoolId of ['', 'all', 'personal', 'unavailable-campus', 'PU', '../pu', ' pu', 'pu ', 'pu\n', 'pu\r', '-pu', 'pu-', 'p'.repeat(81)]) {
  test(`rejects unselected, malformed or sentinel school scope: ${schoolId}`, () => {
    assert.throws(() => lost.validateNuniLostFoundRequest('list', { schoolId }), { status: 422 });
  });
}
for (const [key, value] of [
  ['platformAccountId', 'pa_victim'], ['owner', 'victim'], ['status', 'resolved'], ['version', 100],
  ['userId', 'firebase-user'], ['role', 'admin'], ['schoolId', 'pu'],
]) {
  test(`editable fields reject injected ${key}`, () => {
    assert.throws(() => lost.validateNuniLostFoundRequest('create', { ...input, fields: { ...fields, [key]: value } }), { status: 422 });
  });
}
for (const badFields of [
  { ...fields, date: '2026-02-30' }, { ...fields, date: '2026-11-07T00:00:00Z' },
  { ...fields, date: '0000-01-01' }, { ...fields, title: 'x'.repeat(81) },
  { ...fields, description: 'x'.repeat(2001) }, { ...fields, location: 'x'.repeat(121) },
  { ...fields, contactInfo: 'x'.repeat(201) }, { ...fields, category: 'unknown' },
  { ...fields, title: 'bad\0title' }, { ...fields, contactInfo: '\ud800' },
]) {
  test(`rejects invalid form ${JSON.stringify(badFields).slice(0, 90)}`, () => {
    assert.throws(() => lost.validateNuniLostFoundRequest('create', { ...input, fields: badFields }), { status: 422 });
  });
}
test('normalizes visible fields, preserves an omitted edit contact and permits explicit clearing', () => {
  const { contactInfo: _contact, ...withoutContact } = fields;
  assert.deepEqual(lost.validateNuniLostFoundRequest('create', { ...input, fields: { ...withoutContact, title: '  藍色水壺  ' } }).fields,
    { ...fields, contactInfo: '' });
  assert.equal(Object.hasOwn(lost.validateNuniLostFoundRequest('update', { ...command, fields: withoutContact }).fields, 'contactInfo'), false);
  assert.equal(lost.validateNuniLostFoundRequest('update', { ...command, fields: { ...fields, contactInfo: '  ' } }).fields.contactInfo, '');
});
test('rejects accessor/prototype payloads without invoking getters', () => {
  let called = false;
  const value = { ...input, get owner() { called = true; return 'victim'; } };
  assert.throws(() => lost.validateNuniLostFoundRequest('create', value), { status: 422 });
  assert.equal(called, false);
  assert.throws(() => lost.validateNuniLostFoundRequest('list', Object.create({ schoolId: 'pu' })), { status: 422 });
});
test('rejects unsupported actions, oversized pages and invalid versions/mutation IDs', () => {
  assert.equal(lost.isNuniLostFoundAction('remove/other'), false);
  for (const [action, payload] of [
    ['all', { schoolId: 'pu' }], ['list', { schoolId: 'pu', limit: 51 }],
    ['list', { schoolId: 'pu', limit: 0 }], ['list', { schoolId: 'pu', q: 'q'.repeat(101) }],
    ['list', { schoolId: 'pu', owner: 'victim' }], ['export', { schoolId: 'pu', mine: false }],
    ['update', { ...command, expectedVersion: 0, fields }], ['update', { ...command, expectedVersion: 2.2, fields }],
    ['create', { ...input, mutationId: 'short' }], ['create', { ...input, id: 'legacy-firestore-id' }],
    ['create', { ...input, mutationId: input.mutationId + '\n' }], ['get', { ...target, id: id + '\n' }],
    ['list', { schoolId: 'pu', cursor: 'cursor-token\n' }],
  ]) assert.throws(() => lost.validateNuniLostFoundRequest(action, payload), { status: 422 });
});

for (const changed of [
  { id: `plf_${randomUUID()}` }, { schoolId: 'ntu' }, { isOwner: false }, { version: 2 },
  { title: '另一件物品' }, { contactInfo: 'other@example.test' },
  { status: 'resolved', contactInfo: '', resolvedAt: '2026-11-07T06:01:00.000Z' },
]) test(`rejects a mismatched create receipt ${JSON.stringify(changed)}`, () => {
  assert.throws(() => lost.parseNuniLostFoundResponse('create', { item: item(changed) }, input), { status: 502 });
});
test('update and resolve receipts must prove the requested next version and final state', () => {
  const update = { ...command, fields };
  for (const changed of [{ version: 1 }, { version: 3 }, { version: 2, location: '別處' }, { version: 2, isOwner: false }]) {
    assert.throws(() => lost.parseNuniLostFoundResponse('update', { item: item(changed) }, update), { status: 502 });
  }
  const resolved = item({ version: 2, status: 'resolved', contactInfo: '', resolvedAt: '2026-11-07T06:01:00.000Z' });
  assert.equal(lost.parseNuniLostFoundResponse('resolve', { item: resolved }, command).item.status, 'resolved');
  for (const changed of [{ status: 'open', resolvedAt: null }, { contactInfo: 'still@example.test' }, { version: 3 }])
    assert.throws(() => lost.parseNuniLostFoundResponse('resolve', { item: { ...resolved, ...changed } }, command), { status: 502 });
});
test('summaries cannot carry contacts; owner exports cannot carry another owner or another school', () => {
  const page = { schoolId: 'pu', items: [summary()], nextCursor: null };
  assert.deepEqual(lost.parseNuniLostFoundResponse('list', page, { schoolId: 'pu' }), page);
  assert.throws(() => lost.parseNuniLostFoundResponse('list', { ...page, items: [item()] }, { schoolId: 'pu' }), { status: 502 });
  assert.throws(() => lost.parseNuniLostFoundResponse('export', { ...page, items: [item({ isOwner: false })] }, { schoolId: 'pu' }), { status: 502 });
  assert.throws(() => lost.parseNuniLostFoundResponse('get', { item: item({ schoolId: 'ntu' }) }, target), { status: 502 });
  assert.throws(() => lost.parseNuniLostFoundResponse('remove', { ...target, removed: true, contactInfo: 'unexpected' }, command), { status: 502 });
});
test('rejects duplicate/out-of-scope/filtered pages and cyclic pagination', () => {
  for (const [value, request] of [
    [{ schoolId: 'pu', items: [summary(), summary()], nextCursor: null }, { schoolId: 'pu' }],
    [{ schoolId: 'pu', items: [summary({ schoolId: 'ntu' })], nextCursor: null }, { schoolId: 'pu' }],
    [{ schoolId: 'pu', items: [summary({ isOwner: false })], nextCursor: null }, { schoolId: 'pu', mine: true }],
    [{ schoolId: 'pu', items: [summary()], nextCursor: 'cursor-token' }, { schoolId: 'pu', cursor: 'cursor-token' }],
    [{ schoolId: 'pu', items: [], nextCursor: 'cursor-token' }, { schoolId: 'pu' }],
    [{ schoolId: 'pu', items: [summary()], nextCursor: null }, { schoolId: 'pu', type: 'found' }],
  ]) assert.throws(() => lost.parseNuniLostFoundResponse('list', value, request), { status: 502 });
});
test('failed delivery retains caller intent and is never automatically retried', async () => {
  const calls = [];
  const client = lost.createNuniLostFound(async (...args) => { calls.push(args); throw new Error('connection lost'); });
  await assert.rejects(client.create(input), /connection lost/);
  assert.equal(calls.length, 1);
  await assert.rejects(client.create(input), /connection lost/);
  assert.deepEqual(calls[0], calls[1]);
});
