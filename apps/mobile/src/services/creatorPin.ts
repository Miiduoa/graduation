import {
  doc, getDocFromServer, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { EMPTY_CREATOR_CARD } from '@campus/shared/src/creatorCard';
import { getDb } from '../firebase';
import type { CampusPostDoc } from './feed';

export type CreatorPin = { postId: string | null; post: CampusPostDoc | null };

function scope(schoolId: string, ownerUid: string) {
  if (!schoolId || !ownerUid || schoolId.includes('/') || ownerUid.includes('/')) {
    throw new Error('Invalid creator pin scope');
  }
}
function postIdAllowed(postId: string) {
  return postId === '' || /^[A-Za-z0-9_-]{1,128}$/.test(postId);
}
function pinRef(schoolId: string, ownerUid: string) {
  scope(schoolId, ownerUid);
  return doc(getDb(), 'schools', schoolId, 'creatorProfiles', ownerUid);
}

/** Missing, deleted and legacy nonauthor posts must not appear as an endorsed pin. */
export async function readCreatorPin(schoolId: string, ownerUid: string): Promise<CreatorPin> {
  const profile = await getDocFromServer(pinRef(schoolId, ownerUid));
  if (!profile.exists()) return { postId: null, post: null };
  const data = profile.data();
  if (data.schoolId !== schoolId || data.ownerUid !== ownerUid) {
    throw new Error('Creator pin scope mismatch');
  }
  const pinned = data.pinnedPostId ?? '';
  if (typeof pinned !== 'string' || !postIdAllowed(pinned)) {
    throw new Error('Invalid creator pin record');
  }
  if (!pinned) return { postId: null, post: null };
  const post = await getDocFromServer(doc(getDb(), 'schools', schoolId, 'campusPosts', pinned));
  if (!post.exists()) return { postId: null, post: null };
  const value = post.data();
  if (value.schoolId !== schoolId || value.authorUid !== ownerUid || value.anonymous !== false) {
    return { postId: null, post: null };
  }
  return { postId: pinned, post: { ...value, id: post.id } as CampusPostDoc };
}

/** Separate personal-page pin state from feed ranking, with server confirmation. */
export async function saveCreatorPin(
  schoolId: string, ownerUid: string, postId: string,
): Promise<CreatorPin> {
  scope(schoolId, ownerUid);
  if (!postIdAllowed(postId)) throw new Error('Invalid creator pin ID');
  if (postId) {
    const post = await getDocFromServer(doc(getDb(), 'schools', schoolId, 'campusPosts', postId));
    const data = post.exists() ? post.data() : null;
    if (!data || data.schoolId !== schoolId || data.authorUid !== ownerUid || data.anonymous !== false) {
      throw new Error('Only your nonanonymous posts can be pinned');
    }
  }
  const ref = pinRef(schoolId, ownerUid);
  const previous = await getDocFromServer(ref);
  if (previous.exists()) {
    const data = previous.data();
    if (data.schoolId !== schoolId || data.ownerUid !== ownerUid) {
      throw new Error('Creator pin scope mismatch');
    }
  }
  await setDoc(ref, {
    ...(previous.exists() ? {} : { schoolId, ownerUid, ...EMPTY_CREATOR_CARD }),
    pinnedPostId: postId, updatedAt: serverTimestamp(),
  }, { merge: true });
  const confirmed = await readCreatorPin(schoolId, ownerUid);
  if ((confirmed.postId ?? '') !== postId) {
    throw new Error('Creator pin update was not confirmed');
  }
  return confirmed;
}
