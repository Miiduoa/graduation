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
  ASSISTANT_SERVICE_CAPABILITIES,
  getAssistantServiceCapability,
} = require('../src/assistantTaskPlan.ts');
const { ASSISTANT_SERVICES } = require('../src/assistantServices.ts');
require.extensions['.ts'] = original;

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
    for (const id of ['library', 'notifications', 'messages', 'community',
      'school-lms', 'dormitory', 'leave', 'grades', 'app-orders', 'admin', 'career']) {
      const capability = getAssistantServiceCapability(id);
      assert.deepEqual(capability.modes, ['handoff'], id);
      assert.deepEqual(capability.tools, ['list_campus_services', 'propose_open_page'], id);
    }
    assert.deepEqual(getAssistantServiceCapability('bus').modes, ['read']);
    assert.deepEqual(getAssistantServiceCapability('food').modes, ['read', 'prepare']);
    assert.deepEqual(getAssistantServiceCapability('calendar').modes, ['read', 'prepare']);
    for (const id of ['school-courses', 'map', 'announcements', 'events', 'lost-found', 'public-social', 'school-info']) {
      assert.deepEqual(getAssistantServiceCapability(id).modes, ['handoff'], id);
      assert.deepEqual(getAssistantServiceCapability(id).tools, ['list_campus_services', 'propose_open_page'], id);
    }
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
