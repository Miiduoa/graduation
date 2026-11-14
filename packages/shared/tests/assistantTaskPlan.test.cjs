/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(source, filename);
};
const {
  parseAssistantTaskPlan,
  ASSISTANT_SERVICE_CAPABILITIES,
  getAssistantServiceCapability,
} = require('../src/assistantTaskPlan.ts');
const { ASSISTANT_SERVICES } = require('../src/assistantServices.ts');
require.extensions['.ts'] = original;

const step = (overrides = {}) => ({
  id: 'step-1', label: '查詢課程待辦', serviceId: 'classroom', dependsOn: [],
  status: 'completed', summary: '已查詢本人課程的待辦。', ...overrides,
});
const plan = (...steps) => ({ version: 1, steps });

describe('assistant task evidence contract', () => {
  test('preserves an ordered cross-service plan without treating a prepared card as a completed action', () => {
    const raw = plan(
      step(),
      step({ id: 'step-2', label: '查詢可用時間', serviceId: 'timetable', dependsOn: ['step-1'] }),
      step({ id: 'step-3', label: '準備讀書行程', serviceId: 'calendar', dependsOn: ['step-1', 'step-2'],
        status: 'ready', summary: '已準備行程，尚待確認。', cardIds: ['mutation-1234'] }),
      step({ id: 'step-4', label: '開啟圖書館', serviceId: 'library', dependsOn: ['step-3'],
        status: 'handoff', summary: '可到圖書館頁核對服務。', href: '/library?schoolId=pu' }),
    );
    assert.deepEqual(parseAssistantTaskPlan(raw), raw);
  });

  test('copies every mutable part so a caller cannot replace dependencies or card references after parsing', () => {
    const raw = plan(step(), step({ id: 'step-2', dependsOn: ['step-1'], cardIds: ['mutation-1234'] }));
    const result = parseAssistantTaskPlan(raw);
    assert.ok(result);
    raw.steps[1].dependsOn.push('other-account');
    raw.steps[1].cardIds[0] = 'other-mutation';
    raw.steps[1].label = 'changed';
    assert.deepEqual(result.steps[1].dependsOn, ['step-1']);
    assert.deepEqual(result.steps[1].cardIds, ['mutation-1234']);
    assert.equal(result.steps[1].label, '查詢課程待辦');
  });

  test('accepts each display status, including partial and blocked reads', () => {
    for (const status of ['completed', 'ready', 'partial', 'blocked', 'handoff']) {
      assert.equal(parseAssistantTaskPlan(plan(step({ status }))).steps[0].status, status);
    }
  });

  test('rejects a malformed plan, unknown fields and unsupported contract versions', () => {
    for (const raw of [null, [], {}, { version: 2, steps: [step()] }, { version: 1, steps: [] },
      { version: 1, steps: [step()], authorized: true }, plan(step({ arbitrary: 'untrusted' })),
      plan(step({ status: 'success' })), plan(step({ serviceId: 'send-money' })),
      plan(step({ serviceId: '__proto__' })), plan(step({ dependsOn: undefined }))]) {
      assert.equal(parseAssistantTaskPlan(raw), null);
    }
  });

  test('rejects repeated IDs, unknown and forward dependencies, self references and cycles', () => {
    for (const raw of [
      plan(step(), step()),
      plan(step({ dependsOn: ['missing'] })),
      plan(step({ dependsOn: ['step-1'] })),
      plan(step({ dependsOn: ['step-2'] }), step({ id: 'step-2' })),
      plan(step({ dependsOn: ['step-2'] }), step({ id: 'step-2', dependsOn: ['step-1'] })),
      plan(step(), step({ id: 'step-2', dependsOn: ['step-1', 'step-1'] })),
    ]) assert.equal(parseAssistantTaskPlan(raw), null);
  });

  test('bounds graph size without silently dropping tasks', () => {
    const steps = Array.from({ length: 16 }, (_, index) => step({ id: `step-${index}`,
      dependsOn: Array.from({ length: index }, (_, dependency) => `step-${dependency}`) }));
    assert.equal(parseAssistantTaskPlan(plan(...steps)).steps.length, 16);
    assert.equal(parseAssistantTaskPlan(plan(...steps, step({ id: 'step-17' }))), null);
  });

  test('bounds identifiers and visible text and refuses hidden control characters', () => {
    for (const bad of [
      { id: 'x'.repeat(101) }, { id: 'step 1' }, { id: '' },
      { label: 'x'.repeat(121) }, { label: ' ' }, { label: ' action' },
      { summary: 'x'.repeat(1201) }, { summary: '' },
      { label: '查詢\n送出' }, { summary: '資料\u0000寫入' },
      { summary: '資料\u2028寫入' }, { summary: '資料\u2029寫入' },
    ]) assert.equal(parseAssistantTaskPlan(plan(step(bad))), null);
    assert.ok(parseAssistantTaskPlan(plan(step({ id: 'x'.repeat(100), label: 'x'.repeat(120), summary: 'x'.repeat(1200) }))));
  });

  test('does not evaluate accessor-backed plan, step or array fields', () => {
    let called = false;
    const getter = { enumerable: true, get() { called = true; throw new Error('must not run'); } };
    const raw = plan(step());
    Object.defineProperty(raw, 'steps', getter);
    assert.equal(parseAssistantTaskPlan(raw), null);
    const accessorStep = step();
    Object.defineProperty(accessorStep, 'status', getter);
    assert.equal(parseAssistantTaskPlan(plan(accessorStep)), null);
    const steps = [step()];
    Object.defineProperty(steps, '0', getter);
    assert.equal(parseAssistantTaskPlan({ version: 1, steps }), null);
    assert.equal(called, false);
  });

  test('rejects prototype objects, symbol fields, sparse arrays and array sidecars', () => {
    const symbolStep = step();
    symbolStep[Symbol('authority')] = true;
    const sidecar = [];
    sidecar.extra = 'mutation-other';
    for (const raw of [
      Object.assign(Object.create({ authorized: true }), plan(step())),
      plan(Object.assign(Object.create({ authorized: true }), step())),
      plan(symbolStep), { version: 1, steps: new Array(1) },
      plan(step({ dependsOn: new Array(1) })), plan(step({ dependsOn: sidecar })),
    ]) assert.equal(parseAssistantTaskPlan(raw), null);
  });

  test('requires bounded unique card references without granting them execution authority', () => {
    for (const cardIds of [[], ['same', 'same'], [' bad'], ['x'.repeat(101)], ['good', null],
      Array.from({ length: 17 }, (_, index) => `card-${index}`)]) {
      assert.equal(parseAssistantTaskPlan(plan(step({ cardIds }))), null);
    }
    const result = parseAssistantTaskPlan(plan(step({ status: 'ready', cardIds: ['not-a-card-in-this-reply'] })));
    assert.equal(result.steps[0].status, 'ready');
    assert.equal(Object.hasOwn(result.steps[0], 'authorized'), false);
  });

  test('accepts allowlisted internal paths, safe queries and platform order destination', () => {
    for (const [serviceId, href] of [
      ['calendar', '/calendar?schoolId=pu#day'],
      ['assistant-permissions', '/settings?section=assistant&schoolId=pu'],
      ['grades', '/grades?tab=semester'],
      ['orders', '/orders?schoolId=pu'], ['orders', '/food?schoolId=pu'],
      ['map', '/map?place=%E5%9C%96%E6%9B%B8%E9%A4%A8'],
      ['food', '/food?note=50%25'],
    ]) assert.equal(parseAssistantTaskPlan(plan(step({ serviceId, href }))).steps[0].href, href);
  });

  test('refuses external, arbitrary internal, traversal and encoded unsafe destinations', () => {
    for (const href of [
      'https://external.test', '//external.test', 'javascript:alert(1)', '/\\external.test',
      '/api/delete-account', '/logout', '/redirect?url=https://external.test', '/food/../logout',
      '/food?note=\nhello', '/food?note=%0ahello', '/food?note=%250ahello',
      '/food?note=%255cexternal.test', '/food?note=%E0%A4%A', '/food?note=%',
      '/%2ffood', '/%252ffood', '/food?note=' + 'x'.repeat(512),
    ]) assert.equal(parseAssistantTaskPlan(plan(step({ serviceId: 'food', href }))), null, href);
    assert.equal(parseAssistantTaskPlan(plan(step({ serviceId: 'library', href: '/admin' }))), null);
    assert.equal(parseAssistantTaskPlan(plan(step({ serviceId: 'app-orders', href: '/food' }))), null);
  });

  test('returns null when an unknown object cannot be inspected', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assert.equal(parseAssistantTaskPlan(proxy), null);
  });
});

