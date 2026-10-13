import { isAnnouncementSchoolVisibleToPublic } from '@campus/shared/src/campusAnnouncements';
import { findSchoolById, findSchoolsByCode } from '@campus/shared/src/schools';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { getAnnouncementVisibilityEnv } from '@/lib/runtime';

export function resolveAnnouncementSchool(params?: {
  school?: string;
  schoolId?: string;
  campus?: string;
}) {
  const matches = findSchoolsByCode(params?.school);
  const fallback = resolveSchoolPageContext().school;
  const school =
    findSchoolById(params?.schoolId) ??
    findSchoolById(params?.campus || '') ??
    (matches.length === 1 ? matches[0] : fallback);
  return {
    school,
    visible: isAnnouncementSchoolVisibleToPublic(
      { schoolId: school.id },
      getAnnouncementVisibilityEnv(),
    ),
  };
}
