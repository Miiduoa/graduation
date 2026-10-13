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

function requestedSchoolId(searchParams?: SchoolSearchParams): string | undefined {
  const schoolId = searchParams?.schoolId?.trim();
  const campus = searchParams?.campus?.trim();
  if (schoolId && schoolId !== 'all') return schoolId;
  if (campus && campus !== 'all') return campus;
  return undefined;
}

export function resolveSchoolPageContext(searchParams?: SchoolSearchParams) {
  const requestedId = requestedSchoolId(searchParams);
  const matches = findSchoolsByCode(searchParams?.school);
  const school =
    findSchoolById(requestedId) ??
    (matches.length === 1 ? matches[0] : undefined) ??
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
