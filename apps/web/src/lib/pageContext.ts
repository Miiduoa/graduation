import {
  PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
  PROVIDENCE_UNIVERSITY_SCHOOL_ID,
} from '@campus/shared/src';
import { findSchoolById, findSchoolsByCode, resolveSchool } from '@campus/shared/src/schools';
import { buildSchoolSearch, type SchoolContext } from './navigation';

export type SchoolSearchParams = {
  school?: string;
  schoolId?: string;
  campus?: string;
};

/** Null means the user explicitly chose "all campuses"; undefined means no selection. */
function requestedSchoolId(searchParams?: SchoolSearchParams): string | null | undefined {
  const campus = searchParams?.campus?.trim();
  if (campus === 'all') return null;
  if (campus) return campus;
  const schoolId = searchParams?.schoolId?.trim();
  if (schoolId === 'all') return null;
  return schoolId || undefined;
}

const SCHOOL_ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function resolveSchoolPageContext(searchParams?: SchoolSearchParams) {
  const requestedId = requestedSchoolId(searchParams);
  const matches = findSchoolsByCode(searchParams?.school);
  // An explicit campus choice must win over an obsolete schoolId/school code.
  // For schools missing from our offline list, keep their ID so data reads stay
  // within that campus. Do not silently substitute Providence or a demo school.
  const school =
    requestedId !== undefined
      ? (requestedId !== null ? findSchoolById(requestedId) : undefined) ?? {
          id: requestedId && SCHOOL_ID.test(requestedId) ? requestedId : 'unavailable-campus',
          code: '',
          name: requestedId === null ? '請先選擇校園' : '所選校園尚未接入',
        }
      : (matches.length === 1 ? matches[0] : undefined) ??
        findSchoolById(PROVIDENCE_UNIVERSITY_SCHOOL_ID) ??
        resolveSchool({
          school: PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
          schoolId: PROVIDENCE_UNIVERSITY_SCHOOL_ID,
        });
  const context: SchoolContext = { code: school.code, id: school.id };

  return {
    school,
    schoolId: school.id,
    schoolCode: school.code,
    schoolName: school.name,
    schoolContext: context,
    schoolSearch: buildSchoolSearch(context),
  };
}
