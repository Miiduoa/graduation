import { mockSchools } from './schools';

export type OfficialLibraryService = {
  name: string;
  websiteUrl: string;
  catalogUrl: string;
  catalogSearch?: 'pu-webpac' | 'primo-ve';
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
    // https://www.lib.ntu.edu.tw/node/981
    catalogUrl: 'https://ntu.primo.exlibrisgroup.com/discovery/search?tab=LibraryCatalog&search_scope=MyInstitution&vid=886NTU_INST:886NTU_INST&lang=zh-tw&offset=0',
    catalogSearch: 'primo-ve',
    accountUrl: 'https://ntu.primo.exlibrisgroup.com/discovery/account?lang=zh-tw&vid=886NTU_INST:886NTU_INST',
    hoursUrl: 'https://www.lib.ntu.edu.tw/hours',
  },
  nthu: {
    name: '國立清華大學圖書館',
    websiteUrl: 'https://www.lib.nthu.edu.tw/',
    // https://libstat.ncl.edu.tw/libraryDataDetail/L4584000
    catalogUrl: 'https://nthu.primo.exlibrisgroup.com/discovery/search?vid=886UST_NTHU:886UST_NTHU',
    catalogSearch: 'primo-ve',
    accountUrl: 'https://nthu.primo.exlibrisgroup.com/discovery/account?section=overview&vid=886UST_NTHU:886UST_NTHU',
    hoursUrl: 'https://www.lib.nthu.edu.tw/use/hours.html',
    spacesUrl: 'https://libsms.lib.nthu.edu.tw/build/',
  },
  ncku: {
    name: '國立成功大學圖書館',
    websiteUrl: 'https://www.lib.ncku.edu.tw/',
    // https://libstat.ncl.edu.tw/libraryDataDetail/L4602000
    catalogUrl: 'https://ncku.primo.exlibrisgroup.com/discovery/search?vid=886NCKU_INST:886NCKU_INST&lang=zh-tw',
    catalogSearch: 'primo-ve',
    accountUrl: 'https://ncku.primo.exlibrisgroup.com/discovery/account?lang=zh-tw&section=overview&vid=886NCKU_INST:886NCKU_INST',
    hoursUrl: 'https://www.lib.ncku.edu.tw/service/access/openhours.php',
    spacesUrl: 'https://space.lib.ncku.edu.tw/',
  },
  nycu: {
    name: '國立陽明交通大學圖書館',
    websiteUrl: 'https://lib.nycu.edu.tw/',
    // https://libstat.ncl.edu.tw/libraryDataDetail/L4583000
    catalogUrl: 'https://nycu.primo.exlibrisgroup.com/discovery/search?vid=886UST_NYCU:886UST_NYCU&lang=zh-tw',
    catalogSearch: 'primo-ve',
    accountUrl: 'https://nycu.primo.exlibrisgroup.com/discovery/account?section=overview&vid=886UST_NYCU:886UST_NYCU',
  },
  ncu: {
    name: '國立中央大學圖書館',
    websiteUrl: 'https://www.lib.ncu.edu.tw/',
    // https://www.lib.ncu.edu.tw/libboard/news_content.php?NewsID=6368
    catalogUrl: 'https://ncu.primo.exlibrisgroup.com/discovery/search?vid=886UST_NCU:886UST_NCU',
    catalogSearch: 'primo-ve',
    hoursUrl: 'https://www.lib.ncu.edu.tw/open/hours_ca.php',
  },
  nsysu: {
    name: '國立中山大學圖書與資訊處',
    websiteUrl: 'https://lis.nsysu.edu.tw/',
    // https://lis.nsysu.edu.tw/p/412-1001-17833.php?Lang=zh-tw
    catalogUrl: 'https://nsysu.primo.exlibrisgroup.com/discovery/search?tab=LibraryCatalog&search_scope=MyInstitution&vid=886NSYSU_INST:886NSYSU_INST&lang=zh-tw&offset=0',
    catalogSearch: 'primo-ve',
  },
  ntnu: {
    name: '國立臺灣師範大學圖書館',
    websiteUrl: 'https://www.lib.ntnu.edu.tw/',
    // https://opac.lib.ntnu.edu.tw/
    catalogUrl: 'https://opac.lib.ntnu.edu.tw/',
  },
  ntust: {
    name: '國立臺灣科技大學圖書館',
    websiteUrl: 'https://library.ntust.edu.tw/?Lang=zh-tw',
    catalogUrl: 'https://sierra.lib.ntust.edu.tw/%2Acht',
  },
  nccu: {
    name: '國立政治大學圖書館',
    websiteUrl: 'https://www.lib.nccu.edu.tw/',
    // https://freshmen.nccu.edu.tw/web/newborn/newborn_in.jsp?cp_id=CP1629415765258
    catalogUrl: 'https://nccu.primo.exlibrisgroup.com/discovery/search?vid=886NCCU_INST:886NCCU_INST&lang=zh-tw',
    catalogSearch: 'primo-ve',
    accountUrl: 'https://nccu.primo.exlibrisgroup.com/discovery/account?vid=886NCCU_INST:886NCCU_INST&section=overview&lang=zh-tw',
    spacesUrl: 'https://rbs.lib.nccu.edu.tw/nccuroom/conew/co_enter',
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
    catalogUrl: 'https://library.ntpu.edu.tw/',
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
  // A visible school name alone does not prove tenant identity. Old page state
  // can retain the previous university name while its new campus ID changes.
  // For an unrecognized tenant, require both its official name AND a complete,
  // unambiguous school code token within the directory tenant ID.
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,118}[a-z0-9])?$/.test(schoolId) || !schoolName) return null;
  const exactName = schoolName.trim();
  const matches = mockSchools.filter(
    (school) =>
      school.name === exactName &&
      Object.prototype.hasOwnProperty.call(officialLibraryDirectory, school.id),
  );
  const libraryId =
    matches.length === 1 ? matches[0].id : exactName === '國立中興大學' ? 'tw-nchu' : null;
  if (!libraryId) return null;
  const aliases = libraryId === 'tw-nchu' ? ['tw-nchu', 'nchu'] : [libraryId];
  if (
    !aliases.some(
      (alias) =>
        schoolId === alias ||
        schoolId.startsWith(`${alias}-`) ||
        schoolId.endsWith(`-${alias}`) ||
        schoolId.includes(`-${alias}-`),
    )
  ) return null;
  return officialLibraryDirectory[libraryId];
}

export function buildOfficialLibraryCatalogUrl(
  schoolId: string,
  keyword: string,
  field = 'FullText',
  schoolName?: string | null,
): string | null {
  const library = getOfficialLibrary(schoolId, schoolName);
  if (!library) return null;
  const query = keyword.trim().replace(/[\r\n\t]+/g, ' ').slice(0, 200);
  if (!query) return library.catalogUrl;
  if (library.catalogSearch === 'pu-webpac') {
    const search = new URL('search', library.catalogUrl);
    search.searchParams.set('searchField', field);
    search.searchParams.set('searchInput', query);
    return search.toString();
  }
  if (library.catalogSearch === 'primo-ve') {
    // Keep each university’s verified discovery view; never use another school's view ID.
    const search = new URL(library.catalogUrl);
    search.searchParams.set('query', `any,contains,${query.replace(/,/g, ' ')}`);
    return search.toString();
  }
  return library.catalogUrl;
}
