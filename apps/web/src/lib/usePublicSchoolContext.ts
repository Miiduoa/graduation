'use client';

import { findSchoolById, findSchoolsByCode } from '@campus/shared/src/schools';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { buildSchoolSearch } from './navigation';
import { resolveSchoolPageContext, type SchoolSearchParams } from './pageContext';

export type PublicSchoolStatus = 'ready' | 'loading' | 'error' | 'choose' | 'unknown';

/**
 * Public campus screens must follow the current browsing tenant, including
 * selections restored from the browser after navigation without a query string.
 * The browsing tenant does not grant access to authenticated school records.
 */
export function usePublicSchoolContext(params?: SchoolSearchParams) {
  const browsing = useOptionalSelectedSchool();
  const fallback = resolveSchoolPageContext(params);
  if (!browsing) return { ...fallback, status: 'ready' as PublicSchoolStatus };
  if (browsing.loading || browsing.catalogStatus === 'loading') {
    return { ...fallback, schoolId: '', schoolName: '', status: 'loading' as PublicSchoolStatus };
  }
  if (browsing.catalogStatus === 'error') {
    return { ...fallback, schoolId: '', schoolName: '', status: 'error' as PublicSchoolStatus };
  }

  const chosen = browsing.selectedSchool;
  if (chosen) {
    const known = findSchoolById(chosen.id);
    const code = known?.code || chosen.code || '';
    const school = known ?? {
      id: chosen.id,
      code,
      name: chosen.name,
      shortName: chosen.shortName,
    };
    const context = { id: chosen.id, code };
    return {
      school,
      schoolId: school.id,
      schoolCode: code,
      schoolName: chosen.name,
      schoolContext: context,
      schoolSearch: buildSchoolSearch(context),
      status: 'ready' as PublicSchoolStatus,
    };
  }

  // Old links containing a school code remain valid if that code is unique.
  // Explicitly unknown tenant IDs may not silently fall back to Providence.
  const explicitId = params?.campus || params?.schoolId;
  const legacy = !explicitId && params?.school ? findSchoolsByCode(params.school) : [];
  if (legacy.length === 1) {
    const school = legacy[0];
    return {
      ...fallback,
      school,
      schoolId: school.id,
      schoolCode: school.code,
      schoolName: school.name,
      schoolContext: { id: school.id, code: school.code },
      schoolSearch: buildSchoolSearch({ id: school.id, code: school.code }),
      status: 'ready' as PublicSchoolStatus,
    };
  }

  return {
    ...fallback,
    schoolId: '',
    schoolName: '',
    status:
      explicitId && explicitId !== 'all'
        ? ('unknown' as PublicSchoolStatus)
        : ('choose' as PublicSchoolStatus),
  };
}
