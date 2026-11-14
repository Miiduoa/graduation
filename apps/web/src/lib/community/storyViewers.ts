import {
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  buildStoryViewerPage,
  storyViewerCollectionPath,
  STORY_VIEWER_QUERY_LIMIT,
} from '@campus/shared/src/storyViewerPage';
import { getAuth, getDb } from '@/lib/firebase';
import { fetchSchoolDirectoryProfiles, type CampusStoryDoc } from './firestore';

export type AudienceStory = Pick<CampusStoryDoc, 'id' | 'schoolId' | 'authorUid'>;

export async function listStoryViewersPage(
  story: AudienceStory,
  after: QueryDocumentSnapshot | null,
) {
  const assertAuthor = () => {
    if (!story.authorUid || getAuth()?.currentUser?.uid !== story.authorUid) {
      throw Object.assign(new Error('只有發布者可以查看觀看名單'), { code: 'permission-denied' });
    }
  };
  assertAuthor();
  const receipts = await getDocsFromServer(
    query(
      collection(getDb(), ...storyViewerCollectionPath(story)),
      orderBy('viewedAt', 'desc'),
      ...(after ? [startAfter(after)] : []),
      limit(STORY_VIEWER_QUERY_LIMIT),
    ),
  );
  assertAuthor();
  const page = await buildStoryViewerPage(receipts.docs, story.authorUid, (uids) =>
    fetchSchoolDirectoryProfiles(story.schoolId, uids),
  );
  assertAuthor();
  return page;
}

export type StoryAudiencePage = Awaited<ReturnType<typeof listStoryViewersPage>>;
