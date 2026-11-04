import type { School } from './index';

/**
 * Multi-school directory (mock).
 * NOTE: `code` is a human-friendly alias and may collide.
 * `id` is the true unique key.
 */
export const mockSchools: School[] = [
  {
    id: 'tw-demo-uni',
    code: 'DEMO',
    name: '示範大學',
    shortName: 'Demo',
    themeColor: '#2563eb',
    domains: ['demo.edu.tw'],
  },

  // Example collision: same code, different schools.
  {
    id: 'tw-taichung-uni-a',
    code: 'TCU',
    name: '台中科技大學（示範A）',
    shortName: '中科大A',
    themeColor: '#16a34a',
    domains: ['tcu.edu.tw'],
  },
  {
    id: 'tw-taichung-uni-b',
    code: 'TCU',
    name: '台中大學（示範B）',
    shortName: '台中大學B',
    themeColor: '#f97316',
    domains: ['tcu2.edu.tw'],
  },

  {
    id: 'tw-nchu',
    code: 'NCHU',
    name: '國立中興大學',
    shortName: '中興',
    themeColor: '#991b1b',
    domains: ['nchu.edu.tw'],
    aliases: ['中興大學'],
  },
  {
    id: 'ntu',
    code: 'NTU',
    name: '國立臺灣大學',
    shortName: '台大',
    themeColor: '#006699',
    domains: ['ntu.edu.tw'],
    aliases: ['台灣大學'],
  },
  {
    id: 'nthu',
    code: 'NTHU',
    name: '國立清華大學',
    shortName: '清大',
    themeColor: '#7a0019',
    domains: ['nthu.edu.tw'],
  },
  {
    id: 'ncku',
    code: 'NCKU',
    name: '國立成功大學',
    shortName: '成大',
    themeColor: '#005087',
    domains: ['ncku.edu.tw'],
  },
  {
    id: 'nycu',
    code: 'NYCU',
    name: '國立陽明交通大學',
    shortName: '陽交大',
    themeColor: '#4b2e83',
    domains: ['nycu.edu.tw'],
    aliases: ['交大', '陽明交通'],
  },
  {
    id: 'ncu',
    code: 'NCU',
    name: '國立中央大學',
    shortName: '中央',
    themeColor: '#0033a0',
    domains: ['ncu.edu.tw'],
  },
  {
    id: 'nsysu',
    code: 'NSYSU',
    name: '國立中山大學',
    shortName: '中山',
    themeColor: '#005b96',
    domains: ['nsysu.edu.tw'],
  },
  {
    id: 'ntnu',
    code: 'NTNU',
    name: '國立臺灣師範大學',
    shortName: '台師大',
    themeColor: '#0033a0',
    domains: ['ntnu.edu.tw'],
  },
  {
    id: 'ntust',
    code: 'NTUST',
    name: '國立臺灣科技大學',
    shortName: '台科大',
    themeColor: '#003366',
    domains: ['ntust.edu.tw', 'mail.ntust.edu.tw'],
  },
  {
    id: 'nccu',
    code: 'NCCU',
    name: '國立政治大學',
    shortName: '政大',
    themeColor: '#006c38',
    domains: ['nccu.edu.tw'],
  },
  {
    id: 'ncyu',
    code: 'NCYU',
    name: '國立嘉義大學',
    shortName: '嘉大',
    themeColor: '#00695c',
    domains: ['ncyu.edu.tw'],
  },
  {
    id: 'ncue',
    code: 'NCUE',
    name: '國立彰化師範大學',
    shortName: '彰師大',
    themeColor: '#f57c00',
    domains: ['ncue.edu.tw'],
  },
  {
    id: 'ntpu',
    code: 'NTPU',
    name: '國立臺北大學',
    shortName: '北大',
    themeColor: '#8e24aa',
    domains: ['ntpu.edu.tw'],
  },
  {
    id: 'tmu',
    code: 'TMU',
    name: '臺北醫學大學',
    shortName: '北醫',
    themeColor: '#0d9488',
    domains: ['tmu.edu.tw'],
  },
  {
    id: 'fju',
    code: 'FJU',
    name: '輔仁大學',
    shortName: '輔大',
    themeColor: '#c62828',
    domains: ['fju.edu.tw'],
  },
  {
    id: 'thu',
    code: 'THU',
    name: '東海大學',
    shortName: '東海',
    themeColor: '#1565c0',
    domains: ['thu.edu.tw'],
  },
  {
    id: 'cgu',
    code: 'CGU',
    name: '長庚大學',
    shortName: '長庚',
    themeColor: '#2e7d32',
    domains: ['cgu.edu.tw'],
  },
  {
    id: 'cycu',
    code: 'CYCU',
    name: '中原大學',
    shortName: '中原',
    themeColor: '#ef6c00',
    domains: ['cycu.edu.tw'],
  },
  {
    id: 'pu',
    code: 'PU',
    name: '靜宜大學',
    shortName: '靜宜',
    themeColor: '#00897b',
    domains: ['pu.edu.tw'],
  },
  {
    id: 'scu',
    code: 'SCU',
    name: '東吳大學',
    shortName: '東吳',
    themeColor: '#ad1457',
    domains: ['scu.edu.tw'],
  },
  {
    id: 'ntub',
    code: 'NTUB',
    name: '國立臺北商業大學',
    shortName: '北商',
    themeColor: '#5d4037',
    domains: ['ntub.edu.tw'],
  },
];