describe('assistant connected service capabilities', () => {
  test('covers each service exactly once and never invents an unknown service', () => {
    assert.deepEqual(ASSISTANT_SERVICE_CAPABILITIES.map((entry) => entry.serviceId), ASSISTANT_SERVICES.map((entry) => entry.id));
    for (const entry of ASSISTANT_SERVICE_CAPABILITIES) {
      assert.ok(entry.summary && entry.tools.length);
      assert.ok(entry.modes.length && entry.modes.every((mode) => ['read', 'prepare', 'handoff'].includes(mode)));
      assert.equal(new Set(entry.modes).size, entry.modes.length);
      assert.equal(getAssistantServiceCapability(entry.serviceId), entry);
    }
    for (const id of ['__proto__', 'send-money', null, [], {}, 1]) {
      assert.equal(getAssistantServiceCapability(id), null);
    }
  });

  test('only lists tools registered by the current Web V2 runtime', () => {
    const source = fs.readFileSync(require.resolve('../../../apps/web/src/lib/nuni/assistantV2/tools.ts'), 'utf8');
    const definitions = source.split('const definitions: Record<string, [Obj, string[]]> = {')[1]?.split('\n};')[0];
    assert.ok(definitions, 'The real tool definitions must be inspected');
    const tools = new Set([...definitions.matchAll(/^ {2}([a-z_]+): \[/gm)].map((match) => match[1]));
    for (const entry of ASSISTANT_SERVICE_CAPABILITIES) {
      for (const tool of entry.tools) assert.ok(tools.has(tool), `${entry.serviceId}: unknown tool ${tool}`);
    }
  });

  test('does not label source links, unconnected private services or school writers as data or execution', () => {
    for (const id of ['library', 'map', 'announcements', 'events', 'notifications', 'messages',
      'school-lms', 'dormitory', 'leave', 'grades', 'app-orders', 'admin']) {
      const capability = getAssistantServiceCapability(id);
      assert.deepEqual(capability.modes, ['handoff'], id);
      assert.deepEqual(capability.tools, ['list_campus_services', 'propose_open_page'], id);
    }
    assert.deepEqual(getAssistantServiceCapability('bus').modes, ['read']);
    assert.deepEqual(getAssistantServiceCapability('food').modes, ['read', 'prepare']);
    assert.deepEqual(getAssistantServiceCapability('calendar').modes, ['read', 'prepare']);
    assert.deepEqual(getAssistantServiceCapability('school-courses').modes, ['read', 'handoff']);
    assert.deepEqual(getAssistantServiceCapability('school-courses').tools,
      ['get_public_courses', 'list_campus_services', 'propose_open_page']);
  });

  test('metadata remains immutable and does not expose an authorization decision', () => {
    const entry = getAssistantServiceCapability('calendar');
    assert.ok(Object.isFrozen(ASSISTANT_SERVICE_CAPABILITIES));
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.modes) && Object.isFrozen(entry.tools));
    assert.throws(() => entry.modes.push('execute'), TypeError);
    assert.throws(() => Object.assign(entry, { authorized: true }), TypeError);
    assert.equal(Object.hasOwn(entry, 'authorized'), false);
  });
});
