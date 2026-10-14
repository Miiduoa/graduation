'use client';

import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { resolveSchoolPageContext, type SchoolSearchParams } from './pageContext';

export type CampusBrowseContext = {
  status: 'ready' | 'loading' | 'error' | 'unselected';
  schoolId: string | null;
  schoolName: string;
  schoolSearch: string;
};

/**
 * Public browsing follows the selected campus, not the signed-in school.
 * URL-only mode is retained for isolated pages and legacy entry points.
 */
export function useCampusBrowseContext(params?: SchoolSearchParams): CampusBrowseContext {
  const selection = useOptionalSelectedSchool();
  if (!selection) {
    if (params?.campus === 'all' || (params?.schoolId === 'all' && !params?.campus)) {
      return { status: 'unselected', schoolId: null, schoolName: '', schoolSearch: '?campus=all' };
    }
    const legacy = resolveSchoolPageContext(params);
    if (legacy.schoolId === 'unavailable-campus') {
      return { status: 'unselected', schoolId: null, schoolName: '', schoolSearch: '?campus=all' };
    }
    return {
      status: 'ready',
      schoolId: legacy.schoolId,
      schoolName: legacy.schoolName,
      schoolSearch: legacy.schoolSearch,
    };
  }
  if (selection.loading || selection.catalogStatus === 'loading') {
    return { status: 'loading', schoolId: null, schoolName: '', schoolSearch: '?campus=all' };
  }
  if (selection.catalogStatus === 'error') {
    return { status: 'error', schoolId: null, schoolName: '', schoolSearch: '?campus=all' };
  }
  if (!selection.selectedSchool) {
    return { status: 'unselected', schoolId: null, schoolName: '', schoolSearch: '?campus=all' };
  }

  const schoolId = selection.selectedSchool.id;
  const search = new URLSearchParams({ schoolId, campus: schoolId });
  return {
    status: 'ready',
    schoolId,
    schoolName: selection.selectedSchool.name,
    schoolSearch: `?${search.toString()}`,
  };
}
