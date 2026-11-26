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
const { searchSchools, matchingSchoolEnglishName } = require('../src/schools.ts');
const { schoolEnglishNames } = require('../src/schoolEnglishNames.ts');
const { publicSchoolInfoDirectory } = require('../src/publicSchoolInfoData.ts');
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
  for (const id of ['ncue', 'ncut', 'ncyu', 'ndhu', 'nfu', 'nuk', 'nuu']) {
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

test('暨南大學公開課程目錄有獨立的校內查詢入口', () => {
  assert.equal(hasIntegratedCourseCatalog('ncnu'), true);
  assert.equal(new URL(resolveOfficialCourseQueryLink('ncnu').url).hostname, 'ccweb6.ncnu.edu.tw');
});

const english = Object.fromEntries(
  schoolEnglishNames.map(([id, name, englishName]) => [id, { id, name, englishName }]),
);
const ids = (query, directory) => searchSchools(query, directory).map((s) => s.id);

test('英文校名涵蓋 138 校並保留各自的物件身分與順序', () => {
  assert.equal(schoolEnglishNames.length, 138);
  const directory = Object.values(publicSchoolInfoDirectory);
  assert.equal(directory.length, schoolEnglishNames.length);
  assert.equal(new Set(schoolEnglishNames.map(([id]) => id)).size, directory.length);
  for (const [id, name, englishName] of schoolEnglishNames) {
    assert.equal(publicSchoolInfoDirectory[id].name, name);
    const found = searchSchools(englishName, directory);
    assert.equal(found[0], publicSchoolInfoDirectory[id]);
    assert.equal(new Set(found).size, found.length);
  }
  assert.deepEqual(searchSchools('', directory), directory);
});

test('英文全名完全相符優先於其他部分相符，且代號仍最優先', () => {
  const directory = [
    english.cgust,
    english.cgu,
    { id: 'z', name: '代號學院', code: 'Chang Gung University' },
  ];
  assert.deepEqual(ids('Chang Gung University', directory), ['z', 'cgu', 'cgust']);
  assert.deepEqual(ids('chang-gung university', directory.slice(0, 2)), ['cgu', 'cgust']);
  assert.deepEqual(ids('Chang Gung University', directory.slice(0, 2)), ['cgu', 'cgust']);
  assert.deepEqual(ids('National Taiwan University', [english.ntust, english.ntu]), [
    'ntu',
    'ntust',
  ]);
  assert.deepEqual(ids('Chang Gung', directory.slice(0, 2)), ['cgust', 'cgu']);
});

test('英文搜尋支援多字、連字號、空白、St Johns 與 and/& 寫法', () => {
  const directory = Object.values(english);
  assert.deepEqual(ids('Chung Hsing National', directory), ['nchu']);
  assert.deepEqual(ids('Chung-Jen', [english.cjc, english.ntu]), ['cjc']);
  assert.deepEqual(ids('chungjen', [english.cjc, english.ntu]), ['cjc']);
  assert.deepEqual(ids('Da Yeh', [english.dyu, english.ntu]), ['dyu']);
  assert.deepEqual(ids('St Johns', directory), ['sju']);
  assert.deepEqual(ids('st. john’s university', directory), ['sju']);
  assert.deepEqual(ids('St Marys', directory), ['smc']);
  assert.deepEqual(ids('Pharmacy & Science', directory), ['cnu']);
  assert.deepEqual(ids('Pharmacy and Science', directory), ['cnu']);
  assert.deepEqual(ids('Yunlin Science and Technology', directory), ['yuntech']);
  assert.deepEqual(ids('Yunlin Science & Technology', directory), ['yuntech']);
});

test('中文或代號可與英文混合查詢，單字母與純標點不會擴大結果', () => {
  const directory = [english.pu, english.ntu, english.sju];
  assert.deepEqual(ids('靜宜 Providence', directory), ['pu']);
  assert.deepEqual(ids('PU providence', directory), ['pu']);
  assert.deepEqual(ids('靜宜 Taiwan', directory), []);
  assert.deepEqual(ids('p u', directory), ['pu']);
  for (const query of ['&', '-', '.', '’', '& -']) {
    assert.deepEqual(ids(query, [english.cnu, { id: 'plain', name: '普通學院' }]), []);
  }
});

test('只有已知 ID 與中文校名同時相符才啟用英文搜尋，舊來源只限 nchu 與 pu', () => {
  const directory = [
    { id: 'tw-nchu', name: '國立中興大學' },
    { id: 'tw-pu', name: '靜宜大學' },
    { id: 'tw-ntu', name: '國立臺灣大學' },
    { id: 'NTU', name: '國立臺灣大學' },
    { id: 'ntu', name: '其他大學' },
    { id: 'tw-demo-uni', name: '國立臺灣大學' },
    { id: 'unknown', name: 'Providence University' },
    { id: 'ntu' },
  ];
  assert.deepEqual(ids('National Chung Hsing University', directory), ['tw-nchu']);
  assert.deepEqual(ids('Providence University', directory), ['unknown', 'tw-pu']);
  assert.deepEqual(ids('National Taiwan University', directory), []);
  assert.deepEqual(ids('Taiwan', [directory[2], directory[4]]), []);
  assert.deepEqual(ids('台灣大學', directory), ['tw-ntu', 'NTU', 'tw-demo-uni']);
});

test('英文搜尋不修改輸入、並保留原物件', () => {
  const directory = Object.freeze([
    Object.freeze({ ...english.cgust, status: 'open', aliases: Object.freeze(['長科']) }),
    Object.freeze({ ...english.cgu, domains: Object.freeze(['cgu.edu.tw']) }),
  ]);
  const before = structuredClone(directory);
  const found = searchSchools('Chang Gung University', directory);
  assert.deepEqual(found, [directory[1], directory[0]]);
  assert.equal(found[0], directory[1]);
  assert.deepEqual(directory, before);
  assert.deepEqual(ids('長科', directory), ['cgust']);
  assert.deepEqual(ids('cgu.EDU', directory), ['cgu']);
});

test('只為需要英文線索的結果解釋命中原因', () => {
  assert.equal(matchingSchoolEnglishName(english.pu, 'Providence 靜宜'), 'Providence University');
  for (const query of ['', '靜宜', ' Ｐ Ｕ ', 'unmatched', '&']) {
    assert.equal(matchingSchoolEnglishName(english.pu, query), null);
  }
  assert.equal(
    matchingSchoolEnglishName({ id: 'foreign', name: 'Providence University' }, 'Providence'),
    null,
  );
  assert.equal(matchingSchoolEnglishName({ id: 'pu', name: '另一所大學' }, 'Providence'), null);
});
