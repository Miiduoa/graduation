'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  SCHOOLS,
  PARSER_PRESETS,
  school,
  listSources,
  allSources,
  listPublicSchools,
  coverageRows,
  formatCoverageTable,
  SOURCE_UNAVAILABLE,
  PLACEHOLDER_SCHOOL_IDS,
  parseSyncSchoolIds,
  DEFAULT_SYNC_SCHOOLS,
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
  const byId = Object.fromEntries(listSources('pu').map((item) => [item.sourceId, item.listUrl]));
  expect(byId['pu-osa']).toBe('https://osa.pu.edu.tw/p/422-1111-1039.php');
  expect(byId['pu-dorm']).toBe('https://osadorm.pu.edu.tw/p/403-1065-679-1.php');
});

test('non-demo schools at least configure campus news and academic affairs', () => {
  for (const school of SCHOOLS.filter((item) => item.demo !== true)) {
    const sources = listSources(school.schoolId);
    expect(sources.some((item) => item.scope === 'campus')).toBe(true);
    if (school.schoolId === 'ncku') {
      expect(sources.map((item) => item.sourceId)).toEqual(['ncku-campus']);
      continue;
    }
    expect(sources.some((item) => /教務/.test(item.office))).toBe(true);
  }
});

test('demo schools without a real site stay off the public production list', () => {
  const rows = coverageRows();
  const demo = rows.filter((row) => PLACEHOLDER_SCHOOL_IDS.includes(row.schoolId));
  expect(demo.every((row) => row.status === 'unavailable')).toBe(true);
  expect(demo.every((row) => row.campus === SOURCE_UNAVAILABLE)).toBe(true);
  expect(
    SCHOOLS.filter((item) => item.cms === 'none')
      .map((item) => item.schoolId)
      .sort(),
  ).toEqual([...PLACEHOLDER_SCHOOL_IDS].sort());
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
  expect(
    PLACEHOLDER_SCHOOL_IDS.every((id) =>
      listPublicSchools('test').some((item) => item.schoolId === id),
    ),
  ).toBe(true);
  expect(
    PLACEHOLDER_SCHOOL_IDS.every((id) =>
      listPublicSchools('preview').some((item) => item.schoolId === id),
    ),
  ).toBe(true);
  expect(formatCoverageTable()).toContain('正式環境不顯示給一般使用者');
  expect(formatCoverageTable()).toContain('暫時抓不到');
  expect(formatCoverageTable()).toContain('靜宜大學');
  expect(formatCoverageTable()).toContain('校網系統');
  expect(formatCoverageTable()).toContain('iweb');
});

test('shared catalog links stay aligned with backend sources', () => {
  const shared = fs.readFileSync(
    path.join(__dirname, '../../../packages/shared/src/campusAnnouncementCatalog.ts'),
    'utf8',
  );
  const sources = allSources();
  expect(sources.length).toBeGreaterThan(10);
  for (const source of sources) {
    expect(shared).toContain(source.sourceId);
    expect(shared).toContain(source.listUrl);
    expect(shared).toContain(source.office);
  }
  expect(shared).not.toContain('tw-demo-uni');
  expect(shared).not.toContain('tw-taichung-uni-a');
});

test('NCKU and NTPU keep school-scoped public lists and do not share sources', () => {
  const ncku = listSources('ncku');
  const ntpu = listSources('ntpu');
  expect(ncku.map((item) => item.office)).toEqual(['全校最新消息']);
  expect(ncku.every((item) => item.schoolId === 'ncku')).toBe(true);
  expect(ncku).toHaveLength(1);
  expect(ncku[0].listUrl).toBe('https://web.ncku.edu.tw/p/422-1000-1026.php?Lang=zh-tw');
  expect(ncku.every((item) => item.parsers.length >= 2)).toBe(true);
  expect(ncku.some((item) => item.sourceId === 'ncku-aca')).toBe(false);
  expect(JSON.stringify(ncku)).not.toContain('403-1025-397');
  expect(ntpu.every((item) => item.schoolId === 'ntpu')).toBe(true);
  expect(ntpu.map((item) => item.office)).toEqual(['電子公文一般公告（含教務處）']);
  expect(ntpu.map((item) => item.parsers)).toEqual([PARSER_PRESETS.iweb]);
  expect(ntpu.find((item) => item.sourceId === 'ntpu-campus').listUrl).toBe(
    'https://fms.ntpu.edu.tw/km/24662',
  );
  expect(ntpu.some((item) => item.sourceId === 'ntpu-oga' || item.sourceId === 'ntpu-su')).toBe(
    false,
  );
  expect(ntpu.every((item) => item.fragile !== 'spa')).toBe(true);
  expect(ntpu.map((item) => item.listUrl).some((url) => url.includes('ncku.edu.tw'))).toBe(false);
  expect(ncku.map((item) => item.listUrl).some((url) => url.includes('ntpu.edu.tw'))).toBe(false);
});

test('sync school allowlist defaults to pu and never invents extra schools', () => {
  expect(DEFAULT_SYNC_SCHOOLS).toEqual(['pu']);
  expect(parseSyncSchoolIds(undefined)).toEqual(['pu']);
  expect(parseSyncSchoolIds('')).toEqual(['pu']);
  expect(parseSyncSchoolIds('ncku, ntpu')).toEqual(['ncku', 'ntpu']);
  expect(parseSyncSchoolIds('pu,pu,ncku')).toEqual(['pu', 'ncku']);
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
