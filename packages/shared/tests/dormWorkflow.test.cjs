/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(source, filename);
};
const { formatDormWorkflowTime } = require('../src/dormWorkflow.ts');
require.extensions['.ts'] = original;

test('宿舍歷程固定顯示台灣日期與 24 小時制時間', () => {
  assert.equal(
    formatDormWorkflowTime(Date.parse('2026-11-17T15:04:05+08:00')).replace(/\s/g, ' '),
    '2026/11/17 15:04:05',
  );
  assert.equal(
    formatDormWorkflowTime(Date.parse('2026-11-17T17:04:05Z')).replace(/\s/g, ' '),
    '2026/11/18 01:04:05',
  );
});
