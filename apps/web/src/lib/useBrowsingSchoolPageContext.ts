'use client';

import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { findSchoolById } from '@campus/shared/src/schools';
import { buildSchoolSearch } from './navigation';
import { resolveSchoolPageContext, type SchoolSearchParams } from './pageContext';

/**
 * Explicit deep links win, otherwise public campus pages follow the current
 * browsing preference. School account permissions remain independent.
 */
export function useBrowsingSchoolPageContext(params?: SchoolSearchParams) {
  const selection = useOptionalSelectedSchool();
  const explicit = [params?.campus, params?.schoolId, params?.school].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
  const selectedSchoolId = selection?.selectedSchoolId;
  const preferred = selection?.selectedSchool;
  const requestedId = params?.campus && params.campus !== 'all'
    ? params.campus
    : params?.schoolId;
  const usePreferred = preferred && (!explicit || requestedId === preferred.id);
  const resolved = resolveSchoolPageContext(
    explicit ? params : selectedSchoolId ? { schoolId: selectedSchoolId } : params,
  );
  // The live directory may contain campuses not bundled with this release.
  const code = usePreferred
    ? (preferred.code || findSchoolById(preferred.id)?.code || preferred.id.toUpperCase())
    : resolved.schoolCode;
  const context = usePreferred
    ? {
        school: {
          id: preferred.id,
          code,
          name: preferred.name,
          shortName: preferred.shortName,
        },
        schoolId: preferred.id,
        schoolCode: code,
        schoolName: preferred.name,
        schoolContext: { id: preferred.id, code },
        schoolSearch: buildSchoolSearch({ id: preferred.id, code }),
      }
    : resolved;
  const scopeStatus = !selection
    ? 'ready'
    : selection.loading || selection.catalogStatus === 'loading'
      ? 'loading'
      : selection.catalogStatus === 'error'
        ? 'error'
        : !selection.selectedSchool && (!explicit || params?.campus === 'all')
          ? 'choose-school'
          : 'ready';
  return {
    ...context,
    ready: scopeStatus === 'ready',
    scopeStatus,
    catalogError: scopeStatus === 'error',
    requiresSchoolSelection: scopeStatus === 'choose-school',
  };
}
