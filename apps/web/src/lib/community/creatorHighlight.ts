import { deleteDoc, doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import type { CampusPostDoc } from './firestore';

export type CreatorHighlight = { postId: string; post: CampusPostDoc | null };

function scopedId(id: string): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error('INVALID_CREATOR_HIGHLIGHT_SCOPE');
  }
  return id;
}

function highlightRef(schoolId: string, uid: string) {
  return doc(getDb(), 'schools', scopedId(schoolId), 'creatorHighlights', scopedId(uid));
}

function postRef(schoolId: string, postId: string) {
  return doc(getDb(), 'schools', scopedId(schoolId), 'campusPosts', scopedId(postId));
}

function verifiedPost(
  schoolId: string, uid: string, postId: string, record: Record<string, unknown>,
): CampusPostDoc | null {
  if (record.schoolId !== schoolId || record.authorUid !== uid || record.anonymous !== false) return null;
  return { ...record, id: postId } as CampusPostDoc;
}

/**
 * A highlight is a pointer, not a copy of content. Both the pointer and its post
 * are freshly checked, so deletion or switching a post to anonymous hides it.
 * This read never obtains or exposes private account documents.
 */
export async function readCreatorHighlight(
  schoolId: string, uid: string,
): Promise<CreatorHighlight | null> {
  const snapshot = await getDocFromServer(highlightRef(schoolId, uid));
  if (!snapshot.exists()) return null;
  const record = snapshot.data() as Record<string, unknown>;
  if (record.schoolId !== schoolId || record.ownerUid !== uid || typeof record.postId !== 'string') {
    throw new Error('INVALID_CREATOR_HIGHLIGHT');
  }
  const postId = scopedId(record.postId);
  const postSnapshot = await getDocFromServer(postRef(schoolId, postId));
  return {
    postId,
    post: postSnapshot.exists()
      ? verifiedPost(schoolId, uid, postId, postSnapshot.data() as Record<string, unknown>)
      : null,
  };
}

export async function featureCreatorPost(
  schoolId: string, uid: string, postId: string,
): Promise<CreatorHighlight> {
  const snapshot = await getDocFromServer(postRef(schoolId, postId));
  if (!snapshot.exists() || !verifiedPost(schoolId, uid, postId, snapshot.data() as Record<string, unknown>)) {
    throw new Error('FEATURED_POST_NOT_OWNED');
  }
  await setDoc(highlightRef(schoolId, uid), {
    schoolId, ownerUid: uid, postId, updatedAt: serverTimestamp(),
  });
  const confirmed = await readCreatorHighlight(schoolId, uid);
  if (!confirmed || confirmed.postId !== postId || !confirmed.post) {
    throw new Error('FEATURED_POST_NOT_CONFIRMED');
  }
  return confirmed;
}

export async function removeCreatorHighlight(schoolId: string, uid: string): Promise<void> {
  await deleteDoc(highlightRef(schoolId, uid));
  if ((await getDocFromServer(highlightRef(schoolId, uid))).exists()) {
    throw new Error('FEATURED_REMOVAL_NOT_CONFIRMED');
  }
}
