import { toPublicSchoolId } from '@campus/shared/src/schoolIds';

export function dormAnnouncementHref(schoolId: string, id?: string | null): string {
  const campus = toPublicSchoolId(schoolId) ?? schoolId;
  const query = new URLSearchParams({ campus, schoolId: campus });
  if (id) query.set('dormAnnouncementId', id);
  return `/dormitory/announcements/${encodeURIComponent(schoolId)}?${query}`;
}
