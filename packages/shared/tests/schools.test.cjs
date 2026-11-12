/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, structuredClone, URL */
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
const { searchSchools } = require('../src/schools.ts');
const { resolveSchoolPublicServices } = require('../src/schoolPublicServices.ts');
const { resolveOfficialCourseQueryLink, hasIntegratedCourseCatalog } = require('../src/courseCatalogCapability.ts');
require.extensions['.ts'] = original;
const schools = [
  { id: 'pu', name: '靜宜大學', shortName: '靜宜', code: 'PU' },
  { id: 'ntu', name: '國立臺灣大學', shortName: '臺大', code: 'NTU' },
  { id: 'ntust', name: '國立臺灣科技大學', shortName: '臺科大', code: 'NTUST' },
  { id: 'empty', name: '測試學院' },
  { id: 'nccu', name: '國立政治大學', shortName: '政大' },
];


const cases = [
  ['台灣', ['ntu', 'ntust']], ['臺大', ['ntu']], ['台大', ['ntu']],
  ['ＰＵ', ['pu']], ['PU', ['pu']], ['p u', ['pu']], ['NcCu', ['nccu']],
  ['政大', ['nccu']], ['國立政治大學', ['nccu']], ['政治', ['nccu']],
  ['靜 宜', ['pu']], [' pu ', ['pu']], ['靜宜 pu', ['pu']],
  ['臺灣 科技', ['ntust']], ['臺灣　科技', ['ntust']],
  ['靜宜 NTU', []], ['missing', []],
  ['', schools.map(s => s.id)], ['\t 　', schools.map(s => s.id)],
];
for (const [query, expected] of cases) {
  test(`搜尋 ${JSON.stringify(query)}`, () => {
    assert.deepEqual(searchSchools(query, schools).map(s => s.id), expected);
  });
}
test('完全相符與部分相符各組保留來源順序且不修改資料', () => {
  const directory = Object.freeze([
    Object.freeze({ id: 'puli', name: '埔里學院', code: 'PULI' }),
    Object.freeze({ id: 'pu', name: '靜宜大學', status: 'not-open' }),
    Object.freeze({ id: 'other', name: '其他學院', code: 'PU' }),
    Object.freeze({ id: 'pux', name: '其他分校' }),
  ]);
  assert.deepEqual(searchSchools(' Ｐ Ｕ ', directory), [directory[1], directory[2], directory[0], directory[3]]);
  assert.equal(searchSchools('PU', directory)[0], directory[1]);
  for (const query of ['', '　', null, undefined]) assert.deepEqual(searchSchools(query, directory), directory);
});
test('保留別名、網域與預設名錄搜尋', () => {
  const directory = [{ id: 'x', name: '測試學院', aliases: ['別名'], domains: ['EXAMPLE.edu.tw'] }];
  assert.deepEqual(searchSchools('別 名', directory), directory);
  assert.deepEqual(searchSchools('example.EDU', directory), directory);
  assert.ok(searchSchools('NTU').some(s => s.id === 'ntu'));
});


test('所選校的課程、住宿、諮商、職涯入口皆屬於同一校', () => {
  for (const id of ['nchu', 'yuntech', 'nkust', 'fcu']) {
    const { services, schoolId } = resolveSchoolPublicServices(id);
    assert.equal(schoolId, id);
    for (const kind of ['courses', 'dormitory', 'health', 'career']) {
      const { url } = services[kind];
      assert.equal(new URL(url).protocol, 'https:');
      assert.ok(new URL(url).hostname.endsWith(`.${id}.edu.tw`));
    }
    assert.equal(new Set(Object.values(services).map(link => link.url)).size, 4);
    assert.equal(resolveOfficialCourseQueryLink(id).url, services.courses.url);
    assert.equal(hasIntegratedCourseCatalog(id), false);
  }
  assert.equal(resolveSchoolPublicServices('tw-nchu'), resolveSchoolPublicServices('nchu'));
});

test('有校方課程查詢或說明頁時，只開放該校已核實的功能', () => {
  for (const id of ['ncnu', 'ncue', 'ncut', 'ncyu', 'ndhu', 'nfu', 'nuk', 'nuu']) {
    const { url, label } = resolveOfficialCourseQueryLink(id);
    const { protocol, hostname } = new URL(url);
    assert.equal(protocol, 'https:');
    assert.ok(hostname === `${id}.edu.tw` || hostname.endsWith(`.${id}.edu.tw`));
    assert.ok(label);
    assert.equal(hasIntegratedCourseCatalog(id), false);
  }
  for (const id of ['all', 'no-such-school', 'constructor', 'tw-nchu-unknown', null]) {
    assert.equal(resolveSchoolPublicServices(id), null);
    assert.equal(resolveOfficialCourseQueryLink(id), null);
  }
});
