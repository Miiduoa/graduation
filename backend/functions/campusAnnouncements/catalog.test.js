'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  SCHOOLS,
  PARSER_PRESETS,
  school,
  listSources,
  listPublicSchools,
  coverageRows,
  formatCoverageTable,
  SOURCE_UNAVAILABLE,
  PLACEHOLDER_SCHOOL_IDS,
} = require('./catalog');

const schoolsSrc = fs.readFileSync(
  path.join(__dirname, '../../../packages/shared/src/schools.ts'),
  'utf8',
);
const schoolIds = [...schoolsSrc.matchAll(/^\s+id: '([^']+)'/gm)].map((match) => match[1]);

test('catalog covers every school in the shared directory', () => {
  expect(schoolIds.length).toBeGreaterThan(10);
  expect(SCHOOLS.map((school) => school.schoolId).sort()).toEqual([...schoolIds].sort());
});

test('Providence University has the seven first-wave offices and no login portals', () => {
  const offices = listSources('pu').map((item) => item.office);
  expect(offices).toEqual(['綜合業務組', '教務處', '學務處', '事務組', '資訊處', '校警', '住宿']);
  expect(listSources('pu').every((item) => item.kind === 'html_list')).toBe(true);
  expect(listSources('pu').every((item) => item.parsers.length >= 2)).toBe(true);
  expect(JSON.stringify(listSources('pu'))).not.toMatch(/alcat\.pu\.edu\.tw|tronclass/i);
});

test('non-demo schools at least configure campus news and academic affairs', () => {
  for (const school of SCHOOLS.filter((item) => item.demo !== true)) {
    const sources = listSources(school.schoolId);
    expect(sources.some((item) => item.scope === 'campus')).toBe(true);
    expect(sources.some((item) => /教務/.test(item.office))).toBe(true);
  }
});

test('demo schools without a real site stay off the public production list', () => {
  const rows = coverageRows();
  const demo = rows.filter((row) => PLACEHOLDER_SCHOOL_IDS.includes(row.schoolId));
  expect(demo.every((row) => row.status === 'unavailable')).toBe(true);
  expect(demo.every((row) => row.campus === SOURCE_UNAVAILABLE)).toBe(true);
  expect(SCHOOLS.filter((item) => item.cms === 'none').map((item) => item.schoolId).sort()).toEqual(
    [...PLACEHOLDER_SCHOOL_IDS].sort(),
  );
  const productionIds = listPublicSchools('production').map((item) => item.schoolId);
  expect(productionIds.some((id) => PLACEHOLDER_SCHOOL_IDS.includes(id))).toBe(false);
  expect(listPublicSchools('').some((item) => PLACEHOLDER_SCHOOL_IDS.includes(item.schoolId))).toBe(
    false,
  );
  expect(
    listPublicSchools('staging').some((item) => PLACEHOLDER_SCHOOL_IDS.includes(item.schoolId)),
  ).toBe(false);
  const previousAppEnv = process.env.APP_ENV;
  delete process.env.APP_ENV;
  expect(listPublicSchools().some((item) => PLACEHOLDER_SCHOOL_IDS.includes(item.schoolId))).toBe(
    false,
  );
  if (previousAppEnv == null) delete process.env.APP_ENV;
  else process.env.APP_ENV = previousAppEnv;
  const developmentIds = listPublicSchools('development').map((item) => item.schoolId);
  expect(PLACEHOLDER_SCHOOL_IDS.every((id) => developmentIds.includes(id))).toBe(true);
  expect(PLACEHOLDER_SCHOOL_IDS.every((id) => listPublicSchools('test').some((item) => item.schoolId === id))).toBe(
    true,
  );
  expect(
    PLACEHOLDER_SCHOOL_IDS.every((id) => listPublicSchools('preview').some((item) => item.schoolId === id)),
  ).toBe(true);
  expect(formatCoverageTable()).toContain('正式環境不顯示給一般使用者');
  expect(formatCoverageTable()).toContain('暫時抓不到');
  expect(formatCoverageTable()).toContain('靜宜大學');
  expect(formatCoverageTable()).toContain('校網系統');
  expect(formatCoverageTable()).toContain('iweb');
});

test('adding a school only requires a catalog entry with shared parsers', () => {
  const ncku = listSources('ncku');
  expect(ncku[0].parsers).toEqual(PARSER_PRESETS.iweb);
  expect(listSources('ncu')[0].parsers).toEqual(PARSER_PRESETS.rpage);
  const added = school('example-uni', '範例大學', {
    cms: 'iweb',
    campus: { url: 'https://www.example.edu/p/403-1000-14-1.php' },
    academic: { url: 'https://aca.example.edu/', cms: 'html' },
  });
  expect(added.sources).toHaveLength(2);
  expect(added.sources[0].parsers).toEqual(PARSER_PRESETS.iweb);
  expect(added.sources[1].parsers).toEqual(PARSER_PRESETS.html);
  expect(SCHOOLS.every((item) => item.cms)).toBe(true);
});
