import { expect, it } from 'vitest';
import {
  ADMIN_ANNOUNCEMENTS_HREF,
  adminAnnouncementsSection,
  canSeeSchoolAnnouncementAdmin,
} from './adminNav';

it('exposes the campus announcements admin entry under /admin', () => {
  expect(ADMIN_ANNOUNCEMENTS_HREF).toBe('/admin/announcements');
  expect(adminAnnouncementsSection.label).toBe('校園公告');
  expect(adminAnnouncementsSection.id).toBe('announcements');
});

it('shows the entry only for existing school admin or editor role flags', () => {
  expect(canSeeSchoolAnnouncementAdmin('admin')).toBe(true);
  expect(canSeeSchoolAnnouncementAdmin('editor')).toBe(true);
  expect(canSeeSchoolAnnouncementAdmin('teacher')).toBe(false);
  expect(canSeeSchoolAnnouncementAdmin('student')).toBe(false);
  expect(canSeeSchoolAnnouncementAdmin(null)).toBe(false);
  expect(canSeeSchoolAnnouncementAdmin(undefined)).toBe(false);
});
