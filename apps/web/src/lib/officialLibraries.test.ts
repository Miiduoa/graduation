import { expect, it } from 'vitest';
import {
  buildOfficialLibraryCatalogUrl,
  getOfficialLibrary,
  officialLibraryDirectory,
} from '@campus/shared/src/officialLibraries';

it('keeps official destinations separate by campus and never returns a Providence fallback', () => {
  expect(getOfficialLibrary('pu')?.catalogUrl).toBe('https://webpacx.lib.pu.edu.tw/');
  expect(new URL(getOfficialLibrary('ntu')!.catalogUrl).hostname).toBe('ntu.primo.exlibrisgroup.com');
  expect(new URL(getOfficialLibrary('nthu')!.catalogUrl).hostname).toBe('nthu.primo.exlibrisgroup.com');
  expect(getOfficialLibrary('ncue')?.catalogUrl).toBe('https://webpacx.ncue.edu.tw/');
  expect(getOfficialLibrary('tw-demo-uni')).toBeNull();
  expect(getOfficialLibrary('tw-taichung-uni-a')).toBeNull();
  expect(getOfficialLibrary('other')).toBeNull();
  expect(getOfficialLibrary('__proto__')).toBeNull();
  expect(getOfficialLibrary(null)).toBeNull();
  expect(getOfficialLibrary('tenant-nthu', '國立清華大學')?.catalogUrl).toBe(
    getOfficialLibrary('nthu')?.catalogUrl,
  );
  expect(getOfficialLibrary('platform-campus-42', '國立清華大學')).toBeNull();
  expect(getOfficialLibrary('other', '靜宜大學')).toBeNull();
  expect(getOfficialLibrary('remote-nthu-campus', '國立清華大學')?.catalogUrl).toBe(
    getOfficialLibrary('nthu')?.catalogUrl,
  );
  expect(getOfficialLibrary('platform-campus-42', '清華大學')).toBeNull();
  expect(getOfficialLibrary('../pu', '國立清華大學')).toBeNull();
  expect(getOfficialLibrary('ntpu')?.catalogUrl).toBe('https://wpac.lib.ntpu.edu.tw/webpac/search.cfm');
  expect(getOfficialLibrary('tenant-fake', '國立清華大學（校外）')).toBeNull();
});

it('does not attach unverified personal accounts or fabricate a search endpoint', () => {
  const ntu = getOfficialLibrary('ntu')!;
  expect(ntu.accountUrl).toContain('ntu.primo.exlibrisgroup.com/discovery/account');
  expect(ntu.catalogSearch).toBe('primo-ve');
  const link = new URL(buildOfficialLibraryCatalogUrl('ntu', '資料庫 & SQL')!);
  expect(link.hostname).toBe('ntu.primo.exlibrisgroup.com');
  expect(link.searchParams.get('vid')).toBe('886NTU_INST:886NTU_INST');
  expect(link.searchParams.get('query')).toBe('any,contains,資料庫 & SQL');
  expect(getOfficialLibrary('ntnu')?.accountUrl).toBeUndefined();
  expect(buildOfficialLibraryCatalogUrl('ntnu', '資料庫')).toBe('https://opac.lib.ntnu.edu.tw/');
  expect(buildOfficialLibraryCatalogUrl('other', '資料庫')).toBeNull();
  expect(buildOfficialLibraryCatalogUrl('pu', '資料庫 & SQL', 'Title')).toBe(
    'https://webpacx.lib.pu.edu.tw/search?searchField=Title&searchInput=%E8%B3%87%E6%96%99%E5%BA%AB+%26+SQL',
  );
});

it('only contains HTTPS university-specific library destinations', () => {
  const entries = Object.entries(officialLibraryDirectory);
  expect(entries.length).toBeGreaterThanOrEqual(20);
  for (const [schoolId, library] of entries) {
    for (const url of [
      library.websiteUrl,
      library.catalogUrl,
      library.accountUrl,
      library.hoursUrl,
      library.spacesUrl,
      library.electronicResourcesUrl,
    ].filter(Boolean) as string[]) {
      const parsed = new URL(url);
      expect(parsed.protocol, schoolId).toBe('https:');
      if (parsed.hostname.endsWith('.primo.exlibrisgroup.com')) {
        // Primo VE is a university-managed catalog hosted under Ex Libris.
        expect(parsed.hostname, schoolId).toBe(
          `${schoolId === 'tw-nchu' ? 'nchu' : schoolId === 'scu' ? 'uco-scu' : schoolId}.primo.exlibrisgroup.com`,
        );
      } else if (schoolId === 'ncyu' && parsed.hostname === 'ncyu.summon.serialssolutions.com') {
        expect(parsed.hostname).toBe('ncyu.summon.serialssolutions.com');
      } else {
        expect(parsed.hostname, schoolId).toMatch(/\.edu\.tw$/);
      }
      if (schoolId !== 'pu') expect(parsed.hostname).not.toContain('.pu.edu.tw');
    }
  }
});

