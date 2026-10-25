import { mockSchools } from './schools';

export type OfficialLibraryCatalogSearch = 'pu-webpac' | 'primo-ve' | 'webpac-x' | 'sierra';

export type OfficialLibraryService = {
  name: string;
  websiteUrl: string;
  catalogUrl: string;
  catalogSearch?: OfficialLibraryCatalogSearch;
  accountUrl?: string;
  hoursUrl?: string;
  spacesUrl?: string;
  electronicResourcesUrl?: string;
  /** Official searcharg / keyword character limit when shorter than the shared default. */
  catalogQueryMaxLength?: number;
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
    // https://www.ncyu.edu.tw/lib/ - 館藏查詢 / 個人借閱紀錄
    catalogUrl: 'https://libaleph.ncyu.edu.tw/F',
    accountUrl: 'https://libaleph.ncyu.edu.tw/F',
    hoursUrl: 'https://www.ncyu.edu.tw/lib/Contents?nodeId=41764',
    electronicResourcesUrl: 'https://ncyu.summon.serialssolutions.com/za-CN/',
  },
  ncue: {
    name: '國立彰化師範大學圖書與資訊處',
    websiteUrl: 'https://olis.ncue.edu.tw/',
    // Verified 2026-10-24: WebPACX search?searchInput=&searchField=
    catalogUrl: 'https://webpacx.ncue.edu.tw/',
    catalogSearch: 'webpac-x',
  },
  ntpu: {
    name: '國立臺北大學圖書館',
    websiteUrl: 'https://library.ntpu.edu.tw/',
    // https://library.ntpu.edu.tw/ - official catalog and personal borrowing links
    catalogUrl: 'https://wpac.lib.ntpu.edu.tw/webpac/search.cfm',
    accountUrl: 'https://wpac.lib.ntpu.edu.tw/webpac/search.cfm?type=shelf_user',
    hoursUrl: 'https://library.ntpu.edu.tw/singlehtml/70dcb2e4549c413eb3d533f3b1e54dbe?cntId=f130dcaa5d424ae5911a14b81856d706',
    spacesUrl: 'https://ireserve.lib.ntpu.edu.tw/sm/home_web.do',
    electronicResourcesUrl: 'https://erm.library.ntpu.edu.tw/',
  },
  tmu: {
    name: '臺北醫學大學圖書館',
    websiteUrl: 'https://library.tmu.edu.tw/',
    // https://library.tmu.edu.tw/Forms/Form0200/Form0200.aspx - resource system guide
    catalogUrl: 'https://libelis.tmu.edu.tw/webpacIndex.jsp',
    hoursUrl: 'https://library.tmu.edu.tw/Forms/Form0102/Form0102.aspx',
    electronicResourcesUrl: 'https://jumper.tmu.edu.tw/',
  },
  fju: {
    name: '輔仁大學圖書館',
    websiteUrl: 'https://home.lib.fju.edu.tw/',
    // https://home.lib.fju.edu.tw/TC/webpac submits a GET search to this Sierra scope.
    catalogUrl: 'https://library.lib.fju.edu.tw:444/search~S0*cht/',
    catalogSearch: 'sierra',
    accountUrl: 'https://library.lib.fju.edu.tw:444/patroninfo*cht',
    catalogQueryMaxLength: 75,
  },
  thu: {
    name: '東海大學圖書暨資訊處',
    websiteUrl: 'https://lis.thu.edu.tw/',
    // Verified 2026-10-24: WebPACX search?searchInput=&searchField=
    catalogUrl: 'https://webpac.lib.thu.edu.tw/',
    catalogSearch: 'webpac-x',
  },
  cgu: {
    name: '長庚大學圖書館',
    websiteUrl: 'https://www.cgu.edu.tw/library/',
    // https://www.cgu.edu.tw/library/ - 館藏查詢系統 / 館藏總覽
    catalogUrl: 'https://web20.lib.cgu.edu.tw/',
    hoursUrl: 'https://www.cgu.edu.tw/library/Contents?nodeId=7401',
  },
  cycu: {
    name: '中原大學張靜愚紀念圖書館',
    websiteUrl: 'https://lib.cycu.edu.tw/',
    // https://lib.cycu.edu.tw/ - official catalog and personal loan lookup
    catalogUrl: 'https://cylis.lib.cycu.edu.tw/search*cht',
    accountUrl: 'https://cylis.lib.cycu.edu.tw/patroninfo*cht',
  },
  scu: {
    name: '東吳大學圖書館',
    websiteUrl: 'https://www.lib.scu.edu.tw/',
    // https://www.lib.scu.edu.tw/ - 館藏查詢
    catalogUrl: 'https://uco-scu.primo.exlibrisgroup.com/discovery/search?lang=zh-tw&vid=886UCO_SCU%3A886SCU_INST',
    catalogSearch: 'primo-ve',
    hoursUrl: 'https://www.lib.scu.edu.tw/CMS/Page/12',
  },
  ntub: {
    name: '國立臺北商業大學圖書館',
    websiteUrl: 'https://library.ntub.edu.tw/wSite/mp?mp=1',
    // Verified 2026-10-24: WebPACX search?searchInput=&searchField=
    catalogUrl: 'https://webpacx.ntub.edu.tw/',
    catalogSearch: 'webpac-x',
  },
  'tw-nchu': {
    name: '國立中興大學圖書館',
    websiteUrl: 'https://www.lib.nchu.edu.tw/',
    catalogUrl: 'https://nchu.primo.exlibrisgroup.com/discovery/search?tab=LibraryCatalog&search_scope=MyInstitution&vid=886NCHU_INST%3A886NCHU_INST&lang=zh-tw&offset=0',
    catalogSearch: 'primo-ve',
    hoursUrl: 'https://www.lib.nchu.edu.tw/service.php?cID=35',
  },
};

