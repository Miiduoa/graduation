/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { assistantRoleTaskGuide } = require('../src/assistantRoleTasks.ts');
const { assistantRoleToolAllowed } = require('../src/assistantRoleProfiles.ts');
const { assistantTaskProfileForWorkContext, assistantWorkContextForTaskProfile } = require('../src/assistantRoleWorkflows.ts');
require.extensions['.ts'] = original;
const now = Date.parse('2026-11-18T10:00:00+08:00');

test('work context and profile select the same dedicated readers without granting student or buyer tools', () => {
  for (const [context, tool, question] of [
    ['teacher', 'get_teaching_overview', '查我的授課概況'],
    ['merchant', 'get_merchant_overview', '查我的門市營運概況'],
  ]) {
    const profile = assistantTaskProfileForWorkContext(context);
    assert.equal(assistantWorkContextForTaskProfile(profile), context);
    assert.equal(assistantRoleToolAllowed(profile, tool), true);
    assert.equal(assistantRoleToolAllowed(profile, tool === 'get_teaching_overview' ? 'get_merchant_overview' : 'get_teaching_overview'), false);
    for (const companion of ['get_school_info', 'get_public_social', 'get_campus_events', 'get_campus_announcements']) {
      assert.equal(assistantRoleToolAllowed(profile, companion), true);
    }
    for (const restricted of ['get_due_work', 'list_courses', 'get_materials', 'get_imported_academics', 'list_food_orders', 'get_food_order']) {
      assert.equal(assistantRoleToolAllowed(profile, restricted), false);
    }
    for (const suffix of ['', '，查學校電話', '，查近期活動', '，查公開交流']) {
      assert.equal(assistantRoleTaskGuide(profile, question + suffix, now), null);
    }
    assert.equal(assistantRoleTaskGuide(profile, question, now, false)?.profileId, profile,
      'An unconnected adapter retains service guidance without private reads');
  }
  for (const [context, profile] of [['staff', 'school'], ['operator', 'platform'], ['club', 'club'], ['student', 'student']]) {
    assert.equal(assistantTaskProfileForWorkContext(context), profile);
    assert.equal(assistantWorkContextForTaskProfile(profile), context);
  }
});

test('negated, quoted, filtered and write requests keep professional service guidance', () => {
  for (const [profile, questions] of [
    ['teacher', ['不要查我的授課概況', '翻譯「查我的授課概況」', '查我的授課概況只看明天', '幫我批改作業', '查我的待繳作業']],
    ['merchant', ['不要查我的門市營運概況', '翻譯「查我的門市營運概況」', '查我的門市營運概況只看明天', '幫我退款', '查最近一筆訂單', '查門市訂單與營收', '查我的門市營運概況，查營收']],
  ]) {
    for (const question of questions) assert.equal(assistantRoleTaskGuide(profile, question, now)?.profileId, profile, question);
  }
});
