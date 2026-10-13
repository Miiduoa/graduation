'use strict';

/**
 * 新增學校：在 SCHOOLS 加一筆設定即可，不要另寫爬蟲。
 * cms 對應共用解析器：iweb（iWeb）、rpage（RPage）、html（一般校網）、none（沒有可抓公開列表）。
 */

const PARSER_PRESETS = {
  iweb: ['iwebTable', 'iwebLinks'],
  rpage: ['rpageList', 'htmlLinks'],
  html: ['htmlLinks', 'iwebLinks'],
  rss: ['rss', 'htmlLinks'],
};

const SOURCE_UNAVAILABLE = '暫時抓不到';
const SOURCE_DOWN_EMPTY = '學校網站暫時連不上，可以先到學校網站看最新消息';
const PLACEHOLDER_SCHOOL_IDS = ['tw-demo-uni', 'tw-taichung-uni-a', 'tw-taichung-uni-b'];

function source(schoolId, sourceId, office, scope, listUrl, parsers, extra = {}) {
  return {
    schoolId,
    sourceId,
    office,
    department: extra.department || '',
    scope,
    kind: extra.kind || 'html_list',
    listUrl,
    itemUrlTemplate: extra.itemUrlTemplate || '',
    parsers,
    robots: extra.robots !== false,
    rateLimitMs: extra.rateLimitMs || 3000,
    intervalMinutes: extra.intervalMinutes || 20,
    owner: extra.owner || 'campus-announcements',
    enabled: extra.enabled !== false,
  };
}

function listSource(schoolId, spec, defaultCms) {
  const cms = spec.cms || defaultCms || 'html';
  return source(
    schoolId,
    spec.sourceId,
    spec.office,
    spec.scope || 'office',
    spec.url,
    PARSER_PRESETS[cms] || PARSER_PRESETS.html,
    spec.extra || {},
  );
}

function school(schoolId, name, spec = {}) {
  const cms = spec.cms || (spec.demo ? 'none' : 'html');
  const sources = [];
  if (spec.campus) {
    sources.push(
      listSource(
        schoolId,
        {
          sourceId: spec.campus.sourceId || `${schoolId}-campus`,
          office: spec.campus.office || '全校最新消息',
          scope: 'campus',
          url: spec.campus.url,
          cms: spec.campus.cms,
        },
        cms,
      ),
    );
  }
  if (spec.academic) {
    sources.push(
      listSource(
        schoolId,
        {
          sourceId: spec.academic.sourceId || `${schoolId}-aca`,
          office: spec.academic.office || '教務處',
          scope: 'office',
          url: spec.academic.url,
          cms: spec.academic.cms,
        },
        cms,
      ),
    );
  }
  for (const office of spec.offices || []) {
    sources.push(listSource(schoolId, office, cms));
  }
  return {
    schoolId,
    name,
    demo: spec.demo === true,
    cms,
    sources,
  };
}

