import { toPublicSchoolId } from './schoolIds';
import { getPublicSchoolInfo, getSafePublicSchoolWebsiteUrl } from './publicSchoolInfo';

type LearningLink = { label: string; url: string };
type LearningEntry = {
  kind: 'platform' | 'website';
  schoolName: string;
  links: readonly LearningLink[];
};

// Public destinations confirmed against university LMS or teaching-center pages on 2026-11-06.
const platforms: Readonly<Record<string, readonly LearningLink[] | undefined>> = {
  pu: [{ label: '玩課雲 WOW Class', url: 'https://tronclass.pu.edu.tw/' }],
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
  thu: [{ label: '東海 iLearn', url: 'https://ilearn.thu.edu.tw/' }],
  fju: [{ label: '輔大 TronClass', url: 'https://elearn2.fju.edu.tw/' }],
};

export function getSchoolLearningEntry(
  schoolId: string | null | undefined,
  schoolName?: string | null,
): LearningEntry | null {
  const school = getPublicSchoolInfo(toPublicSchoolId(schoolId), schoolName);
  if (!school) return null;
  const links = platforms[school.id];
  if (links) return { kind: 'platform', schoolName: school.name, links };
  const url = getSafePublicSchoolWebsiteUrl(school.websiteUrl);
  return url
    ? { kind: 'website', schoolName: school.name, links: [{ label: school.name + '官網', url }] }
    : null;
}
