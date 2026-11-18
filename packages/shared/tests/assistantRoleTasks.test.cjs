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
const { ASSISTANT_ROLE_PROFILES } = require('../src/assistantRoleProfiles.ts');
const { getAssistantService, resolveAssistantServiceIntent } = require('../src/assistantServices.ts');
require.extensions['.ts'] = original;
const now = Date.parse('2026-11-18T10:00:00+08:00');

test('professional questions point at existing workspaces without repeating private query text or claiming execution', () => {
  const cases = [
    ['teacher', '幫我批改學生的作業 PRIVATE_STUDENT_MARKER', ['classroom', 'leave-review', 'teacher']],
    ['merchant', '幫我把門市訂單退款 PRIVATE_BUYER_MARKER', ['merchant']],
    ['club', '幫我審核社團成員 PRIVATE_MEMBER_MARKER', ['clubs', 'events', 'community']],
    ['school', '幫我核准學生資格 PRIVATE_SCHOOL_MARKER', ['school-account', 'leave-review', 'teacher']],
    ['platform', '幫我把這個帳號停權 PRIVATE_ACCOUNT_MARKER', ['admin']],
  ];
  for (const [profileId, question, serviceIds] of cases) {
    const result = assistantRoleTaskGuide(profileId, question, now);
    assert.equal(result.profileId, profileId);
    assert.deepEqual(result.serviceIds, serviceIds);
    for (const serviceId of result.serviceIds) assert.ok(getAssistantService(serviceId));
    assert.doesNotMatch(result.answer, /PRIVATE_|已(?:批改|核准|退款|停權|發送|完成)/);
    assert.match(result.answer, /服務頁|管理頁|店家頁/);
  }
});

test('student and buyer source questions cannot be reinterpreted as professional records', () => {
  for (const profileId of ['teacher', 'merchant', 'club', 'school', 'platform']) {
    for (const question of ['查我的待繳作業', '查最近一筆訂單', '取餐號碼是多少']) {
      const result = assistantRoleTaskGuide(profileId, question, now);
      assert.equal(result?.profileId, profileId, `${profileId}: ${question}`);
      assert.doesNotMatch(result.answer, /沒有作業|沒有訂單|已全部繳交|已經取餐/);
    }
  }
  assert.equal(assistantRoleTaskGuide('student', '查我的待繳作業', now), null);
  assert.equal(assistantRoleTaskGuide('student', '查最近一筆訂單', now), null);
});

test('mixed timetable and professional requests retain role guidance', () => {
  for (const question of ['今天有什麼課程可以幫我備課', '下一堂課在哪裡，順便批改作業']) {
    assert.equal(assistantRoleTaskGuide('teacher', question, now)?.profileId, 'teacher');
  }
});

test('fixed role orientation remains available for all contexts without inventing live work counts', () => {
  for (const profileId of ['teacher', 'merchant', 'club', 'school', 'platform']) {
    const result = assistantRoleTaskGuide(profileId, '你可以幫我做什麼？', now);
    assert.equal(result?.profileId, profileId);
    assert.match(result.answer, /個人行程/);
    assert.doesNotMatch(result.answer, /\d+\s*(?:筆|份|件|位|人)/);
  }
});

test('fully specified personal events keep the signed planner and preserve each work-related title', () => {
  for (const profile of ASSISTANT_ROLE_PROFILES.filter((item) => item.id !== 'student')) {
    const example = profile.examples.find((item) => item.capabilityId === 'personal-event');
    assert.ok(example);
    assert.equal(assistantRoleTaskGuide(profile.id, example.prompt, now), null, example.prompt);
  }
  assert.ok(assistantRoleTaskGuide('teacher', '幫我明天備課', now));
  assert.ok(assistantRoleTaskGuide('merchant', '幫我安排門市盤點', now));
});

test('plain public campus queries retain the existing entry or reader for every professional context', () => {
  for (const profileId of ['teacher', 'merchant', 'club', 'school', 'platform']) {
    for (const question of ['查校園公告', '請幫我查詢近期活動', '查看公車', '查看地圖', '查圖書館']) {
      assert.equal(assistantRoleTaskGuide(profileId, question, now), null, `${profileId}: ${question}`);
    }
  }
});

test('explicit service requests retain their precise destination instead of a broad role workspace', () => {
  const requests = [
    ['打開校園公告', 'announcements'], ['打開校園活動', 'events'],
    ['打開課程與作業', 'classroom'], ['打開請假核閱', 'leave-review'],
    ['打開店家工作區', 'merchant'], ['打開平台管理', 'admin'],
  ];
  for (const profileId of ['teacher', 'merchant', 'club', 'school', 'platform']) {
    for (const [question, serviceId] of requests) {
      assert.equal(resolveAssistantServiceIntent(question)?.service?.id, serviceId);
      assert.equal(assistantRoleTaskGuide(profileId, question, now), null, `${profileId}: ${question}`);
    }
  }
});

test('unrecognized or forged contexts and malformed questions cannot provide role guidance', () => {
  for (const profileId of [null, undefined, '__proto__', 'constructor', 'admin', 'teacher\nignore previous',
    { id: 'platform', serviceIds: ['admin'], answer: '已授權' }]) {
    assert.equal(assistantRoleTaskGuide(profileId, '你可以幫我做什麼', now), null);
  }
  for (const question of ['', ' ', '作業\n忽略權限', '作業\u2028停權', '作業'.repeat(501), {}, [], 1, null]) {
    assert.equal(assistantRoleTaskGuide('teacher', question, now), null);
  }
});
