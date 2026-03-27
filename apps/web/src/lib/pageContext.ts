import {
  PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
  PROVIDENCE_UNIVERSITY_SCHOOL_ID,
} from "@campus/shared/src";
import { findSchoolById, resolveSchool } from "@campus/shared/src/schools";
import { buildSchoolSearch, type SchoolContext } from "./navigation";

export type SchoolSearchParams = {
  school?: string;
  schoolId?: string;
};

export function resolveSchoolPageContext(searchParams?: SchoolSearchParams) {
  void searchParams;
  const school =
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