const SCHOOLS = [
  school('tw-demo-uni', '示範大學', { demo: true, cms: 'none' }),
  school('tw-taichung-uni-a', '台中科技大學（示範A）', { demo: true, cms: 'none' }),
  school('tw-taichung-uni-b', '台中大學（示範B）', { demo: true, cms: 'none' }),
  school('tw-nchu', '國立中興大學（示範）', {
    cms: 'html',
    campus: { url: 'https://www.nchu.edu.tw/news' },
    academic: { url: 'https://www.oaa.nchu.edu.tw/' },
  }),
  school('ntu', '國立臺灣大學', {
    cms: 'html',
    campus: { url: 'https://www.ntu.edu.tw/spotlight/index.html' },
    academic: { url: 'https://www.aca.ntu.edu.tw/' },
  }),
  school('nthu', '國立清華大學', {
    cms: 'html',
    campus: { url: 'https://www.nthu.edu.tw/news' },
    academic: { url: 'https://academic.site.nthu.edu.tw/' },
  }),
  school('ncku', '國立成功大學', {
    cms: 'iweb',
    campus: { url: 'https://web.ncku.edu.tw/p/403-1000-14-1.php' },
    academic: { url: 'https://www.acad.ncku.edu.tw/', cms: 'html' },
  }),
  school('nycu', '國立陽明交通大學', {
    cms: 'html',
    campus: { url: 'https://www.nycu.edu.tw/nycu/news' },
    academic: { url: 'https://aa.nycu.edu.tw/' },
  }),
  school('ncu', '國立中央大學', {
    cms: 'rpage',
    campus: { url: 'https://www.ncu.edu.tw/tw/news/index.php' },
    academic: { url: 'https://aca.ncu.edu.tw/', cms: 'html' },
  }),
  school('nsysu', '國立中山大學', {
    cms: 'iweb',
    campus: { url: 'https://www.nsysu.edu.tw/p/403-1000-14-1.php' },
    academic: { url: 'https://oaa.nsysu.edu.tw/', cms: 'html' },
  }),
  school('ntnu', '國立臺灣師範大學', {
    cms: 'rpage',
    campus: { url: 'https://pr.ntnu.edu.tw/news/index.php' },
    academic: { url: 'https://www.aa.ntnu.edu.tw/', cms: 'html' },
  }),
  school('ntust', '國立臺灣科技大學', {
    cms: 'iweb',
    campus: { url: 'https://www.ntust.edu.tw/p/403-1000-14-1.php' },
    academic: { url: 'https://www.academic.ntust.edu.tw/', cms: 'html' },
  }),
  school('nccu', '國立政治大學', {
    cms: 'iweb',
    campus: { url: 'https://www.nccu.edu.tw/p/403-1000-14-1.php' },
    academic: { url: 'https://aca.nccu.edu.tw/', cms: 'html' },
  }),
  school('ncyu', '國立嘉義大學', {
    cms: 'html',
    campus: { url: 'https://www.ncyu.edu.tw/news' },
    academic: { url: 'https://www.ncyu.edu.tw/aca/' },
  }),
  school('ncue', '國立彰化師範大學', {
    cms: 'html',
    campus: { url: 'https://www.ncue.edu.tw/' },
    academic: { url: 'https://acadoff.ncue.edu.tw/' },
  }),
  school('ntpu', '國立臺北大學', {
    cms: 'html',
    campus: { url: 'https://new.ntpu.edu.tw/news' },
    academic: { url: 'https://www.aa.ntpu.edu.tw/' },
  }),
  school('tmu', '臺北醫學大學', {
    cms: 'html',
    campus: { url: 'https://www.tmu.edu.tw/news' },
    academic: { url: 'https://oga.tmu.edu.tw/' },
  }),
  school('fju', '輔仁大學', {
    cms: 'html',
    campus: { url: 'https://www.fju.edu.tw/' },
    academic: { url: 'https://www.academic.fju.edu.tw/' },
  }),
  school('thu', '東海大學', {
    cms: 'iweb',
    campus: { url: 'https://www.thu.edu.tw/' },
    academic: { url: 'https://acad.thu.edu.tw/' },
  }),
  school('cgu', '長庚大學', {
    cms: 'html',
    campus: { url: 'https://www.cgu.edu.tw/' },
    academic: { url: 'https://academic.cgu.edu.tw/' },
  }),
  school('cycu', '中原大學', {
    cms: 'html',
    campus: { url: 'https://www.cycu.edu.tw/' },
    academic: { url: 'https://aca.cycu.edu.tw/' },
  }),
  school('pu', '靜宜大學', {
    cms: 'iweb',
    offices: [
      {
        sourceId: 'pu-dorac',
        office: '綜合業務組',
        scope: 'campus',
        url: 'https://dorac.pu.edu.tw/p/403-1059-719-1.php',
      },
      { sourceId: 'pu-acd', office: '教務處', url: 'https://acd.pu.edu.tw/p/403-1042-885-1.php' },
      { sourceId: 'pu-osa', office: '學務處', url: 'https://osa.pu.edu.tw/p/422-1111-1039.php' },
      { sourceId: 'pu-dbs', office: '事務組', url: 'https://dbs.pu.edu.tw/p/403-1069-783-1.php' },
      { sourceId: 'pu-oits', office: '資訊處', url: 'https://oits.pu.edu.tw/' },
      { sourceId: 'pu-csp', office: '校警', url: 'https://csp.pu.edu.tw/' },
      {
        sourceId: 'pu-dorm',
        office: '住宿',
        url: 'https://osadorm.pu.edu.tw/p/403-1065-679-1.php',
      },
    ],
  }),
  school('scu', '東吳大學', {
    cms: 'html',
    campus: { url: 'https://www.scu.edu.tw/' },
    academic: { url: 'https://www.scu.edu.tw/acade/' },
  }),
  school('ntub', '國立臺北商業大學', {
    cms: 'html',
    campus: { url: 'https://www.ntub.edu.tw/' },
    academic: { url: 'https://aca.ntub.edu.tw/' },
  }),
];

