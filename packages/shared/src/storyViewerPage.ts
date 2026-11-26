const PAGE_SIZE = 20;
export const STORY_VIEWER_QUERY_LIMIT = PAGE_SIZE + 1;

// Deleting a Firestore parent does not remove its subcollections. Binding the
// audience to both the school and author keeps reused IDs in separate scopes.
export function storyViewerCollectionPath(story: {
  id: string;
  schoolId: string;
  authorUid: string;
}) {
  return [
    'campusStories',
    story.id,
    'schools',
    story.schoolId,
    'authors',
    story.authorUid,
    'views',
  ] as const;
}

export type StoryViewerPage<Cursor> = {
  viewers: { uid: string; displayName: string }[];
  nextCursor: Cursor | null;
};

type DirectoryProfile = { uid: string; displayName?: string | null };

export async function buildStoryViewerPage<T extends { id: string }>(
  docs: readonly T[],
  authorUid: string,
  loadProfiles: (uids: string[]) => Promise<readonly DirectoryProfile[]>,
): Promise<StoryViewerPage<T>> {
  const page = docs.slice(0, PAGE_SIZE);
  // Older clients can record a view when an author opens their own story.
  const uids = page.map((doc) => doc.id).filter((uid) => uid !== authorUid);
  const profiles = uids.length ? await loadProfiles(uids) : [];
  const names = new Map(profiles.map(({ uid, displayName }) => [uid, displayName?.trim()]));
  return {
    viewers: uids.map((uid) => {
      const name = names.get(uid);
      // The school directory uses the first eight UID characters for missing names.
      return { uid, displayName: name && name !== uid && name !== uid.slice(0, 8) ? name : '同學' };
    }),
    nextCursor: docs.length > PAGE_SIZE ? page[PAGE_SIZE - 1]! : null,
  };
}
