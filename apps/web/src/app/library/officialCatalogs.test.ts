import { describe, expect, it } from 'vitest';
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
    expect(buildOfficialLibraryCatalogUrl('ncue', '資料庫')).toBe(
      'https://webpacx.ncue.edu.tw/',
    );
    expect(buildOfficialLibraryCatalogUrl('cgu', '資料庫')).toBe('https://web20.lib.cgu.edu.tw/');
    expect(buildOfficialLibraryCatalogUrl('ncyu', '資料庫')).toBe('https://libaleph.ncyu.edu.tw/F');
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
