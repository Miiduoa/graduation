import { isAnnouncementSchoolVisibleToPublic } from '@campus/shared/src/campusAnnouncements';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { getAnnouncementVisibilityEnv } from '@/lib/runtime';

/** Respect the selected campus before outdated school IDs in shared links. */
export function resolveAnnouncementSchool(params?: {
  school?: string;
  schoolId?: string;
  campus?: string;
}) {
  const { school, schoolId } = resolveSchoolPageContext(params);
  return {
    school,
    visible:
      schoolId !== 'unavailable-campus' &&
      isAnnouncementSchoolVisibleToPublic({ schoolId }, getAnnouncementVisibilityEnv()),
  };
}
