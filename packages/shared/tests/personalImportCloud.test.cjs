/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, Response */
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
const { isPersonalImportCloudInputMasked, isPersonalImportCloudMaskSafe, maskPersonalImportCloudBatch, maskPersonalImportText, requestPersonalImportCloud } = require('../src/imports/aiCloud.ts');
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

for (const head of ['姓\n名\n王小明', '學\n號\n123456', '姓·名：王小明', '學．號：１２３４５６',
  '姓·名\n王小明', '學．號\n123456', '姓\r\n、名：王小明', '學\t‧\n號：123456',
  '姓「」名：王小明', '學\u0001號：123456']) {
  test(`未知個資欄名拒送並保留本機：${JSON.stringify(head)}`, async () => {
    const text = `${head}\n課程名稱,學分,成績\n微積分,3,85`;
    for (const input of [{ text }, { text: '微積分,3,85', columnContext: head }]) {
      let sent = false;
      const result = await requestPersonalImportCloud({ ...input, kind: 'grades', fetcher: async () => {
        sent = true;
        throw new Error('不應送出');
      } });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'invalid-input');
      assert.equal(sent, false);
    }
  });
}
for (const text of ['課程名稱,學分,成績\n微積分,3,85', '星期一 第三節 程式設計 教室 A101']) {
  test(`正常學業文字仍可送出：${text}`, async () => {
    let sent;
    const result = await requestPersonalImportCloud({ text, kind: 'grades', fetcher: async (_, options) => {
      sent = JSON.parse(options.body);
      return Response.json({ output: '{}', sourceText: sent.text, columnContext: sent.columnContext });
    } });
    assert.equal(result.ok, true);
    assert.equal(sent.text, text);
  });
}

for (const head of ['姓\ufe0f名：王小明', '姓\u034f名,課程名稱,學分,成績\n王小明,微積分,3,85',
  '課程名稱,學分,成績\n姓·名王小明,3,85', '課程名稱,學分,成績\n123456,3,85', '教\u034f師：陳大文', '學\ufe0f號：A12345',
  '姓\u20dd名：王小明', '課程名\u034f稱,學分,成績', '姓\u200b名：王小明', '學\u200b號：123456', '教\u200b師：陳大文',
  '姓\u00ad名：王小明', '學+號：123456', '教⋅師：陳大文',
  '姓\u2060名：王小明', '教🟢師：陳大文', '編碼,123456', '編碼,１２３４５６７', '編碼,A12345678901234',
  '教師陳大文,3,85', '教師\u2028陳大文,3,85', '教師\u0001陳大文,3,85',
  'teacher陳大文,3,85', '老師陳大文,3,85', '教授陳大文,3,85', 'instructor陳大文,3,85',
  '課程名稱,學分,成績\n教師陳大文,3,85',
  '課程名稱,學分,成績\nTeacher Education,3,85', '課程名稱,學分,成績\n教師 專業發展,2,90',
  '教師專業發展,2,90']) {
  test(`格式符號或疑似學號在批次與實際請求均拒送：${head}`, async () => {
    const text = `${head}\n課程名稱,學分,成績\n微積分,3,85`;
    assert.equal(isPersonalImportCloudMaskSafe(text), false);
    assert.equal(maskPersonalImportCloudBatch(text, { text, startLine: 1 }), null);
    assert.equal(maskPersonalImportCloudBatch(text, { text: '微積分,3,85', startLine: 3 }), null);
    for (const input of [{ text }, { text: '微積分,3,85', columnContext: head }]) {
      const bodies = [];
      const result = await requestPersonalImportCloud({ ...input, kind: 'grades', fetcher: async (_, init) => {
        bodies.push(init.body);
        return { ok: false, status: 503 };
      } });
      assert.equal(result.reason, 'invalid-input');
      assert.deepEqual(bodies, []);
      assert.equal(/王小明|A12345|123456|陳大文/.test(bodies.join('')), false);
    }
  });
}

