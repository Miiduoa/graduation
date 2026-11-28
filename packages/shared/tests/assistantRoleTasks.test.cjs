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


test('all professional contexts retain whole supported public queries and compounds', () => {
  for (const profile of ['teacher', 'merchant', 'club', 'school', 'platform']) {
    for (const question of ['查學校電話', '查學校資訊', '查公開交流', '查校園公告，查學校電話',
      '查近期活動，查學校電話', '查學校資訊，查公開交流', '查校園公告，查近期活動，查學校電話']) {
      assert.equal(assistantRoleTaskGuide(profile, question, now), null, `${profile}: ${question}`);
    }
  }
});

test('a supported public or workspace read never consumes unsupported professional writes in another clause', () => {
  for (const profile of ['teacher', 'merchant', 'club', 'school', 'platform']) {
    for (const question of ['查學校電話，發布公告', '查近期活動，刪除資料', '查公開交流，核准資格',
      '查校園公告，幫我退款', '查學校資訊，停權帳號', '查公開交流，通知學生',
      '查學校電話，幫我發文', '查公開交流，幫我上架商品', '查學校資訊，刪掉資料']) {
      assert.equal(assistantRoleTaskGuide(profile, question, now)?.profileId, profile, `${profile}: ${question}`);
    }
  }
  for (const question of ['查我的授課概況，發布公告', '查我的授課概況，刪除資料',
    '查我的授課概況，通知學生']) {
    assert.equal(assistantRoleTaskGuide('teacher', question, now)?.profileId, 'teacher', question);
  }
});

test('complete work sessions keep their own role and source-checked planning flow', () => {
  for (const [profile, question] of [
    ['teacher', '安排明天下午一小時備課'],
    ['teacher', '查我的授課概況，安排明天下午一小時備課'],
    ['merchant', '查我的門市營運概況，安排明天下午半小時盤點'],
    ['club', '安排明天下午一小時社團籌備'],
    ['school', '查校園公告，安排明天下午一小時行政會議'],
    ['platform', '查學校資訊，安排明天下午半小時維護檢查'],
  ]) assert.equal(assistantRoleTaskGuide(profile, question, now), null, question);
  assert.equal(assistantRoleTaskGuide('teacher', '查我的授課概況，安排明天下午一小時備課，發布公告', now)?.profileId,
    'teacher');
  assert.equal(assistantRoleTaskGuide('school', '查學校電話，安排明天下午一小時行政會議，核准學生資格', now)?.profileId,
    'school');
  assert.equal(assistantRoleTaskGuide('teacher', '查我的授課概況，安排明天下午一小時備課', now, false)?.profileId,
    'teacher', 'A work session never manufactures a disconnected role source');
});


test('a recognized work session for another role keeps guidance without changing the selected context', () => {
  const sessions = [
    ['teacher', '安排明天下午一小時備課'],
    ['merchant', '安排明天下午半小時盤點'],
    ['club', '安排明天下午一小時社團籌備'],
    ['school', '安排明天下午一小時行政會議'],
    ['platform', '安排明天下午半小時維護檢查'],
  ];
  for (const [taskRole, question] of sessions) {
    for (const [profile] of sessions) {
      if (taskRole === profile) continue;
      for (const request of [question, '查學校電話，' + question,
        ...(profile === 'teacher' ? ['查我的授課概況，' + question] : [])]) {
        assert.equal(assistantRoleTaskGuide(profile, request, now)?.profileId, profile, `${profile}: ${request}`);
      }
    }
    assert.equal(assistantRoleTaskGuide('student', question, now), null,
      'The personal context may plan named work without accessing professional sources');
  }
});