const DEFAULT_CATALOG_QUERY_MAX_LENGTH = 200;

/** True when keyword handoff builds a verified deep-link search URL. */
export function hasVerifiedCatalogSearch(
  library: OfficialLibraryService | null | undefined,
): library is OfficialLibraryService & { catalogSearch: OfficialLibraryCatalogSearch } {
  return (
    library?.catalogSearch === 'primo-ve' ||
    library?.catalogSearch === 'webpac-x' ||
    library?.catalogSearch === 'sierra'
  );
}

export function getOfficialLibraryCatalogQueryMaxLength(
  library: OfficialLibraryService | null | undefined,
): number {
  return library?.catalogQueryMaxLength ?? DEFAULT_CATALOG_QUERY_MAX_LENGTH;
}

function normalizeCatalogQuery(keyword: string, maxLength: number): string {
  return keyword.trim().replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
}

/** Map shared UI field names to WebPACX searchField values (ncue / ntub / thu). */
function mapWebpacXSearchField(field: string): string {
  switch (field) {
    case 'Title':
      return 'TI';
    case 'Author':
      return 'PN';
    case 'Subject':
      return 'SU';
    case 'ISBN':
      return 'ISBN';
    case 'FullText':
      return 'FullText';
    default:
      return 'FullText';
  }
}

/** Map shared UI field names to Fu Jen Sierra searchtype values. */
function mapSierraSearchType(field: string): string {
  switch (field) {
    case 'Title':
      return 't';
    case 'Author':
      return 'a';
    case 'Subject':
      return 'd';
    case 'ISBN':
      return 'i';
    case 'FullText':
      return 'Y';
    default:
      return 'Y';
  }
}

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
  const maxLength = getOfficialLibraryCatalogQueryMaxLength(library);
  const query = normalizeCatalogQuery(keyword, maxLength);
  if (!query) return library.catalogUrl;
  if (library.catalogSearch === 'pu-webpac') {
    const search = new URL('search', library.catalogUrl);
    search.searchParams.set('searchField', field);
    search.searchParams.set('searchInput', query);
    return search.toString();
  }
  if (library.catalogSearch === 'webpac-x') {
    const search = new URL('search', library.catalogUrl);
    search.searchParams.set('searchInput', query);
    search.searchParams.set('searchField', mapWebpacXSearchField(field));
    return search.toString();
  }
  if (library.catalogSearch === 'sierra') {
    const search = new URL(library.catalogUrl);
    search.searchParams.set('searchtype', mapSierraSearchType(field));
    search.searchParams.set('searcharg', query);
    search.searchParams.set('SORT', 'D');
    search.searchParams.set('extended', '0');
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