for (const text of [
  '課程代碼,課程名稱,學分,成績\n123456,微積分,3,85',
  '日期,課程名稱,教室\n20261031,程式設計,A101',
  '課程代碼,123456\n課程名稱,學分,成績\n微積分,3,85',
  '日期,20261031\n課程名稱,學分,成績\n微積分,3,85',
  'Smartphone Application Development,3,85\n課程名稱,學分,成績\n微積分,3,85',
]) {
  test(`明確學業資料可送出且仍遮罩個資：${text}`, async () => {
    const source = `姓名：王小明\n${text}`;
    assert.equal(isPersonalImportCloudMaskSafe(source), true);
    const batch = maskPersonalImportCloudBatch(source, { text: source, startLine: 1 });
    assert.ok(batch);
    assert.equal(batch.sourceText.includes('王小明'), false);
    for (const value of ['123456', '20261031', '教師專業發展', 'Smartphone Application Development']) {
      if (text.includes(value)) assert.ok(batch.sourceText.includes(value));
    }
    const bodies = [];
    await requestPersonalImportCloud({ text: source, kind: 'grades', fetcher: async (_, init) => {
      bodies.push(init.body);
      return { ok: false, status: 503 };
    } });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].includes('王小明'), false);
    for (const value of ['123456', '20261031', '教師專業發展', 'Smartphone Application Development']) {
      if (text.includes(value)) assert.ok(bodies[0].includes(value));
    }
  });
}

test('批次欄位上下文有組合字元時整份留在本機', () => {
  const text = '微積分,3,85';
  assert.equal(maskPersonalImportCloudBatch(text, { text, startLine: 1, columnContext: '學\ufe0f號：A12345' }), null);
});

test('簡體學號也遮罩批次與實際送出本文', async () => {
  const text = '学号：A12345\n課程名稱,學分,成績\n微積分,3,85';
  const batch = maskPersonalImportCloudBatch(text, { text, startLine: 1 });
  assert.ok(batch);
  assert.equal(batch.sourceText.includes('A12345'), false);
  const bodies = [];
  await requestPersonalImportCloud({ text, kind: 'grades', fetcher: async (_, init) => {
    bodies.push(init.body);
    return { ok: false, status: 503 };
  } });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].includes('A12345'), false);
});

for (const delimiter of [',', '\t', '|', ';', '、']) {
  for (const source of [
    '姓名,課程名稱,學分,成績\n王小明,日期,3,成績',
    '課程名稱,姓名,班級,教室,學分,成績\n微積分,王小明,班級,教室,3,85',
    '課程名稱,學號,班級,教室,學分,成績\n微積分,A12345,班級,教室,3,85',
  ]) {
    const text = source.replaceAll(',', delimiter);
    test(`資料值撞到欄名仍遮罩私密欄：${JSON.stringify(text)}`, async () => {
      assert.equal(isPersonalImportCloudMaskSafe(text), true);
      const batch = maskPersonalImportCloudBatch(text, { text, startLine: 1 });
      assert.ok(batch);
      assert.doesNotMatch(batch.sourceText, /王小明|A12345/u);
      assert.equal(maskPersonalImportText(batch.sourceText), batch.sourceText);
      const [header, row] = text.split('\n');
      for (const input of [{ text }, { text: row, columnContext: header },
        { text: '課程名稱,學分,成績\n微積分,3,85'.replaceAll(',', delimiter), columnContext: text }]) {
        let sent;
        const result = await requestPersonalImportCloud({ ...input, kind: 'grades', fetcher: async (_, init) => {
          sent = JSON.parse(init.body);
          return Response.json({ output: '{}', sourceText: sent.text, columnContext: sent.columnContext });
        } });
        assert.equal(result.ok, true);
        assert.doesNotMatch(JSON.stringify(sent), /王小明|A12345/u);
        assert.match(JSON.stringify(sent), /個資已遮罩/u);
      }
    });
  }
}

for (const delimiter of [',', '\t', '|', ';', '、']) {
  for (const boundary of ['日期', '【第二頁】']) {
    for (const template of ['姓名,課程名稱,學分,成績\nBOUNDARY\n王小明,微積分,3,85',
    '課程名稱,學號,學分,成績\nBOUNDARY\n微積分,A12345,3,85']) {
      const source = template.replace('BOUNDARY', boundary).replaceAll(',', delimiter);
      test(`單格插入不解除私密追蹤：${JSON.stringify(source)}`, async () => {
        assert.equal(isPersonalImportCloudMaskSafe(source), false);
        assert.equal(isPersonalImportCloudInputMasked(source), false);
        assert.equal(maskPersonalImportCloudBatch(source, { text: source, startLine: 1 }), null);
        for (const input of [{ text: source }, { text: '英文,2,80', columnContext: source }]) {
          let calls = 0;
          const result = await requestPersonalImportCloud({ ...input, kind: 'grades', fetcher: async () => { calls++; } });
          assert.equal(result.ok, false);
          assert.equal(calls, 0);
        }
      });
    }
  }
}

test('遮罩完成檢查會拒絕仍含原值的私密欄', () => {
  const source = '姓名,課程名稱,學分,成績\n王小明,微積分,3,85';
  assert.equal(isPersonalImportCloudInputMasked(source), false);
  assert.equal(isPersonalImportCloudInputMasked(maskPersonalImportText(source)), true);
});
