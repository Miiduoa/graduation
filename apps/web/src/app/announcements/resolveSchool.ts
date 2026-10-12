import { isAnnouncementSchoolVisibleToPublic } from '@campus/shared/src/campusAnnouncements';
import { findSchoolById, findSchoolsByCode } from '@campus/shared/src/schools';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { getWebAppEnv } from '@/lib/runtime';

export function resolveAnnouncementSchool(params?: { school?: string; schoolId?: string }) {
  const matches = findSchoolsByCode(params?.school);
  const fallback = resolveSchoolPageContext().school;
  const school =
    findSchoolById(params?.schoolId) ?? (matches.length === 1 ? matches[0] : fallback);
  return {
    school,
    visible: isAnnouncementSchoolVisibleToPublic({ schoolId: school.id }, getWebAppEnv()),
  };
}
