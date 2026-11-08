import {
  collection, doc, documentId, endBefore, getDocFromServer, getDocsFromServer, limit, orderBy,
  query, startAfter, startAt, type DocumentData, type Firestore, type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import {
  TITLE_SEARCH_PAGE_SIZE, invalidTitleSearch, parseTitlePrefix,
  titlePrefixUpperBound, titleSearchPost, type TitleSearchPost,
} from '@campus/shared/src/communityTitleSearch';
export { TITLE_SEARCH_PAGE_SIZE, parseTitlePrefix, titlePrefixUpperBound } from '@campus/shared/src/communityTitleSearch';
export type { TitleSearchPost } from '@campus/shared/src/communityTitleSearch';

export type TitleSearchCursor = Readonly<{
  schoolId: string;
  prefix: string;
  document: QueryDocumentSnapshot<DocumentData>;
}>;
export type TitleSearchPage = {
  posts: TitleSearchPost[];
  nextCursor: TitleSearchCursor | null;
  hasMore: boolean;
};

/** Same server-only cursor contract as web, using the native Firebase connection. */
export async function searchCampusPostTitles(
  schoolId: string, input: string, cursor: TitleSearchCursor | null = null,
): Promise<TitleSearchPage> {
  const prefix = parseTitlePrefix(input);
  if (!schoolId || schoolId.includes('/')) throw invalidTitleSearch();
  const path = `schools/${schoolId}/campusPosts`;
  if (cursor && (
    cursor.schoolId !== schoolId || cursor.prefix !== prefix ||
    cursor.document.ref.parent.path !== path ||
    cursor.document.metadata.fromCache || cursor.document.metadata.hasPendingWrites ||
    typeof cursor.document.data().title !== 'string' ||
    !cursor.document.data().title.startsWith(prefix)
  )) throw invalidTitleSearch();
  return readTitlePage(getDb(), schoolId, prefix, cursor ? startAfter(cursor.document) : startAt(prefix));
}

/** Resolve a remembered ID again; never reuse a private document snapshot from navigation. */
export async function resumeCampusPostTitles(
  schoolId: string, input: string, postId: string,
): Promise<TitleSearchPage> {
  const prefix = parseTitlePrefix(input);
  if (!schoolId || schoolId.includes('/') || !postId || postId.includes('/')) throw invalidTitleSearch();
  // Capture the connection before awaiting so a changed provider cannot cross scopes.
  const db = getDb();
  const anchor = await getDocFromServer(doc(db, 'schools', schoolId, 'campusPosts', postId));
  if (anchor.metadata.fromCache || anchor.metadata.hasPendingWrites) {
    throw Object.assign(new Error('閱讀位置尚未取得伺服器確認。'), { code: 'unavailable' });
  }
  if (!anchor.exists() || !titleSearchPost(anchor.id, anchor.data(), schoolId, prefix)) {
    throw unavailableReadingPosition();
  }
  return readTitlePage(db, schoolId, prefix, startAt(anchor), postId);
}

function unavailableReadingPosition() {
  return Object.assign(new Error('上次閱讀的貼文已無法定位。'), { code: 'history-position-unavailable' });
}

async function readTitlePage(
  db: Firestore, schoolId: string, prefix: string, boundary: QueryConstraint, expectedFirstId?: string,
): Promise<TitleSearchPage> {
  const upperBound = titlePrefixUpperBound(prefix);
  const snapshot = await getDocsFromServer(query(
    collection(db, 'schools', schoolId, 'campusPosts'),
    orderBy('title', 'asc'), orderBy(documentId(), 'asc'), boundary,
    ...(upperBound === null ? [] : [endBefore(upperBound)]),
    limit(TITLE_SEARCH_PAGE_SIZE),
  ));
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
    throw Object.assign(new Error('搜尋尚未取得伺服器確認。'), { code: 'unavailable' });
  }
  const posts = snapshot.docs.flatMap((document) => {
    const post = titleSearchPost(document.id, document.data(), schoolId, prefix);
    return post ? [post] : [];
  });
  // Deletion or a title change between the two reads must not silently select a neighbour.
  if (expectedFirstId && posts[0]?.id !== expectedFirstId) throw unavailableReadingPosition();
  const last = snapshot.docs.at(-1);
  return {
    posts,
    nextCursor: last ? { schoolId, prefix, document: last } : null,
    hasMore: snapshot.docs.length === TITLE_SEARCH_PAGE_SIZE,
  };
}


/** Recheck a historical result at the moment it is opened; never trust a cached list item. */
export async function confirmCampusPostTitleOpen(schoolId: string, postId: string): Promise<boolean> {
  if (!schoolId || schoolId.includes('/') || !postId || postId.includes('/')) throw invalidTitleSearch();
  const document = await getDocFromServer(doc(getDb(), 'schools', schoolId, 'campusPosts', postId));
  if (document.metadata.fromCache || document.metadata.hasPendingWrites) {
    throw Object.assign(new Error('貼文尚未取得伺服器確認。'), { code: 'unavailable' });
  }
  return document.exists() && document.data().schoolId === schoolId;
}
