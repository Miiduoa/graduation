'use client';

import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
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
  const context = resolveSchoolPageContext(
    explicit ? params : selectedSchoolId ? { schoolId: selectedSchoolId } : params,
  );
  return {
    ...context,
    ready: !selection || (!selection.loading && selection.catalogStatus === 'ready'),
    catalogError: selection?.catalogStatus === 'error',
  };
}
