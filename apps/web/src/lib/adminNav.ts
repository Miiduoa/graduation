/**
 * 校管／內容編輯在 Web /admin 下的校園公告導覽。
 * 平台工作台（features/admin/adminNav）另案；此模組只服務 /admin/announcements。
 */

export const ADMIN_ANNOUNCEMENTS_HREF = '/admin/announcements';

export const adminAnnouncementsSection = {
  id: 'announcements' as const,
  label: '校園公告',
  heading: '校園公告',
  purpose: '列出本校公告，並建立或編輯內容。欄位與手機校管台一致。',
};

/** 與手機 AdminDashboard／後端 upsertSchoolAnnouncement 既有角色旗標對齊（僅 UI 可見性）。 */
export function canSeeSchoolAnnouncementAdmin(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'editor';
}
