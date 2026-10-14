/**
 * Verified public library entrypoints. These are library-controlled websites, not
 * Campus One lending APIs. Library account access remains with each university.
 * Only add a direct catalog/account URL after confirming that exact destination.
 */
import { mockSchools } from './schools';

export type OfficialCampusLibrary = Readonly<{
  name: string;
  websiteUrl: string;
  catalogUrl?: string;
  accountUrl?: string;
}>;

const LIBRARY_DIRECTORY: Readonly<Record<string, OfficialCampusLibrary>> = {
  pu: {
    name: '靜宜大學蓋夏圖書館',
    websiteUrl: 'https://library.pu.edu.tw/',
    catalogUrl: 'https://webpacx.lib.pu.edu.tw/',
    accountUrl: 'https://webpacx.lib.pu.edu.tw/personal/',
  },
  'tw-nchu': {
    name: '國立中興大學圖書館',
    websiteUrl: 'https://www.lib.nchu.edu.tw/',
  },
  nchu: {
    name: '國立中興大學圖書館',
    websiteUrl: 'https://www.lib.nchu.edu.tw/',
  },
  ntu: { name: '國立臺灣大學圖書館', websiteUrl: 'https://www.lib.ntu.edu.tw/' },
  nthu: { name: '國立清華大學圖書館', websiteUrl: 'https://www.lib.nthu.edu.tw/' },
  ncku: { name: '國立成功大學圖書館', websiteUrl: 'https://www.lib.ncku.edu.tw/' },
  nycu: { name: '國立陽明交通大學圖書館', websiteUrl: 'https://lib.nycu.edu.tw/' },
  ncu: { name: '國立中央大學圖書館', websiteUrl: 'https://www.lib.ncu.edu.tw/' },
  nsysu: { name: '國立中山大學圖書與資訊處', websiteUrl: 'https://lis.nsysu.edu.tw/' },
  ntnu: { name: '國立臺灣師範大學圖書館', websiteUrl: 'https://libroot.lib.ntnu.edu.tw/' },
  ntust: { name: '國立臺灣科技大學圖書館', websiteUrl: 'https://library.ntust.edu.tw/' },
  nccu: { name: '國立政治大學圖書館', websiteUrl: 'https://www.lib.nccu.edu.tw/' },
  ncyu: { name: '國立嘉義大學圖書資訊處', websiteUrl: 'https://www.ncyu.edu.tw/lib/' },
  ncue: { name: '國立彰化師範大學圖書與資訊處', websiteUrl: 'https://olis.ncue.edu.tw/' },
  ntpu: { name: '國立臺北大學圖書館', websiteUrl: 'https://library.ntpu.edu.tw/' },
  tmu: { name: '臺北醫學大學圖書館', websiteUrl: 'https://library.tmu.edu.tw/' },
  fju: { name: '輔仁大學圖書館', websiteUrl: 'https://home.lib.fju.edu.tw/TC/index.php/' },
  thu: { name: '東海大學圖書暨資訊處', websiteUrl: 'https://lis.thu.edu.tw/' },
  cgu: { name: '長庚大學圖書館', websiteUrl: 'https://www.cgu.edu.tw/library/' },
  cycu: { name: '中原大學張靜愚紀念圖書館', websiteUrl: 'https://lib.cycu.edu.tw/' },
  scu: { name: '東吳大學圖書館', websiteUrl: 'https://www.lib.scu.edu.tw/' },
  ntub: { name: '國立臺北商業大學圖書館', websiteUrl: 'https://library.ntub.edu.tw/' },
};

/**
 * Public school directories may use their own tenant IDs. An exact official school
 * name is a safe fallback for a public outbound URL; it is never used for login,
 * membership or borrowing data.
 */
export function getOfficialCampusLibrary(
  schoolId: string | null | undefined,
  schoolName?: string | null,
): OfficialCampusLibrary | null {
  if (!schoolId) return null;
  if (Object.prototype.hasOwnProperty.call(LIBRARY_DIRECTORY, schoolId)) {
    return LIBRARY_DIRECTORY[schoolId];
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(schoolId) || !schoolName) return null;
  const exactName = schoolName.trim();
  const matched = mockSchools.find(
    (school) =>
      school.name === exactName &&
      Object.prototype.hasOwnProperty.call(LIBRARY_DIRECTORY, school.id),
  );
  const officialId = matched?.id ?? (exactName === '國立中興大學' ? 'nchu' : null);
  return officialId ? LIBRARY_DIRECTORY[officialId] : null;
}
