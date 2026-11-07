import {
  collection, documentId, endBefore, getDocsFromServer, limit, orderBy,
  query, startAfter, startAt, type DocumentData, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';

export const TITLE_SEARCH_PAGE_SIZE = 20;
export type TitleSearchPost = {
  id: string;
  schoolId: string;
  title: string;
  excerpt: string;
  anonymous: boolean;
};
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

const invalid = () => Object.assign(new Error('請輸入 1 至 80 字的標題開頭。'), {
  code: 'invalid-argument',
});

/** Match the stored title literally. Do not normalize only the query and lose old records. */
export function parseTitlePrefix(value: string): string {
  if (typeof value !== 'string') throw invalid();
  const prefix = value.trim();
  const characters = Array.from(prefix);
  if (!characters.length || characters.length > 80 || characters.some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
  })) throw invalid();
  return prefix;
}

/** Exclusive Unicode scalar successor; prefix + U+F8FF incorrectly omits emoji suffixes. */
export function titlePrefixUpperBound(prefix: string): string | null {
  const characters = Array.from(prefix);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const code = characters[index].codePointAt(0)!;
    if (code === 0x10ffff) continue;
    const next = code === 0xd7ff ? 0xe000 : code + 1;
    return characters.slice(0, index).join('') + String.fromCodePoint(next);
  }
  return null;
}

/** Query the school's live title index, not a downloaded feed or a copied search database. */
export async function searchCampusPostTitles(
  schoolId: string,
  input: string,
  cursor: TitleSearchCursor | null = null,
): Promise<TitleSearchPage> {
  const prefix = parseTitlePrefix(input);
  if (!schoolId || schoolId.includes('/')) throw invalid();
  const path = `schools/${schoolId}/campusPosts`;
  if (cursor && (
    cursor.schoolId !== schoolId || cursor.prefix !== prefix ||
    cursor.document.ref.parent.path !== path ||
    cursor.document.metadata.fromCache || cursor.document.metadata.hasPendingWrites ||
    typeof cursor.document.data().title !== 'string' ||
    !cursor.document.data().title.startsWith(prefix)
  )) throw invalid();
  const upperBound = titlePrefixUpperBound(prefix);
  const snapshot = await getDocsFromServer(query(
    collection(getDb(), path),
    orderBy('title', 'asc'), orderBy(documentId(), 'asc'),
    cursor ? startAfter(cursor.document) : startAt(prefix),
    ...(upperBound === null ? [] : [endBefore(upperBound)]),
    limit(TITLE_SEARCH_PAGE_SIZE),
  ));
  // Do not mistake an offline result or a pending local title edit for a confirmed page.
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
    throw Object.assign(new Error('搜尋尚未取得伺服器確認。'), { code: 'unavailable' });
  }
  const last = snapshot.docs.at(-1);
  return {
    posts: snapshot.docs.flatMap((document) => {
      const data = document.data();
      if (data.schoolId !== schoolId || typeof data.title !== 'string' ||
          !data.title.startsWith(prefix)) return [];
      // Search cards never request media, look up authors or disclose anonymous author IDs.
      return [{
        id: document.id, schoolId, title: data.title,
        excerpt: typeof data.content === 'string' ? Array.from(data.content).slice(0, 160).join('') : '',
        anonymous: data.anonymous === true,
      }];
    }),
    nextCursor: last ? { schoolId, prefix, document: last } : null,
    hasMore: snapshot.docs.length === TITLE_SEARCH_PAGE_SIZE,
  };
}
