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
const { isPersonalImportCloudMaskSafe, maskPersonalImportCloudBatch, maskPersonalImportText } = require('../src/imports/aiCloud.ts');
require.extensions['.ts'] = original;


for (const delimiter of [';', '；', '，', '、', '|']) {
  for (const label of ['姓名', '教師', '學生', '學號']) {
    test(`遮罩 ${delimiter} 分欄的 ${label} 並保留課程資料`, () => {
      const source = `${label}${delimiter}課程名稱${delimiter}學分${delimiter}成績\n王小明${delimiter}微積分${delimiter}3${delimiter}85`;
      assert.equal(isPersonalImportCloudMaskSafe(source), true);
      const masked = maskPersonalImportText(source);
      assert.equal(masked.includes('王小明'), false);
      assert.equal(masked.includes('微積分'), true);
      assert.equal(maskPersonalImportText(masked), masked);
    });
    test(`拒絕 ${delimiter} 分欄且欄數不一致的 ${label}`, () => {
      const source = `${label}${delimiter}課程名稱${delimiter}學分${delimiter}成績\n王小明${delimiter}微積分${delimiter}3`;
      assert.equal(isPersonalImportCloudMaskSafe(source), false);
      assert.equal(maskPersonalImportCloudBatch(source, { text: source, startLine: 1 }), null);
    });
  }
}
for (const delimiter of ['/', '::', '•', '：']) {
  test(`拒絕無法可靠解析的 ${delimiter} 分欄個資`, () => {
    for (const label of ['姓名', '教師', '學生', '學號']) {
      const source = `${label}${delimiter}課程名稱${delimiter}學分${delimiter}成績\n王小明${delimiter}微積分${delimiter}3${delimiter}85`;
      assert.equal(isPersonalImportCloudMaskSafe(source), false);
    }
  });
}
test('分號表格的引號內分隔符與換行仍完整遮罩', () => {
  const source = '教師;課程名稱;學分\n"王;小\n明";微積分;3';
  assert.equal(isPersonalImportCloudMaskSafe(source), true);
  assert.equal(maskPersonalImportText(source), '教師;課程名稱;學分\n"[個資已遮罩]\n";微積分;3');
});
