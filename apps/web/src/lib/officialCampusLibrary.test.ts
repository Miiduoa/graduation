import { describe, expect, it } from 'vitest';
import { getOfficialCampusLibrary } from '@campus/shared/src/libraryDirectory';

describe('official library directory', () => {
  it('resolves each school to its own HTTPS library site, never the previous campus', () => {
    const pairs: Array<[string, string]> = [
      ['pu', 'library.pu.edu.tw'],
      ['ntu', 'www.lib.ntu.edu.tw'],
      ['nthu', 'www.lib.nthu.edu.tw'],
      ['ncku', 'www.lib.ncku.edu.tw'],
      ['nycu', 'lib.nycu.edu.tw'],
      ['ncu', 'www.lib.ncu.edu.tw'],
      ['nsysu', 'lis.nsysu.edu.tw'],
      ['nccu', 'www.lib.nccu.edu.tw'],
      ['thu', 'lis.thu.edu.tw'],
      ['ntub', 'library.ntub.edu.tw'],
      ['tw-nchu', 'www.lib.nchu.edu.tw'],
    ];
    for (const [school, hostname] of pairs) {
      const destination = getOfficialCampusLibrary(school);
      expect(new URL(destination!.websiteUrl).hostname).toBe(hostname);
      expect(new URL(destination!.websiteUrl).protocol).toBe('https:');
    }
  });

  it('does not turn unverified, inherited or prototype IDs into library links', () => {
    for (const id of ['tw-demo-uni', 'tw-taichung-uni-a', 'toString', '__proto__', '', 'PU', '../pu']) {
      expect(getOfficialCampusLibrary(id)).toBeNull();
    }
    expect(getOfficialCampusLibrary(null)).toBeNull();
  });

  it('allows direct catalogue and account links only where configured', () => {
    const pu = getOfficialCampusLibrary('pu')!;
    const nthu = getOfficialCampusLibrary('nthu')!;
    expect(pu.catalogUrl).toBe('https://webpacx.lib.pu.edu.tw/');
    expect(pu.accountUrl).toBe('https://webpacx.lib.pu.edu.tw/personal/');
    expect(nthu.catalogUrl).toBeUndefined();
    expect(nthu.accountUrl).toBeUndefined();
  });
});
