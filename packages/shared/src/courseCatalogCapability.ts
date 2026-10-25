import { findSchoolById } from './schools';
import { isProvidenceSchoolId, toPublicSchoolId } from './schoolIds';
import { resolveSchoolPublicServices } from './schoolPublicServices';

/**
 * In-app integrated course catalog providers.
 * Unknown schools have no provider — do not invent semesters, buildings, or filters.
 * Public official course URLs come from schoolPublicServices (verified separately);
 * those links are not evidence of private academic / in-app catalog capability.
 */
export type CourseCatalogProviderId = 'pu-mypu';

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
  },
);

function lookupIntegratedCatalog(publicId: string): CourseCatalogCapability | null {
  // Null-prototype map + own-property check: never treat constructor/toString/__proto__ as providers.
  if (!Object.prototype.hasOwnProperty.call(INTEGRATED_CATALOG_BY_PUBLIC_ID, publicId)) {
    return null;
  }
  const capability = INTEGRATED_CATALOG_BY_PUBLIC_ID[publicId];
  return capability?.providerId === 'pu-mypu' && capability.schoolId === 'pu' ? capability : null;
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
  const fromCapability = lookupIntegratedCatalog(publicId);
  if (fromCapability) {
    return { label: fromCapability.label, url: fromCapability.officialQueryUrl };
  }
  return null;
}

/** Providence myPU catalog remains the only integrated provider today. */
export function isPuCourseCatalogSchool(schoolId?: string | null): boolean {
  return isProvidenceSchoolId(schoolId);
}

export function unsupportedCourseCatalogMessage(
  schoolId?: string | null,
  schoolName?: string | null,
): string {
  const resolvedName =
    (typeof schoolName === 'string' && schoolName.trim()) ||
    findSchoolById(toPublicSchoolId(schoolId) ?? undefined)?.name ||
    '目前選擇的學校';
  const official = resolveOfficialCourseQueryLink(schoolId);
  if (official) {
    return `${resolvedName}尚未接入 Campus One 內建課綱查詢。請改以校方「${official.label}」查詢開課資料；App 不會顯示其他學校的課綱。`;
  }
  return `${resolvedName}尚未接入 Campus One 內建課綱查詢，也尚未登錄可核實的校方課程查詢連結。請改用個人課表或校方官方入口；App 不會套用其他學校的課綱資料。`;
}
