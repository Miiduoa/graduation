import { doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';
import { EMPTY_CREATOR_CARD, readCreatorCardFields, validateCreatorCard, type CreatorCard } from '@campus/shared/src/creatorCard';

function cardRef(schoolId: string, ownerUid: string) {
  if (!schoolId || !ownerUid || schoolId.includes('/') || ownerUid.includes('/')) {
    throw new Error('Invalid creator card scope');
  }
  return doc(getDb(), 'schools', schoolId, 'creatorProfiles', ownerUid);
}

/** The school-owned directory stays read-only. Creator card fields are opt-in. */
export async function readCreatorCard(schoolId: string, ownerUid: string): Promise<CreatorCard | null> {
  const snapshot = await getDocFromServer(cardRef(schoolId, ownerUid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Record<string, unknown>;
  if (data.schoolId !== schoolId || data.ownerUid !== ownerUid) {
    throw new Error('Creator card scope mismatch');
  }
  return readCreatorCardFields(data);
}

/** Save a whole bounded public card and confirm it against the server. */
export async function saveCreatorCard(
  schoolId: string, ownerUid: string, draft: CreatorCard,
): Promise<CreatorCard> {
  const normalized = validateCreatorCard(draft);
  await setDoc(cardRef(schoolId, ownerUid), {
    schoolId, ownerUid, ...normalized, updatedAt: serverTimestamp(),
  });
  const confirmed = await readCreatorCard(schoolId, ownerUid);
  if (!confirmed ||
    confirmed.headline !== normalized.headline ||
    confirmed.bio !== normalized.bio ||
    confirmed.linkUrl !== normalized.linkUrl) {
    throw new Error('Creator card update was not confirmed');
  }
  return confirmed;
}

export { EMPTY_CREATOR_CARD };
