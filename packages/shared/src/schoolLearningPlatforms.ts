import { toPublicSchoolId } from './schoolIds';
import { getPublicSchoolInfo, getSafePublicSchoolWebsiteUrl } from './publicSchoolInfo';

type LearningLink = { label: string; url: string };
type PlatformLink = LearningLink & { provider?: 'tronclass' };
type LearningEntry = {
  kind: 'platform' | 'website';
  schoolName: string;
  links: readonly LearningLink[];
};

// Public destinations confirmed against university LMS or teaching-center pages.
const platforms: Readonly<Record<string, readonly PlatformLink[] | undefined>> = {
  // https://dorac.pu.edu.tw/p/406-1059-45291,r13.php?Lang=zh-tw
  pu: [{ provider: 'tronclass', label: '玩課雲 WOW Class', url: 'https://tronclass.pu.edu.tw/' }],
  ntu: [{ label: 'NTU COOL', url: 'https://cool.ntu.edu.tw/' }],
  // NTHU instructors choose the platform for each course: https://www.nthu.edu.tw/elearning
  nthu: [
    { label: '清大 eLearn', url: 'https://elearn.nthu.edu.tw/' },
    { label: '清大 eeclass', url: 'https://eeclass.nthu.edu.tw/' },
  ],
  ncku: [{ label: '成大 Moodle', url: 'https://moodle.ncku.edu.tw/' }],
  ncnu: [{ label: '暨大 Moodle', url: 'https://moodle.ncnu.edu.tw/' }],
  ncu: [{ label: '中央大學新 ee-class', url: 'https://ncueeclass.ncu.edu.tw/' }],
  nchu: [{ label: '興大 iLearning 3.0', url: 'https://lms2020.nchu.edu.tw/' }],
  // The E3 login page directs enrolled students to this SSO entry: https://e3p.nycu.edu.tw/
  nycu: [{ label: '陽明交大 E3（校園單一入口）', url: 'https://portal.nycu.edu.tw/portal/newe3p' }],
  nkust: [{ label: '高科大教學平台', url: 'https://elearning.nkust.edu.tw/mooc/index.php' }],
  // 東海大學「112年資通安全認知課程操作手冊」p. 2 identifies the iLearn login's TronClass app.
  thu: [{ provider: 'tronclass', label: '東海 iLearn', url: 'https://ilearn.thu.edu.tw/' }],
  // https://cc.fju.edu.tw/ lists elearn2 under 教學服務 → TronClass 教學平台.
  fju: [{ provider: 'tronclass', label: '輔大 TronClass', url: 'https://elearn2.fju.edu.tw/' }],
  // https://ceeweb.ncue.edu.tw/p/412-1008-3988.php
  ncue: [{ provider: 'tronclass', label: '彰化師大雲端學院', url: 'https://tronclass.ncue.edu.tw/' }],
  // 樹德科技大學「113 學年度新生選課手冊」p. 39 specifies the TronClass tenant.
  stu: [{ provider: 'tronclass', label: '樹德 TronClass 創課', url: 'https://tc.stu.edu.tw/' }],
};

/** University-published destination only. Opening it does not connect an account. */
export function getSchoolTronClassEntry(
  schoolId: string | null | undefined,
  schoolName?: string | null,
): LearningLink | null {
  const school = getPublicSchoolInfo(toPublicSchoolId(schoolId), schoolName);
  const link = school && platforms[school.id]?.find(({ provider }) => provider === 'tronclass');
  return link ? { label: link.label, url: link.url } : null;
}

export function getSchoolLearningEntry(
  schoolId: string | null | undefined,
  schoolName?: string | null,
): LearningEntry | null {
  const school = getPublicSchoolInfo(toPublicSchoolId(schoolId), schoolName);
  if (!school) return null;
  const links = platforms[school.id];
  if (links) {
    return {
      kind: 'platform',
      schoolName: school.name,
      links: links.map(({ label, url }) => ({ label, url })),
    };
  }
  const url = getSafePublicSchoolWebsiteUrl(school.websiteUrl);
  return url
    ? { kind: 'website', schoolName: school.name, links: [{ label: school.name + '官網', url }] }
    : null;
}
