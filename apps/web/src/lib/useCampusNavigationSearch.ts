'use client';

import { useSearchParams } from 'next/navigation';
import { findSchoolById } from '@campus/shared/src/schools';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';

/** Keep navigation scoped even when a school was restored from browser preference. */
export function useCampusNavigationSearch(): string {
  const params = useSearchParams();
  const browsing = useOptionalSelectedSchool();
  const result = new URLSearchParams();

  if (
    browsing &&
    !browsing.loading &&
    browsing.catalogStatus === 'ready'
  ) {
    const selected = browsing.selectedSchool;
    if (selected) {
      result.set('campus', selected.id);
      result.set('schoolId', selected.id);
      const code = findSchoolById(selected.id)?.code || selected.code;
      if (code) result.set('school', code);
    } else {
      result.set('campus', 'all');
    }
    return result.toString();
  }

  for (const key of ['school', 'schoolId', 'campus']) {
    const value = params?.get(key);
    if (value) result.set(key, value);
  }
  return result.toString();
}
