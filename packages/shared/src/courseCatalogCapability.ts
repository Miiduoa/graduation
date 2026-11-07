import { findSchoolById } from './schools';
import { isProvidenceSchoolId, toPublicSchoolId } from './schoolIds';
import { resolveSchoolPublicServices } from './schoolPublicServices';

/**
 * In-app integrated course catalog providers.
 * Unknown schools have no provider — do not invent semesters, buildings, or filters.
 * Public course links are verified separately;
 * those links are not evidence of private academic / in-app catalog capability.
 */
export type CourseCatalogProviderId = 'pu-mypu' | 'ncnu-public';

export type CourseCatalogCapability = {
  providerId: CourseCatalogProviderId;
  /** Canonical public school id (e.g. `pu`). */
  schoolId: string;
  label: string;
  officialQueryUrl: string;
};

/** In-app myPU CourseCatalogSys API (native integrated provider). */
const PU_INTEGRATED_CATALOG_URL =
  'https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/';

const INTEGRATED_CATALOG_BY_PUBLIC_ID = Object.assign(
  Object.create(null) as Record<string, CourseCatalogCapability>,
  {
    pu: {
      providerId: 'pu-mypu' as const,
      schoolId: 'pu',
      label: '靜宜大學課綱查詢系統',
      officialQueryUrl: PU_INTEGRATED_CATALOG_URL,
    },
    ncnu: {
      providerId: 'ncnu-public' as const,
      schoolId: 'ncnu',
      label: '暨南大學本學期開設課程',
      officialQueryUrl: 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall',
    },
  },
);

function lookupIntegratedCatalog(publicId: string): CourseCatalogCapability | null {
  // Null-prototype map + own-property check: never treat constructor/toString/__proto__ as providers.
  if (!Object.prototype.hasOwnProperty.call(INTEGRATED_CATALOG_BY_PUBLIC_ID, publicId)) {
    return null;
  }
  const capability = INTEGRATED_CATALOG_BY_PUBLIC_ID[publicId];
  return capability?.schoolId === publicId ? capability : null;
}

export function resolveCourseCatalogCapability(
  schoolId?: string | null,
): CourseCatalogCapability | null {
  const publicId = toPublicSchoolId(schoolId);
  if (!publicId) return null;
  return lookupIntegratedCatalog(publicId);
}

export function hasIntegratedCourseCatalog(schoolId?: string | null): boolean {
  return resolveCourseCatalogCapability(schoolId) != null;
}

// Course-only destinations verified through https://nust.edu.tw/resource.php
// and the universities' course offices on 2026-11-06.
const additionalPublicCourses = new Map<string, { label: string; url: string }>([
  ['ncue', { label: '彰師大開課課程查詢', url: 'https://webap0.ncue.edu.tw/DEANV2/Other/OB010' }],
  ['ncut', { label: '勤益科大本學期開課查詢', url: 'https://nmsd.ncut.edu.tw/wbcmss/Query/CourseView' }],
  ['ncyu', { label: '嘉義大學全校課程查詢', url: 'https://web085003.adm.ncyu.edu.tw/pub_course.aspx' }],
  ['ndhu', { label: '東華大學全校課程查詢', url: 'https://sys.ndhu.edu.tw/aa/class/course/' }],
  ['nfu', { label: '虎尾科大學生專區（教務查詢整合平台入口）', url: 'https://nfu.edu.tw/zh_tw/pages/students' }],
  ['nuk', { label: '高雄大學課程資料查詢', url: 'https://course.nuk.edu.tw/QueryCourse/QueryCourse.asp' }],
  ['nuu', { label: '聯合大學課程檢索操作說明', url: 'https://curr.nuu.edu.tw/p/404-1076-11586.php' }],
]);

export function resolveOfficialCourseQueryLink(
  schoolId?: string | null,
): { label: string; url: string; sourceLabel?: string } | null {
  // Prefer live-verified public course entry from schoolPublicServices when present.
  const publicServices = resolveSchoolPublicServices(schoolId);
  if (publicServices?.services.courses) {
    const courses = publicServices.services.courses;
    return {
      label: courses.label,
      url: courses.url,
      sourceLabel: courses.sourceLabel,
    };
  }
  const publicId = toPublicSchoolId(schoolId);
  if (!publicId) return null;
  const courseLink = additionalPublicCourses.get(publicId);
  if (courseLink) return courseLink;
  const fromCapability = lookupIntegratedCatalog(publicId);
  if (fromCapability) {
    return { label: fromCapability.label, url: fromCapability.officialQueryUrl };
  }
  return null;
}

/** Only Providence accepts the myPU syllabus query format. */
export function isPuCourseCatalogSchool(schoolId?: string | null): boolean {
  return isProvidenceSchoolId(schoolId);
}

export function unsupportedCourseCatalogMessage(
  schoolId?: string | null,
  schoolName?: string | null,
): string {
  if (schoolId === 'ncnu') return '請開啟「暨大開課查詢」搜尋本學期公開課程。';
  const resolvedName =
    (typeof schoolName === 'string' && schoolName.trim()) ||
    findSchoolById(toPublicSchoolId(schoolId) ?? undefined)?.name ||
    '目前選擇的學校';
  const official = resolveOfficialCourseQueryLink(schoolId);
  if (official) {
    return `${resolvedName}尚未接入 nuni 內建課綱查詢。請改以校方「${official.label}」查詢開課資料；App 不會顯示其他學校的課綱。`;
  }
  return `${resolvedName}尚未接入 nuni 內建課綱查詢，也尚未登錄可核實的校方課程查詢連結。請改用個人課表或校方官方入口；App 不會套用其他學校的課綱資料。`;
}
