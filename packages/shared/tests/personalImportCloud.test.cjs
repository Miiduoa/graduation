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
const { isPersonalImportCloudMaskSafe, maskPersonalImportCloudBatch, maskPersonalImportText, requestPersonalImportCloud } = require('../src/imports/aiCloud.ts');
const { PERSONAL_IMPORT_NAME_FIELDS } = require('../src/imports/nameFields.ts');
const { personalImportHeaderField } = require('../src/imports/parser.ts');
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

for (const label of ['教師：王小明', '姓名：王小明', 'teacher: Wang']) {
  test(`遮罩 ${label} 的續行並保留學業邊界後的課程`, () => {
    for (const boundary of ['課程名稱,學分,成績\n微積分,3,85', '微積分 3 85\n英文 2 80', '微積分,3,85\n英文,2,80']) {
      const source = `${label}\n\n李小華\n陳小美\n${boundary}`;
      assert.equal(isPersonalImportCloudMaskSafe(source), true);
      const masked = maskPersonalImportText(source);
      assert.equal(/王小明|Wang|李小華|陳小美/u.test(masked), false);
      assert.equal(masked.endsWith(boundary), true);
      assert.equal(masked.split('\n').length, source.split('\n').length);
      assert.equal(maskPersonalImportText(masked), masked);
      assert.equal(maskPersonalImportCloudBatch(source, { text: '李小華\n', startLine: 3 }).sourceText, '[個資已遮罩]\n');
    }
  });
}
for (const continuation of ['李小華／陳小美', '李小華,陳小美', '李小華\t陳小美']) {
  test(`拒絕無可靠欄界的行內個資續行 ${continuation}`, () => {
    assert.equal(isPersonalImportCloudMaskSafe(`教師：王小明\n${continuation}\n課程名稱,學分,成績\n微積分,3,85`), false);
  });
}

for (const label of PERSONAL_IMPORT_NAME_FIELDS) {
  test(`共用姓名欄名 ${label} 的請求本文不含姓名`, async () => {
    const source = `課程名稱,${label},學分,成績\n微積分,王小明,3,85`;
    let called = false;
    await requestPersonalImportCloud({
      text: source, kind: 'grades',
      fetcher: async (_url, init) => {
        called = true;
        assert.equal(init.body.includes('王小明'), false);
        return { ok: false, status: 503 };
      },
    });
    assert.equal(called, true);
    assert.equal(maskPersonalImportText(`${label}: 王小明`).includes('王小明'), false);
    if (!['學生姓名', '姓名', '學生', 'studentname', 'name'].includes(label))
      assert.equal(personalImportHeaderField(label), 'teacher');
  });
}
for (const label of ['任課教師姓名', 'instructor contact', '家長姓名']) {
  test(`未知個資欄 ${label} 留在本機`, async () => {
    const source = `課程名稱,${label},學分,成績\n微積分,王小明,3,85`;
    assert.equal(isPersonalImportCloudMaskSafe(source), false);
    const result = await requestPersonalImportCloud({
      text: source, kind: 'grades', fetcher: async () => { throw new Error('不應送出'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-input');
  });
}

for (const [label, secret] of [
  ['student_id', 'S123456'], ['學 號', '123456'], ['學生名字', '王小明'],
  ['ＳＴＵＤＥＮＴ＿ＩＤ', 'S123456'], ['student-number', '123456'],
  ['學_生_名_字', '王小明'], ['學 生 學 號', '123456'],
]) {
  for (const delimiter of [',', '\t', ';', '；', '，', '|', '、']) {
    test(`個資欄變體 ${label} / ${JSON.stringify(delimiter)} 不洩漏請求本文`, async () => {
      const header = `${label}${delimiter}課程名稱${delimiter}學分${delimiter}成績`;
      const row = `${secret}${delimiter}微積分${delimiter}3${delimiter}85`;
      for (const input of [{ text: `${header}\n${row}` }, { text: row, columnContext: header }]) {
        let called = false;
        const result = await requestPersonalImportCloud({ ...input, kind: 'grades', fetcher: async (_url, init) => {
          called = true;
          assert.equal(init.body.includes(secret), false);
          assert.equal(init.body.includes('微積分'), true);
          return { ok: false, status: 503 };
        } });
        if (!called) assert.equal(result.reason, 'invalid-input');
      }
      const source = `${header}\n${row}`;
      const batch = maskPersonalImportCloudBatch(source, { text: `${row}`, startLine: 2, columnContext: header });
      if (batch) assert.equal(JSON.stringify(batch).includes(secret), false);
    });
  }
  for (const source of [`${label}: ${secret}\n微積分,3,85`, `${label}\n${secret}\n微積分,3,85`]) {
    test(`行內或直排 ${JSON.stringify(source)} 不洩漏`, async () => {
      await requestPersonalImportCloud({ text: source, kind: 'grades', fetcher: async (_url, init) => {
        assert.equal(init.body.includes(secret), false);
        return { ok: false, status: 503 };
      } });
    });
  }
}
for (const label of ['學生識別碼', 'student_identifier', '學生暱稱', '家長名字', '學 號 備 註', 'student/id']) {
  test(`不明個資欄 ${label} 完全不呼叫雲端`, async () => {
    let calls = 0;
    const result = await requestPersonalImportCloud({
      text: `${label},課程名稱,學分,成績\n王小明,微積分,3,85`, kind: 'grades',
      fetcher: async () => { calls++; return { ok: false, status: 503 }; },
    });
    assert.equal(calls, 0);
    assert.equal(result.reason, 'invalid-input');
  });
}

test('混合姓名與學號標籤無法確定欄界時保留本機', async () => {
  let calls = 0;
  const result = await requestPersonalImportCloud({
    text: '姓名：王小明 學號：s12345678\n身分證：A123456789\n資料庫,3,85', kind: 'grades',
    fetcher: async () => { calls++; return { ok: false, status: 503 }; },
  });
  assert.equal(calls, 0);
  assert.equal(result.reason, 'invalid-input');
});
