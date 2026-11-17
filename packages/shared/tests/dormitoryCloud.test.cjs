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
const { dormParcelReturnNotice, DORM_PACKAGES_EMPTY } = require('../src/dormitoryCloud.ts');
require.extensions['.ts'] = original;
const arrivedAt = Date.parse('2026-11-12T10:00:00+08:00');
const parcel = { status: 'waiting', arrivedAt };
test('推算退件日前一天提醒，滿三天與四天以上不再稱明天', () => {
  assert.equal(dormParcelReturnNotice(parcel, arrivedAt + 86400000), '');
  assert.equal(dormParcelReturnNotice(parcel, arrivedAt + 2 * 86400000), '預估明天起可能退件（依到件日推算，以宿舍公告為準）');
  for (const days of [3, 4, 10])
    assert.equal(
      dormParcelReturnNotice(parcel, arrivedAt + days * 86400000),
      '已到件多日，請確認領取期限',
    );
  assert.equal(
    dormParcelReturnNotice({ ...parcel, status: 'picked_up' }, arrivedAt + 4 * 86400000),
    '',
  );
  assert.equal(dormParcelReturnNotice({ ...parcel, arrivedAt: null }), '');
});
test('台灣午夜跨入推算日期後，使用保守領取期限提示', () => {
  assert.equal(
    dormParcelReturnNotice(parcel, Date.parse('2026-11-14T23:59:59+08:00')),
    '預估明天起可能退件（依到件日推算，以宿舍公告為準）',
  );
  assert.equal(
    dormParcelReturnNotice(parcel, Date.parse('2026-11-15T00:00:00+08:00')),
    '已到件多日，請確認領取期限',
  );
});

test('包裹空白狀態只描述個人紀錄', () => {
  assert.equal(DORM_PACKAGES_EMPTY, '目前沒有登錄給你的包裹。');
});
