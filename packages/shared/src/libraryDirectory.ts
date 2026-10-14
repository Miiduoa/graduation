/**
 * Verified public library entry points. An entry means we have identified the
 * institution's website, not that Campus One has access to its private records.
 *
 * Never infer a catalog query URL from a library homepage: search forms differ
 * across institutions. Only the PU WebPac search contract is supported below.
 */
export type SchoolLibraryEntry = {
  schoolId: string;
  name: string;
  homepage: string;
  catalog?: string;
  personal?: string;
  hours?: string;
  reservation?: string;
  electronic?: string;
  searchMode?: 'pu-webpac';
};

export const SCHOOL_LIBRARIES: Readonly<Record<string, SchoolLibraryEntry>> = {
  pu: {
    schoolId: 'pu',
    name: '靜宜大學蓋夏圖書館',
    homepage: 'https://library.pu.edu.tw/',
    catalog: 'https://webpacx.lib.pu.edu.tw/',
    personal: 'https://webpacx.lib.pu.edu.tw/personal/',
    hours: 'https://library.pu.edu.tw/p/426-1054-32.php?Lang=zh-tw',
    reservation: 'https://library.pu.edu.tw/p/426-1054-14.php?Lang=zh-tw',
    electronic: 'https://jumper.lib.pu.edu.tw/',
    searchMode: 'pu-webpac',
  },
  ntu: {
    schoolId: 'ntu',
    name: '國立臺灣大學圖書館',
    homepage: 'https://www.lib.ntu.edu.tw/',
  },
  nthu: {
    schoolId: 'nthu',
    name: '國立清華大學圖書館',
    homepage: 'https://www.lib.nthu.edu.tw/',
  },
  ncku: {
    schoolId: 'ncku',
    name: '國立成功大學圖書館',
    homepage: 'https://www.lib.ncku.edu.tw/',
  },
  nycu: {
    schoolId: 'nycu',
    name: '國立陽明交通大學圖書館',
    homepage: 'https://lib.nycu.edu.tw/',
  },
  ncu: {
    schoolId: 'ncu',
    name: '國立中央大學圖書館',
    homepage: 'https://www.lib.ncu.edu.tw/',
  },
  nsysu: {
    schoolId: 'nsysu',
    name: '國立中山大學圖書與資訊處',
    homepage: 'https://www.lis.nsysu.edu.tw/',
  },
  nchu: {
    schoolId: 'nchu',
    name: '國立中興大學圖書館',
    homepage: 'https://www.lib.nchu.edu.tw/',
  },
  ntnu: {
    schoolId: 'ntnu',
    name: '國立臺灣師範大學圖書館',
    homepage: 'https://www.lib.ntnu.edu.tw/',
  },
  ntust: {
    schoolId: 'ntust',
    name: '國立臺灣科技大學圖書館',
    homepage: 'https://library.ntust.edu.tw/',
  },
  nccu: {
    schoolId: 'nccu',
    name: '國立政治大學圖書館',
    homepage: 'https://www.lib.nccu.edu.tw/',
  },
  ncyu: {
    schoolId: 'ncyu',
    name: '國立嘉義大學圖書資訊處',
    homepage: 'https://website.ncyu.edu.tw/lib/',
  },
  ncue: {
    schoolId: 'ncue',
    name: '國立彰化師範大學圖書與資訊處',
    homepage: 'https://olis.ncue.edu.tw/',
    catalog: 'https://webpacx.ncue.edu.tw/',
  },
  ntpu: {
    schoolId: 'ntpu',
    name: '國立臺北大學圖書館',
    homepage: 'https://library.ntpu.edu.tw/',
  },
  tmu: {
    schoolId: 'tmu',
    name: '臺北醫學大學圖書館',
    homepage: 'https://library.tmu.edu.tw/',
    catalog: 'https://libelis.tmu.edu.tw/webpacIndex.jsp',
  },
  fju: {
    schoolId: 'fju',
    name: '輔仁大學圖書館',
    homepage: 'https://home.lib.fju.edu.tw/',
  },
  thu: {
    schoolId: 'thu',
    name: '東海大學圖書暨資訊處',
    homepage: 'https://www.lib.thu.edu.tw/',
    catalog: 'https://webpac.lib.thu.edu.tw/',
  },
  cgu: {
    schoolId: 'cgu',
    name: '長庚大學圖書館',
    homepage: 'https://www.cgu.edu.tw/library/',
  },
  cycu: {
    schoolId: 'cycu',
    name: '中原大學張靜愚紀念圖書館',
    homepage: 'https://lib.cycu.edu.tw/',
  },
  scu: {
    schoolId: 'scu',
    name: '東吳大學圖書館',
    homepage: 'https://www.lib.scu.edu.tw/',
  },
  ntub: {
    schoolId: 'ntub',
    name: '國立臺北商業大學圖書館',
    homepage: 'https://library.ntub.edu.tw/wSite/mp?mp=1',
  },
};

const SCHOOL_NAMES: Readonly<Record<string, string>> = {
  pu: '靜宜大學',
  ntu: '國立臺灣大學',
  nthu: '國立清華大學',
  ncku: '國立成功大學',
  nycu: '國立陽明交通大學',
  ncu: '國立中央大學',
  nsysu: '國立中山大學',
  nchu: '國立中興大學',
  ntnu: '國立臺灣師範大學',
  ntust: '國立臺灣科技大學',
  nccu: '國立政治大學',
  ncyu: '國立嘉義大學',
  ncue: '國立彰化師範大學',
  ntpu: '國立臺北大學',
  tmu: '臺北醫學大學',
  fju: '輔仁大學',
  thu: '東海大學',
  cgu: '長庚大學',
  cycu: '中原大學',
  scu: '東吳大學',
  ntub: '國立臺北商業大學',
};

function normalizeName(name: string): string {
  return name.trim().normalize('NFKC').replace(/\s+/g, '').replace(/台/g, '臺');
}

/**
 * Resolve only an identified school. Tenant IDs may have a 'tw-' prefix, or
 * carry a different ID while retaining an exact, unambiguous official name.
 * Demonstration schools and unknown names must never inherit another catalog.
 */
export function getSchoolLibrary(
  schoolId?: string | null,
  schoolName?: string | null,
): SchoolLibraryEntry | null {
  if (!schoolId || schoolId === 'all') return null;
  const normalizedId = schoolId.trim().toLowerCase();
  const id = normalizedId.startsWith('tw-') ? normalizedId.slice(3) : normalizedId;
  if (SCHOOL_LIBRARIES[id]) return SCHOOL_LIBRARIES[id];
  if (!schoolName || /示範|測試|demo/i.test(schoolName)) return null;
  const normalizedName = normalizeName(schoolName);
  const matches = Object.entries(SCHOOL_NAMES).filter(
    ([, name]) => normalizeName(name) === normalizedName,
  );
  return matches.length === 1 ? SCHOOL_LIBRARIES[matches[0][0]] : null;
}

/** Only PU's external WebPac search query has a verified field mapping. */
export function librarySearchUrl(
  entry: SchoolLibraryEntry,
  keyword: string,
  field: 'FullText' | 'Title' | 'Author' | 'ISBN' | 'Subject' = 'FullText',
): string | null {
  const query = keyword.trim();
  if (!query || entry.searchMode !== 'pu-webpac' || !entry.catalog) return null;
  const url = new URL('search', entry.catalog);
  url.searchParams.set('searchField', field);
  url.searchParams.set('searchInput', query);
  return url.toString();
}