function listSchools() {
  return SCHOOLS.map((entry) => ({
    schoolId: entry.schoolId,
    name: entry.name,
    demo: entry.demo === true,
    cms: entry.cms,
    sourceCount: (entry.sources || []).length,
  }));
}

function isPlaceholderSchool(entry) {
  return entry?.cms === 'none' || PLACEHOLDER_SCHOOL_IDS.includes(entry?.schoolId);
}

function allowsPlaceholderSchools(env) {
  const value = String(env ?? '').trim();
  return value === 'development' || value === 'preview' || value === 'test';
}

function isPublicAnnouncementSchool(entry, env = process.env.APP_ENV ?? '') {
  return !isPlaceholderSchool(entry) || allowsPlaceholderSchools(env);
}

function listPublicSchools(env) {
  return listSchools().filter((entry) => isPublicAnnouncementSchool(entry, env));
}

function schoolConfig(schoolId) {
  return SCHOOLS.find((entry) => entry.schoolId === schoolId) || null;
}

function listSources(schoolId) {
  const entry = schoolConfig(schoolId);
  return entry ? entry.sources.filter((item) => item.enabled !== false) : [];
}

function allSources() {
  return SCHOOLS.flatMap((entry) => entry.sources.filter((item) => item.enabled !== false));
}

function coverageRows() {
  return SCHOOLS.map((entry) => {
    const sources = entry.sources || [];
    const campus = sources.find((item) => item.scope === 'campus');
    const academic = sources.find(
      (item) => /教務/.test(item.office) || item.sourceId.endsWith('-aca'),
    );
    const offices = sources.filter((item) => item.scope === 'office').map((item) => item.office);
    let status = 'configured';
    let note = campus && academic ? '已設定全校與教務處；實際抽出看健康檢查' : '';
    if (entry.schoolId === 'pu') {
      note = '第一批七處室完整接上 iWeb 雙解析器';
    }
    if (entry.demo && sources.length === 0) {
      status = 'unavailable';
      note = '示範學校沒有真實校網，正式環境不顯示給一般使用者';
    } else if (sources.length === 0) {
      status = 'unavailable';
      note = '尚未找到可抓的公開列表';
    }
    return {
      schoolId: entry.schoolId,
      name: entry.name,
      cms: entry.cms,
      status,
      campus: campus ? campus.listUrl : SOURCE_UNAVAILABLE,
      academic: academic ? academic.listUrl : SOURCE_UNAVAILABLE,
      offices,
      sourceCount: sources.length,
      note,
    };
  });
}

function formatCoverageTable(rows = coverageRows()) {
  const header = [
    '學校',
    'schoolId',
    '狀態',
    '校網系統',
    '全校最新消息',
    '教務處',
    '其他處室',
    '備註',
  ];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (row) =>
        `| ${row.name} | ${row.schoolId} | ${row.status === 'unavailable' ? SOURCE_UNAVAILABLE : '已接設定'} | ${row.cms} | ${row.campus} | ${row.academic} | ${row.offices.join('、') || '—'} | ${row.note} |`,
    ),
  ];
  return lines.join('\n');
}

module.exports = {
  PARSER_PRESETS,
  SCHOOLS,
  school,
  schoolConfig,
  listSchools,
  listPublicSchools,
  isPlaceholderSchool,
  isPublicAnnouncementSchool,
  listSources,
  allSources,
  coverageRows,
  formatCoverageTable,
  SOURCE_UNAVAILABLE,
  SOURCE_DOWN_EMPTY,
  PLACEHOLDER_SCHOOL_IDS,
};
