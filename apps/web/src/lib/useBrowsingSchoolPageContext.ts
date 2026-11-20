'use client';

import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { findSchoolById } from '@campus/shared/src/schools';
import { buildSchoolSearch } from './navigation';
import { resolveSchoolPageContext, type SchoolSearchParams } from './pageContext';

function emptyContext(schoolSearch = '?campus=all') {
  return {
    school: {
      id: 'unavailable-campus',
      code: '',
      name: '請先選擇校園',
      shortName: undefined as string | undefined,
    },
    schoolId: 'unavailable-campus',
    schoolCode: '',
    schoolName: '請先選擇校園',
    schoolContext: { id: 'unavailable-campus', code: '' },
    schoolSearch,
  };
}

/**
 * Explicit deep links win through SelectedSchoolProvider when present.
 * Public campus pages follow the provider identity and readiness — never the
 * bundled offline catalog alone. School account permissions remain independent.
 */
export function useBrowsingSchoolPageContext(params?: SchoolSearchParams) {
  const selection = useOptionalSelectedSchool();

  if (!selection) {
    const explicit = [params?.campus, params?.schoolId, params?.school].some(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
    const requestedId =
      params?.campus && params.campus !== 'all' ? params.campus : params?.schoolId;
    const resolved = resolveSchoolPageContext(params);
    const requestedUnavailable = Boolean(
      requestedId &&
        params?.campus !== 'all' &&
        (resolved.schoolId === 'unavailable-campus' || !findSchoolById(requestedId)),
    );
    const scopeStatus =
      params?.campus === 'all' || (params?.schoolId === 'all' && !params?.campus)
        ? 'choose-school'
        : requestedUnavailable
          ? 'unavailable'
          : !explicit && resolved.schoolId === 'unavailable-campus'
            ? 'choose-school'
            : 'ready';
    return {
      ...resolved,
      ready: scopeStatus === 'ready',
      scopeStatus,
      catalogError: false,
      requiresSchoolSelection: scopeStatus === 'choose-school',
    };
  }

  if (selection.loading || selection.catalogStatus === 'loading') {
    return {
      ...emptyContext(),
      ready: false,
      scopeStatus: 'loading' as const,
      catalogError: false,
      requiresSchoolSelection: false,
    };
  }
  if (selection.catalogStatus === 'error') {
    return {
      ...emptyContext(),
      ready: false,
      scopeStatus: 'error' as const,
      catalogError: true,
      requiresSchoolSelection: false,
    };
  }

  const preferred = selection.selectedSchool;
  if (preferred) {
    const code =
      preferred.code || findSchoolById(preferred.id)?.code || preferred.id.toUpperCase();
    return {
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
      ready: true,
      scopeStatus: 'ready' as const,
      catalogError: false,
      requiresSchoolSelection: false,
    };
  }

  const scopeStatus = selection.requestedUnavailable ? 'unavailable' : 'choose-school';
  return {
    ...emptyContext(selection.requestedUnavailable ? '?campus=all' : '?campus=all'),
    ready: false,
    scopeStatus,
    catalogError: false,
    requiresSchoolSelection: scopeStatus === 'choose-school',
  };
}