function normalizeDomain(domain?: string | null): string {
  return (domain ?? '').trim().toLowerCase();
}

export function getEmailDomain(email?: string | null): string | null {
  if (!email) return null;
  const parts = String(email).toLowerCase().split('@');
  if (parts.length < 2) return null;
  return normalizeDomain(parts.pop() || '');
}

export function findSchoolByDomain(domain?: string | null): School | undefined {
  const d = normalizeDomain(domain);
  if (!d) return undefined;
  return mockSchools.find((s) => (s.domains || []).map(normalizeDomain).includes(d));
}

export function resolveSchoolByEmail(email?: string | null): School | undefined {
  const domain = getEmailDomain(email);
  if (!domain) return undefined;
  return findSchoolByDomain(domain);
}

export function normalizeSchoolCode(code?: string | null): string {
  return (code ?? '').trim().toUpperCase();
}

export function findSchoolsByCode(code?: string | null): School[] {
  const c = normalizeSchoolCode(code);
  if (!c) return [];
  return mockSchools.filter((s) => s.code === c);
}

type SchoolSearchFields = {
  id?: string;
  name: string;
  shortName?: string;
  code?: string;
  aliases?: readonly string[];
  domains?: readonly string[];
};

export function normalizeSchoolQuery(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/臺/g, '台').trim();
}

function withoutWhitespace(value: string) {
  return normalizeSchoolQuery(value).replace(/\s+/g, '');
}

/** 代號完全相符優先，各組維持名錄順序，不變更輸入資料。 */
export function searchSchools(query?: string | null): School[];
export function searchSchools<T extends SchoolSearchFields>(query: string | null | undefined, schools: readonly T[]): T[];
export function searchSchools(
  query?: string | null,
  schools: readonly SchoolSearchFields[] = mockSchools,
): SchoolSearchFields[] {
  const needle = withoutWhitespace(query ?? '');
  const terms = normalizeSchoolQuery(query ?? '').split(/\s+/).filter(Boolean);
  const exact: SchoolSearchFields[] = [];
  const partial: SchoolSearchFields[] = [];
  for (const school of schools) {
    const fields = [school.name, school.shortName, school.code, school.id,
      ...(school.aliases ?? []), ...(school.domains ?? [])]
      .filter((field): field is string => Boolean(field))
      .map(withoutWhitespace);
    const exactCode = needle && [school.code, school.id].some(
      (code) => code && withoutWhitespace(code) === needle,
    );
    if (exactCode) exact.push(school);
    else if (fields.some((field) => field.includes(needle)) ||
      terms.every((term) => fields.some((field) => field.includes(term)))) {
      partial.push(school);
    }
  }
  return [...exact, ...partial];
}

export function findSchoolById(id?: string | null): School | undefined {
  const v = (id ?? '').trim();
  if (!v) return undefined;
  return mockSchools.find((s) => s.id === v);
}

/**
 * Resolve selection priority:
 * 1) schoolId (unique)
 * 2) school code (if unique)
 * 3) fallback default
 */
export function resolveSchool(params?: {
  schoolId?: string | null;
  school?: string | null;
}): School {
  const byId = findSchoolById(params?.schoolId);
  if (byId) return byId;

  const matches = findSchoolsByCode(params?.school);
  if (matches.length === 1) return matches[0];

  return mockSchools[0];
}
