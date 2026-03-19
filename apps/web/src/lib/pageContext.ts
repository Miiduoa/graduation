import { resolveSchool } from "@campus/shared/src/schools";
import { buildSchoolSearch, type SchoolContext } from "./navigation";

export type SchoolSearchParams = {
  school?: string;
  schoolId?: string;
};

export function resolveSchoolPageContext(searchParams?: SchoolSearchParams) {
  const school = resolveSchool({
    school: searchParams?.school,
    schoolId: searchParams?.schoolId,
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