it('keeps NCHU and NTHU official services scoped to their own universities', () => {
  const nthu = getOfficialLibrary('nthu')!;
  const nchu = getOfficialLibrary('tw-nchu')!;
  expect(nthu.catalogUrl).toContain('886UST_NTHU');
  expect(nthu.accountUrl).toContain('886UST_NTHU');
  expect(nthu.hoursUrl).toBe('https://www.lib.nthu.edu.tw/use/hours.html');
  expect(nthu.spacesUrl).toBe('https://libsms.lib.nthu.edu.tw/build/');
  expect(nchu.catalogUrl).toContain('886NCHU_INST');
  expect(nchu.hoursUrl).toBe('https://www.lib.nchu.edu.tw/service.php?cID=35');
  expect(getOfficialLibrary('unrecognized-campus', '國立中興大學')).toBeNull();
  const url = new URL(buildOfficialLibraryCatalogUrl('tw-nchu', '資管')!);
  expect(url.hostname).toBe('nchu.primo.exlibrisgroup.com');
  expect(url.searchParams.get('query')).toBe('any,contains,資管');
});


it('keeps Taipei University, TMU and CYCU official borrowing services separate', () => {
  const ntpu = getOfficialLibrary('ntpu')!;
  const tmu = getOfficialLibrary('tmu')!;
  const cycu = getOfficialLibrary('cycu')!;
  expect(ntpu.accountUrl).toBe('https://wpac.lib.ntpu.edu.tw/webpac/search.cfm?type=shelf_user');
  expect(ntpu.spacesUrl).toBe('https://ireserve.lib.ntpu.edu.tw/sm/home_web.do');
  expect(ntpu.electronicResourcesUrl).toBe('https://erm.library.ntpu.edu.tw/');
  expect(tmu.catalogUrl).toBe('https://libelis.tmu.edu.tw/webpacIndex.jsp');
  expect(tmu.electronicResourcesUrl).toBe('https://jumper.tmu.edu.tw/');
  expect(tmu.accountUrl).toBeUndefined();
  expect(cycu.catalogUrl).toBe('https://cylis.lib.cycu.edu.tw/search*cht');
  expect(cycu.accountUrl).toBe('https://cylis.lib.cycu.edu.tw/patroninfo*cht');
  for (const schoolId of ['ntpu', 'tmu', 'cycu']) {
    expect(buildOfficialLibraryCatalogUrl(schoolId, '資管課程')).toBe(getOfficialLibrary(schoolId)!.catalogUrl);
    expect(buildOfficialLibraryCatalogUrl(schoolId, '資管課程')).not.toContain('webpacx.lib.pu.edu.tw');
  }
});

it('hands NCUE, NTUB and THU queries to each school WebPACX host', () => {
  for (const [schoolId, host] of [
    ['ncue', 'webpacx.ncue.edu.tw'],
    ['ntub', 'webpacx.ntub.edu.tw'],
    ['thu', 'webpac.lib.thu.edu.tw'],
  ] as const) {
    const url = new URL(buildOfficialLibraryCatalogUrl(schoolId, '資料庫 #1, a=b')!);
    expect(url.hostname).toBe(host);
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('searchInput')).toBe('資料庫 #1, a=b');
    expect(url.searchParams.get('searchField')).toBe('FullText');
    expect(url.href).not.toContain('webpacx.lib.pu.edu.tw');
  }
});

it('hands Fu Jen queries to its Sierra catalog with the 75-character limit', () => {
  const fju = getOfficialLibrary('fju')!;
  expect(fju.catalogSearch).toBe('sierra');
  expect(fju.websiteUrl).toBe('https://home.lib.fju.edu.tw/');
  const url = new URL(buildOfficialLibraryCatalogUrl('fju', '資料庫 & SQL')!);
  expect(url.hostname).toBe('library.lib.fju.edu.tw');
  expect(url.port).toBe('444');
  expect(url.pathname).toBe('/search~S0*cht/');
  expect(url.searchParams.get('searchtype')).toBe('Y');
  expect(url.searchParams.get('searcharg')).toBe('資料庫 & SQL');
  expect(buildOfficialLibraryCatalogUrl('fju', '')).toBe(fju.catalogUrl);
});
