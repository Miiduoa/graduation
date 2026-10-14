import { expect, it } from 'vitest';
import {
  buildOfficialLibraryCatalogUrl,
  getOfficialLibrary,
  officialLibraryDirectory,
} from '@campus/shared/src/officialLibraries';

it('keeps official destinations separate by campus and never returns a Providence fallback', () => {
  expect(getOfficialLibrary('pu')?.catalogUrl).toBe('https://webpacx.lib.pu.edu.tw/');
  expect(getOfficialLibrary('ntu')?.catalogUrl).toBe('https://www.lib.ntu.edu.tw/');
  expect(getOfficialLibrary('nthu')?.catalogUrl).toContain('nthu.primo.exlibrisgroup.com');
  expect(getOfficialLibrary('tw-nchu')?.catalogUrl).toContain('nchu.primo.exlibrisgroup.com');
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
  expect(getOfficialLibrary('ntpu')?.catalogUrl).toBe('https://library.ntpu.edu.tw/');
  expect(getOfficialLibrary('tenant-fake', '國立清華大學（校外）')).toBeNull();
});

it('does not attach unverified personal accounts or fabricate a search endpoint', () => {
  const ntu = getOfficialLibrary('ntu')!;
  expect(ntu.accountUrl).toBeUndefined();
  expect(ntu.catalogSearch).toBeUndefined();
  expect(buildOfficialLibraryCatalogUrl('ntu', '資料庫 & SQL')).toBe(ntu.catalogUrl);
  expect(buildOfficialLibraryCatalogUrl('other', '資料庫')).toBeNull();
  expect(buildOfficialLibraryCatalogUrl('pu', '資料庫 & SQL', 'Title')).toBe(
    'https://webpacx.lib.pu.edu.tw/search?searchField=Title&searchInput=%E8%B3%87%E6%96%99%E5%BA%AB+%26+SQL',
  );
});

it('only contains HTTPS university-specific library destinations', () => {
  const officialCatalogVendors: Readonly<Record<string, string>> = {
    nthu: 'nthu.primo.exlibrisgroup.com',
    'tw-nchu': 'nchu.primo.exlibrisgroup.com',
  };
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
      const isUniversityHost = /\.edu\.tw$/.test(parsed.hostname);
      const isApprovedVendor = parsed.hostname === officialCatalogVendors[schoolId];
      expect(isUniversityHost || isApprovedVendor, schoolId).toBe(true);
      if (schoolId !== 'pu') expect(parsed.hostname).not.toContain('.pu.edu.tw');
    }
  }
});

it('opens the verified NTHU and NCHU library services without borrowing another campus identity', () => {
  const nthu = getOfficialLibrary('nthu')!;
  expect(nthu.catalogUrl).toContain('886UST_NTHU');
  expect(nthu.accountUrl).toContain('886UST_NTHU');
  expect(nthu.hoursUrl).toBe('https://www.lib.nthu.edu.tw/use/hours.html');
  expect(nthu.spacesUrl).toBe('https://libsms.lib.nthu.edu.tw/build/');
  expect(getOfficialLibrary('tw-nchu')?.hoursUrl).toBe('https://www.lib.nchu.edu.tw/service.php?cID=35');
  expect(getOfficialLibrary('tw-nchu')?.catalogUrl).toContain('886NCHU_INST');
  expect(getOfficialLibrary('other-campus', '國立中興大學')).toBeNull();
});
