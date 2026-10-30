const { parsePuCreditOverview } = require('./puCreditOverview');

// Synthetic values using labels in PU's public credit-review manual, not a student record.
const entries = [
  ['必修', '71.5學分'], ['選修', '18學分'], ['外系選修', '5.5學分'],
  ['通識-六大學群', '0學分'], ['通識-四大向度', '14學分'],
  ['小計(成績及格取得之學分，不等於畢業學分)', '109'],
  ['畢業應修總學分', '128'], ['輔雙', '6學分'],
];
const values = { required: 71.5, elective: 18, externalElective: 5.5, generalOld: 0,
  generalNew: 14, subtotal: 109, totalRequired: 128, minorDouble: 6 };
const fieldNames = Object.keys(values);
const text = rows => rows.map(([label, value]) => `【${label}】：${value}`).join(' ');
const table = (rows = entries, suffix = '') => `<table><tr><th>修習學分累計</th></tr>
  <tr><td>${text(rows)}</td></tr>${suffix}</table>`;

describe('school-reported credit overview recognition', () => {
  test('preserves each reported value without summing or deciding graduation', () => {
    expect(parsePuCreditOverview(table())).toEqual({
      success: true,
      creditOverview: {
        version: 1, source: 'pu-credit-review', totals: values,
        coverage: { status: 'complete', missingFields: [] },
      },
    });
  });

  test('ignores earlier semester figures and stops at a following table section', () => {
    const html = `<table><tr><th>本學期學分總計</th></tr><tr><td>${text(entries.map(([label]) => [label, '999']))}</td></tr>
      <tr><th>修習學分累計</th></tr><tr><td>${text(entries)}</td></tr>
      <tr><th>畢業條件</th></tr><tr><td>${text(entries.map(([label]) => [label, '700']))}</td></tr></table>`;
    expect(parsePuCreditOverview(html).creditOverview.totals).toEqual(values);
  });

  test('uses the inner result table instead of surrounding layout cells', () => {
    const html = `<table><tr><td>${text([['必修', '999']])}</td></tr><tr><td>${table()}</td></tr></table>`;
    expect(parsePuCreditOverview(html).creditOverview.totals).toEqual(values);
  });

  test('recognizes inline formatting, decoded entities and separated label/value cells', () => {
    const html = `<section><h2>修習<span>學分</span>累計：</h2><table>
      <tr><th>&#12304;必<span>修</span>&#12305;：</th><td>&nbsp;<b>0.5</b>學分</td></tr>
      <tr><th>【畢業應修總學分】</th><td>128</td></tr></table></section>`;
    expect(parsePuCreditOverview(html)).toMatchObject({ success: true, creditOverview: {
      totals: { required: 0.5, totalRequired: 128, elective: null, subtotal: null },
      coverage: { status: 'partial', missingFields: ['elective', 'externalElective', 'generalOld', 'generalNew', 'subtotal', 'minorDouble'] },
    } });
  });

  test('joins adjacent inline fragments under one heading', () => {
    const html = '<div><h2>修習學分累計</h2><span>【必修】：</span><b>0.5</b>學分 <span>【選修】：</span><b>2</b>學分<h2>其他</h2><p>【必修】：900</p></div>';
    expect(parsePuCreditOverview(html)).toMatchObject({ success: true, creditOverview: { totals: { required: 0.5, elective: 2 } } });
  });

  test('reads separate consecutive result rows without taking later unrelated text', () => {
    const html = '<table><tr><td>修習學分累計</td></tr><tr><td>【必修】：30</td></tr><tr><td>【選修】：10</td></tr><tr><td>其他注意事項</td></tr><tr><td>【畢業應修總學分】：999</td></tr></table>';
    expect(parsePuCreditOverview(html)).toMatchObject({ success: true, creditOverview: {
      totals: { required: 30, elective: 10, totalRequired: null }, coverage: { status: 'partial' },
    } });
  });

  test('stops at a nested section instead of borrowing its missing cumulative fields', () => {
    const html = '<section><h2>修習學分累計</h2><div><p>【必修】：30</p><h3>其他統計</h3><p>【選修】：999</p></div><p>【畢業應修總學分】：999</p></section>';
    expect(parsePuCreditOverview(html)).toMatchObject({ success: true, creditOverview: {
      totals: { required: 30, elective: null, totalRequired: null },
    } });
  });

  test('does not substitute a nested current-semester table for the cumulative result', () => {
    const html = '<table><tr><td>修習學分累計</td></tr><tr><td><table><tr><td>本學期修習學分：</td></tr><tr><td>【必修】：18</td></tr></table></td></tr></table>';
    expect(parsePuCreditOverview(html)).toMatchObject({ success: false, code: 'unavailable', creditOverview: null });
  });

  test('keeps genuine zeros and does not infer a missing total', () => {
    const result = parsePuCreditOverview(table(entries.filter(([label]) => label !== '畢業應修總學分').map(([label]) => [label, '0學分'])));
    expect(result.creditOverview.totals).toEqual({ ...Object.fromEntries(fieldNames.map(key => [key, 0])), totalRequired: null });
    expect(result.creditOverview.coverage).toEqual({ status: 'partial', missingFields: ['totalRequired'] });
  });

  test('allows a plain subtotal label and a nonnumeric detail-link annotation', () => {
    const result = parsePuCreditOverview(table([['小計', '20.75學分'], ['外系選修', '4學分(外系選修明細)'], ['輔雙', '0學分(非輔雙指定課程：0學分)']]));
    expect(result.creditOverview.totals).toMatchObject({ subtotal: 20.75, externalElective: 4, minorDouble: 0 });
  });

  test.each(['', '尚未提供', '-1', '+3', '1e2', 'Infinity', 'NaN', '1000.1', '1,000', '3/6', '3 5', '2學分或3學分', '3\n5'])('does not coerce malformed value %j into credits', value => {
    const result = parsePuCreditOverview(table([['必修', value], ['選修', '0.5']]));
    expect(result.creditOverview.totals).toMatchObject({ required: null, elective: 0.5 });
    expect(result.creditOverview.coverage.missingFields).toContain('required');
  });

  test('accepts the finite numeric boundary without treating it as a degree requirement', () => {
    expect(parsePuCreditOverview(table([['必修', '1000']])).creditOverview.totals.required).toBe(1000);
  });

  test('does not match similar labels or a different subtotal qualifier', () => {
    const result = parsePuCreditOverview(table([['必修', '2'], ['選修合計', '4'], ['小計(已通過畢業審核)', '120']]));
    expect(result.creditOverview.totals).toMatchObject({ required: 2, elective: null, subtotal: null });
  });

  test.each([
    ['different numbers', [['必修', '1'], ['必修', '2']]],
    ['missing and numeric', [['必修', ''], ['必修', '2']]],
  ])('rejects conflicting repeated labels: %s', (_name, rows) => {
    expect(parsePuCreditOverview(table(rows))).toMatchObject({ success: false, code: 'unavailable', creditOverview: null });
  });

  test('accepts an identical repeated value without double-counting it', () => {
    expect(parsePuCreditOverview(table([['必修', '2'], ['必修', '2.0']])).creditOverview.totals.required).toBe(2);
  });

  test.each([
    ['no cumulative heading', `<div>${text(entries)}</div>`],
    ['heading without results', '<h2>修習學分累計</h2>'],
    ['all missing fields', table(entries.map(([label]) => [label, '尚未提供']))],
    ['repeated visible cumulative sections', table() + table()],
    ['heading appears inside a sentence', `<h2>請查看修習學分累計</h2><p>${text(entries)}</p>`],
    ['hidden heading', `<h2 hidden>修習學分累計</h2><p>${text(entries)}</p>`],
    ['template only', `<template>${table()}</template>`],
    ['script only', `<script>var contents=${JSON.stringify(table())};</script>`],
    ['maintenance page with stale table', '<h1>系統維護中</h1>' + table()],
  ])('does not claim successful data for %s', (_name, html) => {
    expect(parsePuCreditOverview(html)).toMatchObject({ success: false, code: 'unavailable', creditOverview: null });
  });

  test.each([
    '<input type="password" name="upassword">',
    '<form action="/index_check.php"><input name="uid"></form>',
    '<p>請重新登入</p>',
  ])('recognizes an expired session even alongside stale result markup', login => {
    expect(parsePuCreditOverview(login + table())).toMatchObject({ success: false, code: 'session-expired', creditOverview: null });
  });

  test('excludes hidden controls, scripts and styles from result values', () => {
    const html = `<div hidden>${table([['必修', '900']])}</div><table><tr><th>修習學分累計</th></tr><tr><td>
      <span aria-hidden="true">【必修】：999</span><span style="display: /* hidden */ none !important">【必修】：888</span>
      <span style="visibility: hidden">【必修】：777</span><script>"【必修】：666"</script><style>.x{content:"【必修】：555"}</style>
      <template>【必修】：444</template><input value="【必修】：333"><select><option>【必修】：222</option></select>
      【必修】：<span hidden>999</span>2.5學分
    </td></tr></table>`;
    expect(parsePuCreditOverview(html).creditOverview.totals.required).toBe(2.5);
  });

  test('does not publish raw text, identifiers or cookie-like data from the page', () => {
    const result = parsePuCreditOverview('<p>姓名：測試者 學號：412345678 SID=fixture-secret</p>' + table());
    expect(JSON.stringify(result)).not.toMatch(/412345678|測試者|fixture-secret|Cookie|html|studentId/);
    expect(Object.keys(result.creditOverview)).toEqual(['version', 'source', 'totals', 'coverage']);
  });

  test('bounds malformed or oversized documents', () => {
    for (const input of [null, {}, '', '字'.repeat(1_500_000), '<div>'.repeat(110) + table() + '</div>'.repeat(110)]) {
      expect(parsePuCreditOverview(input)).toMatchObject({ success: false, creditOverview: null });
    }
  });
});