test('work sessions compose with the same whole public reads as standalone questions', () => {
  for (const question of [
    '幫我安排明天下午一小時備課，查公車',
    '幫我找明天下午一小時空檔備課，查公車',
  ]) assert.equal(assistantRoleTaskGuide('teacher', question, now), null, question);
  for (const [profile, session] of [
    ['teacher', '安排明天下午一小時備課'],
    ['merchant', '安排明天下午半小時盤點'],
    ['club', '安排明天下午一小時社團籌備'],
    ['school', '安排明天下午一小時行政會議'],
    ['platform', '安排明天下午半小時維護檢查'],
  ]) {
    for (const read of ['查公車', '查看地圖', '查圖書館']) {
      assert.equal(assistantRoleTaskGuide(profile, session + '，' + read, now), null, `${profile}: ${read}`);
      assert.equal(assistantRoleTaskGuide(profile, session + '，' + read + '，發布公告', now)?.profileId, profile,
        'An independent public read cannot consume an unsupported write');
    }
  }
  for (const read of ['查公車只看昨天', '查看別人的圖書館借閱紀錄', '查圖書館並幫我借書']) {
    assert.equal(assistantRoleTaskGuide('teacher', '安排明天下午一小時備課，' + read, now)?.profileId, 'teacher', read);
  }
});


test('an explicit work-session window cannot bypass its role through the calendar parser', () => {
  for (const [profile, question] of [
    ['teacher', '安排明天13:00到18:00半小時盤點'],
    ['merchant', '安排明天13:00到18:00一小時備課'],
  ]) assert.equal(assistantRoleTaskGuide(profile, question, now)?.profileId, profile, question);
  assert.equal(assistantRoleTaskGuide('teacher', '幫我新增行程明天15:00到16:00盤點', now), null,
    'A directly specified personal appointment retains its exact user-supplied title');
});


test('every role retains fully parsed places and next-class classroom dependencies', () => {
  for (const profile of ['teacher', 'merchant', 'club', 'school', 'platform']) {
    for (const question of ['任垣樓在哪裡', '學生活動中心在哪裡', '行政辦公室在哪裡', '資管系辦在哪裡',
      '下一堂課教室在哪裡', '明天下一堂課教室在哪裡', '查下一堂課，教室在哪裡',
      '查下一堂課然後查教室的位置', '下一堂課在哪，幾點', '查下一堂課，教室在哪裡，查學校電話']) {
      assert.equal(assistantRoleTaskGuide(profile, question, now), null, `${profile}: ${question}`);
    }
    for (const question of ['下一堂課教室在哪裡，幫我批改作業', '下一堂課教室在哪裡，查我的待繳作業',
      '查下一堂課，查公車，教室在哪裡', '不要查下一堂課教室在哪裡', '翻譯「下一堂課教室在哪裡」']) {
      assert.equal(assistantRoleTaskGuide(profile, question, now)?.profileId, profile, `${profile}: ${question}`);
    }
  }
});


test('the task graph sequence prefix cannot hide a mismatched work session from role guidance', () => {
  for (const [profile, otherSession, ownSession] of [
    ['teacher', '先幫我安排明天下午半小時盤點', '先幫我安排明天下午一小時備課'],
    ['merchant', '先幫我找明天下午一小時備課空檔', '先幫我安排明天下午半小時盤點'],
  ]) {
    for (const question of [otherSession, '查學校電話，' + otherSession]) {
      assert.equal(assistantRoleTaskGuide(profile, question, now)?.profileId, profile, question);
    }
    assert.equal(assistantRoleTaskGuide(profile, ownSession, now), null, ownSession);
    assert.equal(assistantRoleTaskGuide(profile, ownSession + '，查公車', now), null, ownSession);
  }
});


test('an event location reference keeps the preceding explicit event source in every role', () => {
  for (const profile of ['teacher', 'merchant', 'club', 'school', 'platform']) {
    assert.equal(assistantRoleTaskGuide(profile, '查學校活動，查第一筆活動位置', now), null, profile);
    assert.equal(assistantRoleTaskGuide(profile, '查學校活動，查學校電話，查第一筆活動位置', now), null, profile);
  }
  for (const question of ['查學校公告，查第一筆活動位置', '查學校活動，查第六筆活動位置',
    '不要查學校活動，查第一筆活動位置']) {
    assert.equal(assistantRoleTaskGuide('school', question, now)?.profileId, 'school', question);
  }
});
