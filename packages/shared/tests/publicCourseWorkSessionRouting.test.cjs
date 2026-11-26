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
const { resolvePublicCourseAssistantIntent: resolve } = require('../src/publicCourseAssistant.ts');
const { publicCourseCompoundRequest: compound } = require('../src/publicCourseCompound.ts');
require.extensions['.ts'] = original;

test('complete personal work requests never become public catalog searches or clarification replies', () => {
  for (const school of ['pu', 'nthu', 'ncnu', undefined]) {
    for (const question of ['找明天下午一小時備課', '幫我找明天下午一小時空檔備課',
      '找明天下午備課一小時', '安排明天下午一小時備課', '找明天下午半小時批改作業',
      '找明天下午半小時盤點', '找明天下午一小時社團籌備',
      '找明天下午一小時行政會議', '找明天下午半小時維護檢查',
      '找 2030/11/5 9:00 到 12:00 備課 90 分鐘。']) {
      assert.equal(resolve(question, school), null, `${school}: ${question}`);
    }
  }
});

test('compound routing keeps personal work and an explicitly requested public course as separate clauses', () => {
  assert.equal(compound('找明天下午一小時備課，查公車', 'pu'), null);
  const result = compound('找明天下午一小時備課，查清大資料庫課程', 'pu');
  assert.deepEqual(result, { clauses: [
    { question: '找明天下午一小時備課', publicCourseIntent: null },
    { question: '查清大資料庫課程', publicCourseIntent: { kind: 'search', schoolId: 'nthu', query: '資料庫' } },
  ] });
});

test('work vocabulary inside a real course title remains a public course lookup', () => {
  for (const [question, query] of [['查清大備課課程', '備課'],
    ['查清大「安排明天下午一小時備課」課程', '安排明天下午一小時備課']]) {
    assert.deepEqual(resolve(question, 'pu'), { kind: 'search', schoolId: 'nthu', query });
  }
  assert.equal(resolve('查清大下午的資料庫課程', 'pu')?.kind, 'clarify');
});
