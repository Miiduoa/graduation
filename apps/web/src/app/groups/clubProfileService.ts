import { loadGroupDiscussionPage } from './groupDiscussionService';

export async function loadClubProfile(uid: string, schoolId: string, groupId: string) {
  const result = await loadGroupDiscussionPage(uid, schoolId, groupId);
  if (result.group.type !== 'club') throw new Error('這不是社團');
  return {
    ...result.group,
    announcements: result.page.posts.filter((post) => post.kind === 'announcement').slice(0, 3),
  };
}
