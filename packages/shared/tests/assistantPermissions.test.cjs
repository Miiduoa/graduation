/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(source, filename);
};
const {
  ASSISTANT_WRITE_PERMISSION_KEYS,
  ASSISTANT_WRITE_PERMISSION_DEFINITIONS,
  createDefaultAssistantWritePermissions,
  normalizeAssistantWritePermissions,
  isAssistantWriteToolAllowed,
  resolveAssistantWritePermissionKey,
  assistantWritePermissionDeniedMessage,
} = require('../src/assistantPermissions.ts');
require.extensions['.ts'] = original;

describe('assistantWritePermissions', () => {
  test('defaults every write tool to closed', () => {
    const defaults = createDefaultAssistantWritePermissions();
    for (const key of ASSISTANT_WRITE_PERMISSION_KEYS) {
      assert.equal(defaults[key], false);
    }
    assert.equal(ASSISTANT_WRITE_PERMISSION_DEFINITIONS.length, ASSISTANT_WRITE_PERMISSION_KEYS.length);
    assert.equal(defaults.createPersonalTodoReminder, false);
  });

  test('missing or invalid payload fails closed', () => {
    assert.equal(isAssistantWriteToolAllowed(null, 'createOrder'), false);
    assert.equal(isAssistantWriteToolAllowed(undefined, 'createOrder'), false);
    assert.equal(isAssistantWriteToolAllowed(normalizeAssistantWritePermissions(null), 'borrowBook'), false);
    assert.equal(isAssistantWriteToolAllowed(normalizeAssistantWritePermissions('x'), 'borrowBook'), false);
    assert.equal(isAssistantWriteToolAllowed(normalizeAssistantWritePermissions([]), 'borrowBook'), false);
    assert.equal(
      isAssistantWriteToolAllowed(normalizeAssistantWritePermissions({ borrowBook: 'yes' }), 'borrowBook'),
      false,
    );
  });

  test('only explicit true enables a tool; unknown tools stay denied', () => {
    const perms = normalizeAssistantWritePermissions({
      borrowBook: true,
      renewBook: false,
      createOrder: 1,
      notATool: true,
    });
    assert.equal(isAssistantWriteToolAllowed(perms, 'borrowBook'), true);
    assert.equal(isAssistantWriteToolAllowed(perms, 'renewBook'), false);
    assert.equal(isAssistantWriteToolAllowed(perms, 'createOrder'), false);
    assert.equal(isAssistantWriteToolAllowed(perms, 'totallyUnknown'), false);
  });

  test('aliases map draft order and personal queue actions to permission keys', () => {
    assert.equal(resolveAssistantWritePermissionKey('proposeOrder'), 'createOrder');
    assert.equal(resolveAssistantWritePermissionKey('split_assignment'), 'createPersonalTodoReminder');
    assert.equal(resolveAssistantWritePermissionKey('schedule_reminder'), 'createPersonalTodoReminder');
    const closed = createDefaultAssistantWritePermissions();
    assert.equal(isAssistantWriteToolAllowed(closed, 'proposeOrder'), false);
    const openOrder = normalizeAssistantWritePermissions({ createOrder: true });
    assert.equal(isAssistantWriteToolAllowed(openOrder, 'proposeOrder'), true);
    const openTodo = normalizeAssistantWritePermissions({ createPersonalTodoReminder: true });
    assert.equal(isAssistantWriteToolAllowed(openTodo, 'schedule_reminder'), true);
  });

  test('denied message names the action and points to settings', () => {
    const message = assistantWritePermissionDeniedMessage('submitLeaveRequest');
    assert.match(message, /送出請假申請/);
    assert.match(message, /settings\?section=assistant/);
    assert.match(assistantWritePermissionDeniedMessage('proposeOrder'), /餐廳下單/);
  });

  test('dorm repair permission is a personal memo, not a school ticket', () => {
    const repair = ASSISTANT_WRITE_PERMISSION_DEFINITIONS.find((row) => row.key === 'createDormRepairRequest');
    assert.ok(repair);
    assert.equal(repair.label, '存成宿舍報修備忘');
    assert.match(repair.description, /個人備忘/);
    assert.match(repair.description, /不會送到學校/);
    assert.doesNotMatch(repair.label, /送出宿舍報修|工單|叫工人/);
    assert.doesNotMatch(repair.description, /送出宿舍維修申請|提交報修|工單/);
    assert.match(assistantWritePermissionDeniedMessage('createDormRepairRequest'), /存成宿舍報修備忘/);
  });
});
