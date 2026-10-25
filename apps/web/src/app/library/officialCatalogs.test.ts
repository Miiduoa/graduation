import { describe, expect, it } from 'vitest';
import { mockSchools } from '@campus/shared/src/schools';
import { isPlaceholderAnnouncementSchool } from '@campus/shared/src/campusAnnouncements';
import {
  buildOfficialLibraryCatalogUrl,
  getOfficialLibrary,
  officialLibraryDirectory,
} from '@campus/shared/src/officialLibraries';

const primoSchools: Record<string, string> = {
  ntu: '886NTU_INST:886NTU_INST',
  nthu: '886UST_NTHU:886UST_NTHU',
  ncku: '886NCKU_INST:886NCKU_INST',
  nycu: '886UST_NYCU:886UST_NYCU',
  ncu: '886UST_NCU:886UST_NCU',
  nsysu: '886NSYSU_INST:886NSYSU_INST',
  nccu: '886NCCU_INST:886NCCU_INST',
  scu: '886UCO_SCU:886SCU_INST',
};

describe('official library catalog destinations', () => {
  it.each(Object.entries(primoSchools))(
    '%s searches only its own Primo VE institution view',
    (schoolId, viewId) => {
      const library = getOfficialLibrary(schoolId);
      expect(library?.catalogSearch).toBe('primo-ve');
      const home = new URL(library!.catalogUrl);
      const result = new URL(buildOfficialLibraryCatalogUrl(schoolId, ' 資料庫 & AI ' )!);
      expect(result.origin).toBe(home.origin);
      expect(result.pathname).toBe('/discovery/search');
      expect(result.searchParams.get('vid')).toBe(viewId);
      expect(result.searchParams.get('query')).toBe('any,contains,資料庫 & AI');
      expect(result.searchParams.get('tab')).toBe(home.searchParams.get('tab'));
      expect(result.searchParams.get('search_scope')).toBe(home.searchParams.get('search_scope'));
      expect(result.searchParams.get('query')).not.toContain('pu');
    },
  );

  it('keeps Providence WebPac search fields and never redirects to another school', () => {
    const result = new URL(buildOfficialLibraryCatalogUrl('pu', ' R&D & SQL ', 'Title')!);
    expect(result.origin).toBe('https://webpacx.lib.pu.edu.tw');
    expect(result.searchParams.get('searchField')).toBe('Title');
    expect(result.searchParams.get('searchInput')).toBe('R&D & SQL');
  });

  it('uses verified official catalog roots when query deep links are not supported', () => {
    expect(buildOfficialLibraryCatalogUrl('ntnu', '資料庫')).toBe(
      'https://opac.lib.ntnu.edu.tw/',
    );
    expect(buildOfficialLibraryCatalogUrl('cgu', '資料庫')).toBe('https://web20.lib.cgu.edu.tw/');
    expect(buildOfficialLibraryCatalogUrl('ncyu', '資料庫')).toBe('https://libaleph.ncyu.edu.tw/F');
    expect(buildOfficialLibraryCatalogUrl('ntpu', '資料庫')).toBe('https://wpac.lib.ntpu.edu.tw/webpac/search.cfm');
    expect(buildOfficialLibraryCatalogUrl('tmu', '資料庫')).toBe('https://libelis.tmu.edu.tw/webpacIndex.jsp');
    expect(buildOfficialLibraryCatalogUrl('cycu', '資料庫')).toBe('https://cylis.lib.cycu.edu.tw/search*cht');
  });

  const webpacXSchools: Record<string, string> = {
    ncue: 'https://webpacx.ncue.edu.tw/',
    ntub: 'https://webpacx.ntub.edu.tw/',
    thu: 'https://webpac.lib.thu.edu.tw/',
  };

  it.each(Object.entries(webpacXSchools))(
    '%s builds WebPACX search on its own host with translated fields',
    (schoolId, catalogRoot) => {
      const library = getOfficialLibrary(schoolId);
      expect(library?.catalogSearch).toBe('webpac-x');
      expect(library?.catalogUrl).toBe(catalogRoot);
      const home = new URL(catalogRoot);
      const result = new URL(buildOfficialLibraryCatalogUrl(schoolId, ' 資料庫 & SQL ', 'Title')!);
      expect(result.origin).toBe(home.origin);
      expect(result.pathname).toBe('/search');
      expect(result.searchParams.get('searchField')).toBe('TI');
      expect(result.searchParams.get('searchInput')).toBe('資料庫 & SQL');
      expect(result.searchParams.get('searchField')).not.toBe('Title');
      expect(buildOfficialLibraryCatalogUrl(schoolId, '  ', 'Author')).toBe(catalogRoot);
      expect(new URL(buildOfficialLibraryCatalogUrl(schoolId, 'x', 'Author')!).searchParams.get('searchField')).toBe('PN');
      expect(new URL(buildOfficialLibraryCatalogUrl(schoolId, 'x', 'Subject')!).searchParams.get('searchField')).toBe('SU');
      expect(new URL(buildOfficialLibraryCatalogUrl(schoolId, 'x', 'ISBN')!).searchParams.get('searchField')).toBe('ISBN');
      expect(new URL(buildOfficialLibraryCatalogUrl(schoolId, 'x', 'Unknown')!).searchParams.get('searchField')).toBe('FullText');
    },
  );

  it('builds Fu Jen Sierra search with verified scope and field codes', () => {
    const library = getOfficialLibrary('fju');
    expect(library?.catalogSearch).toBe('sierra');
    expect(library?.catalogUrl).toBe('https://library.lib.fju.edu.tw:444/search~S0*cht/');
    expect(library?.accountUrl).toBe('https://library.lib.fju.edu.tw:444/patroninfo*cht');
    expect(library?.catalogQueryMaxLength).toBe(75);
    const result = new URL(buildOfficialLibraryCatalogUrl('fju', ' 資料庫 & SQL ', 'Title')!);
    expect(result.origin).toBe('https://library.lib.fju.edu.tw:444');
    expect(result.pathname).toBe('/search~S0*cht/');
    expect(result.searchParams.get('searchtype')).toBe('t');
    expect(result.searchParams.get('searcharg')).toBe('資料庫 & SQL');
    expect(result.searchParams.get('SORT')).toBe('D');
    expect(result.searchParams.get('extended')).toBe('0');
    expect(new URL(buildOfficialLibraryCatalogUrl('fju', 'x', 'Author')!).searchParams.get('searchtype')).toBe('a');
    expect(new URL(buildOfficialLibraryCatalogUrl('fju', 'x', 'Subject')!).searchParams.get('searchtype')).toBe('d');
    expect(new URL(buildOfficialLibraryCatalogUrl('fju', 'x', 'ISBN')!).searchParams.get('searchtype')).toBe('i');
    expect(new URL(buildOfficialLibraryCatalogUrl('fju', 'x', 'Nope')!).searchParams.get('searchtype')).toBe('Y');
    expect(buildOfficialLibraryCatalogUrl('fju', '\n\t', 'FullText')).toBe(library!.catalogUrl);
    const long = '字'.repeat(90);
    expect(new URL(buildOfficialLibraryCatalogUrl('fju', long)!).searchParams.get('searcharg')).toHaveLength(75);
  });

  it('does not route an unknown campus into Providence or other schools', () => {
    expect(getOfficialLibrary('some-other-university', '國立清華大學')).toBeNull();
    expect(buildOfficialLibraryCatalogUrl('some-other-university', '資料庫')).toBeNull();
    expect(buildOfficialLibraryCatalogUrl('all', '資料庫')).toBeNull();
  });

  it('preserves the official school identity for validated tenant aliases', () => {
    const url = buildOfficialLibraryCatalogUrl('campus-nthu-2026', '資料庫', 'FullText', '國立清華大學');
    expect(new URL(url!).searchParams.get('vid')).toBe('886UST_NTHU:886UST_NTHU');
    expect(buildOfficialLibraryCatalogUrl('campus-nthu-2026', '資料庫', 'FullText', '靜宜大學')).toBeNull();
  });

  it('allows only secure HTTPS official destinations', () => {
    for (const library of Object.values(officialLibraryDirectory)) {
      for (const value of [library.websiteUrl, library.catalogUrl, library.accountUrl, library.hoursUrl, library.spacesUrl, library.electronicResourcesUrl]) {
        if (value) expect(new URL(value).protocol).toBe('https:');
      }
    }
  });
});


describe('bundled campus library completeness', () => {
  it('provides a campus-specific catalog for every public university in the built-in directory', () => {
    const officialSchools = mockSchools.filter(
      (school) =>
        !isPlaceholderAnnouncementSchool({ schoolId: school.id }) &&
        !school.name.includes('（示範）'),
    );
    expect(officialSchools.length).toBeGreaterThanOrEqual(21);
    for (const school of officialSchools) {
      const library = getOfficialLibrary(school.id, school.name);
      expect(library, `Missing official library for ${school.id}`).not.toBeNull();
      expect(library!.catalogUrl, school.id).not.toBe(library!.websiteUrl);
      const catalog = new URL(library!.catalogUrl);
      expect(catalog.protocol, school.id).toBe('https:');
      if (school.id !== 'pu') expect(catalog.hostname).not.toContain('.lib.pu.edu.tw');
    }
  });
});
