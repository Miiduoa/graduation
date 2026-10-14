import { mockSchools } from './schools';

export type OfficialLibraryService = {
  name: string;
  websiteUrl: string;
  catalogUrl: string;
  catalogSearch?: 'pu-webpac';
  accountUrl?: string;
  hoursUrl?: string;
  spacesUrl?: string;
  electronicResourcesUrl?: string;
};

/**
 * Only official, school-specific destinations belong here.
 * Catalog search parameters and personal-account links require separate verification.
 */
export const officialLibraryDirectory: Readonly<Record<string, OfficialLibraryService>> = {
  pu: {
    name: '蓋夏圖書館',
    websiteUrl: 'https://library.pu.edu.tw/',
    catalogUrl: 'https://webpacx.lib.pu.edu.tw/',
    catalogSearch: 'pu-webpac',
    accountUrl: 'https://webpacx.lib.pu.edu.tw/personal/',
    hoursUrl: 'https://library.pu.edu.tw/p/426-1054-32.php?Lang=zh-tw',
    spacesUrl: 'https://library.pu.edu.tw/p/426-1054-14.php?Lang=zh-tw',
    electronicResourcesUrl: 'https://jumper.lib.pu.edu.tw/',
  },
  ntu: {
    name: '國立臺灣大學圖書館',
    websiteUrl: 'https://www.lib.ntu.edu.tw/',
    catalogUrl: 'https://www.lib.ntu.edu.tw/',
  },
  nthu: {
    name: '國立清華大學圖書館',
    websiteUrl: 'https://www.lib.nthu.edu.tw/',
    catalogUrl: 'https://www.lib.nthu.edu.tw/',
  },
  ncku: {
    name: '國立成功大學圖書館',
    websiteUrl: 'https://www.lib.ncku.edu.tw/',
    catalogUrl: 'https://www.lib.ncku.edu.tw/',
  },
  nycu: {
    name: '國立陽明交通大學圖書館',
    websiteUrl: 'https://lib.nycu.edu.tw/',
    catalogUrl: 'https://lib.nycu.edu.tw/',
  },
  ncu: {
    name: '國立中央大學圖書館',
    websiteUrl: 'https://www.lib.ncu.edu.tw/',
    catalogUrl: 'https://www.lib.ncu.edu.tw/',
    hoursUrl: 'https://www.lib.ncu.edu.tw/open/hours_ca.php',
  },
  nsysu: {
    name: '國立中山大學圖書與資訊處',
    websiteUrl: 'https://lis.nsysu.edu.tw/',
    catalogUrl: 'https://lis.nsysu.edu.tw/',
  },
  ntnu: {
    name: '國立臺灣師範大學圖書館',
    websiteUrl: 'https://www.lib.ntnu.edu.tw/',
    catalogUrl: 'https://www.lib.ntnu.edu.tw/',
  },
  ntust: {
    name: '國立臺灣科技大學圖書館',
    websiteUrl: 'https://library.ntust.edu.tw/?Lang=zh-tw',
    catalogUrl: 'https://sierra.lib.ntust.edu.tw/%2Acht',
  },
  nccu: {
    name: '國立政治大學圖書館',
    websiteUrl: 'https://www.lib.nccu.edu.tw/',
    catalogUrl: 'https://www.lib.nccu.edu.tw/',
  },
  ncyu: {
    name: '國立嘉義大學圖書館',
    websiteUrl: 'https://www.ncyu.edu.tw/lib/',
    catalogUrl: 'https://www.ncyu.edu.tw/lib/',
  },
  ncue: {
    name: '國立彰化師範大學圖書與資訊處',
    websiteUrl: 'https://olis.ncue.edu.tw/',
    catalogUrl: 'https://webpacx.ncue.edu.tw/',
  },
  ntpu: {
    name: '國立臺北大學圖書館',
    websiteUrl: 'https://library.ntpu.edu.tw/',
    catalogUrl: 'https://library.ntpu.edu.tw/link/49e75ae8d34d4da88f36f29ef2a5568d',
  },
  tmu: {
    name: '臺北醫學大學圖書館',
    websiteUrl: 'https://library.tmu.edu.tw/',
    catalogUrl: 'https://library.tmu.edu.tw/',
  },
  fju: {
    name: '輔仁大學圖書館',
    websiteUrl: 'https://home.lib.fju.edu.tw/',
    catalogUrl: 'https://home.lib.fju.edu.tw/TC/webpac',
  },
  thu: {
    name: '東海大學圖書暨資訊處',
    websiteUrl: 'https://lis.thu.edu.tw/',
    catalogUrl: 'https://webpac.lib.thu.edu.tw/',
  },
  cgu: {
    name: '長庚大學圖書館',
    websiteUrl: 'https://www.cgu.edu.tw/library/',
    catalogUrl: 'https://www.cgu.edu.tw/library/',
  },
  cycu: {
    name: '中原大學圖書館',
    websiteUrl: 'https://lib.cycu.edu.tw/',
    catalogUrl: 'https://lib.cycu.edu.tw/',
  },
  scu: {
    name: '東吳大學圖書館',
    websiteUrl: 'https://www.lib.scu.edu.tw/',
    catalogUrl: 'https://www.lib.scu.edu.tw/',
  },
  ntub: {
    name: '國立臺北商業大學圖書館',
    websiteUrl: 'https://library.ntub.edu.tw/wSite/mp?mp=1',
    catalogUrl: 'https://webpacx.ntub.edu.tw/',
  },
  'tw-nchu': {
    name: '國立中興大學圖書館',
    websiteUrl: 'https://www.lib.nchu.edu.tw/',
    catalogUrl: 'https://www.lib.nchu.edu.tw/',
  },
};

export function getOfficialLibrary(
  schoolId?: string | null,
  schoolName?: string | null,
): OfficialLibraryService | null {
  if (!schoolId) return null;
  if (Object.prototype.hasOwnProperty.call(officialLibraryDirectory, schoolId)) {
    return officialLibraryDirectory[schoolId];
  }
  // Public tenant IDs may differ from the legacy school directory IDs.
  // Match only an exact, unique institution name; never guess by substring or old selection.
  if (!schoolName) return null;
  const matches = mockSchools.filter(
    (school) =>
      school.name === schoolName &&
      Object.prototype.hasOwnProperty.call(officialLibraryDirectory, school.id),
  );
  const libraryId =
    matches.length === 1 ? matches[0].id : schoolName === '國立中興大學' ? 'tw-nchu' : null;
  return libraryId ? officialLibraryDirectory[libraryId] : null;
}

export function buildOfficialLibraryCatalogUrl(
  schoolId: string,
  keyword: string,
  field = 'FullText',
): string | null {
  const library = getOfficialLibrary(schoolId);
  if (!library) return null;
  if (library.catalogSearch !== 'pu-webpac' || !keyword.trim()) return library.catalogUrl;
  const search = new URL('search', library.catalogUrl);
  search.searchParams.set('searchField', field);
  search.searchParams.set('searchInput', keyword.trim());
  return search.toString();
}
