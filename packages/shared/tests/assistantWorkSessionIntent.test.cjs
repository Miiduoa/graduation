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
const { parseAssistantWorkSessionIntent: parse } = require('../src/assistantWorkSessionIntent.ts');
require.extensions['.ts'] = original;
const now = Date.parse('2026-11-04T10:30:00+08:00');

test('all work contexts retain their exact personal task, day, window and duration', () => {
  for (const [profileId, title] of [['teacher', '備課'], ['teacher', '批改作業'], ['merchant', '盤點'],
    ['merchant', '備料'], ['club', '社團籌備'], ['school', '行政會議'], ['platform', '維護檢查'], ['platform', '平台維護']]) {
    assert.deepEqual(parse(`請幫我安排明天下午一小時${title}`, now), {
      profileId, mode: 'prepare', title, date: '2026-11-05', from: '13:00', to: '18:00', minutes: 60,
    });
  }
});

test('find requests are read-only and preserve explicit alternate word orders', () => {
  for (const question of ['找明天下午一小時備課空檔', '幫我找明天下午一小時空檔備課',
    '找明天下午備課一小時', '找明天下午一小時的備課時間']) {
    assert.deepEqual(parse(question, now), { profileId: 'teacher', mode: 'find', title: '備課',
      date: '2026-11-05', from: '13:00', to: '18:00', minutes: 60 });
  }
  assert.deepEqual(parse('安排 2026/11/5 9:00 到 12:00 批改 90 分鐘。', now), {
    profileId: 'teacher', mode: 'prepare', title: '批改', date: '2026-11-05', from: '09:00', to: '12:00', minutes: 90,
  });
  assert.equal(parse('規劃後天晚上半小時備料', now).minutes, 30);
  assert.equal(parse('安排明天下午兩小時社團籌備', now).minutes, 120);
});

test('Taipei date rollover is stable and already elapsed windows remain explicit for the executor to block', () => {
  assert.equal(parse('安排今天上午一小時備課', Date.parse('2026-12-31T17:30:00Z')).date, '2027-01-01');
  assert.equal(parse('安排明天上午一小時備課', Date.parse('2026-12-31T17:30:00Z')).date, '2027-01-02');
  assert.equal(parse('安排2026-10-31下午一小時備課', now).date, '2026-10-31');
});

test('missing, ambiguous, contradictory and compound instructions never become work events', () => {
  for (const question of [
    '安排明天備課', '安排明天下午備課', '安排下午一小時備課', '安排一小時備課',
    '安排明天上午下午一小時備課', '安排明天下午一小時兩小時備課', '安排明天下午一小時備課盤點',
    '安排明天下午一小時備課，查公車', '安排明天下午一小時備課並通知學生',
    '安排明天下午一小時備課並且發布成績', '不要安排明天下午一小時備課',
    '如果安排明天下午一小時備課', '翻譯安排明天下午一小時備課', '「安排明天下午一小時備課」',
    '每天安排明天下午一小時備課', '安排明天下午一小時匯款', '安排明天下午一小時退款',
    '安排明天下午一小時修改權限', '安排明天下午一小時批改學生甲',
    '安排明天25:00到26:00半小時備課', '安排明天16:00到15:00半小時備課',
    '安排明天15:00到15:30一小時備課', '安排明天下午14分鐘備課', '安排明天下午181分鐘備課',
    '安排2026-02-30下午一小時備課', '安排明天下午一小時備課\n',
    '安排明天下午一小時備課\u200b', '安排明天下午一小時備課\u2028', '', {}, null,
  ]) assert.equal(parse(question, now), null, String(question));
  assert.equal(parse('安排明天下午一小時備課', Infinity), null);
  assert.equal(parse('安排明天下午一小時備課', 1e30), null);
});
