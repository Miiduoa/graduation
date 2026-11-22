import { doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';
import {
  EMPTY_CREATOR_CARD, readCreatorCardFields, validateCreatorCard, type CreatorCard,
} from '@campus/shared/src/creatorCard';

const CARD_FIELDS = ['headline', 'bio', 'linkUrl'] as const;
// Retain which empty display fields still have a value to clear on the server.
const hiddenFields = new WeakMap<CreatorCard, ReadonlySet<keyof CreatorCard>>();
const pendingCardWrites = new Map<string, number>();

export function hasHiddenCreatorCardValue(card: CreatorCard, field: keyof CreatorCard): boolean {
  return hiddenFields.get(card)?.has(field) ?? false;
}

export function creatorCardFieldMatches(card: CreatorCard, field: keyof CreatorCard, expected: string): boolean {
  return card[field] === expected;
}

function cardRef(schoolId: string, ownerUid: string) {
  if (!schoolId || !ownerUid || schoolId.includes('/') || ownerUid.includes('/')) {
    throw new Error('Invalid creator card scope');
  }
  return doc(getDb(), 'schools', schoolId, 'creatorProfiles', ownerUid);
}

/** The school-owned directory stays read-only. Creator card fields are opt-in. */
export async function readCreatorCard(
  schoolId: string, ownerUid: string, { requireCommitted = false } = {},
): Promise<CreatorCard | null> {
  const snapshot = await getDocFromServer(cardRef(schoolId, ownerUid));
  // Firestore reports pending writes for the whole document. Only a known
  // local intro write can make a matching card provisional.
  if (requireCommitted && snapshot.metadata.hasPendingWrites &&
    pendingCardWrites.has(JSON.stringify([schoolId, ownerUid]))) {
    throw new Error('Creator card has pending writes');
  }
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Record<string, unknown>;
  if (data.schoolId !== schoolId || data.ownerUid !== ownerUid) {
    throw new Error('Creator card scope mismatch');
  }
  const card = readCreatorCardFields(data);
  hiddenFields.set(card, new Set(CARD_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(data, field) && card[field] === '' && data[field] !== '')));
  return card;
}

/** Save a whole bounded public card and confirm the written values against the server. */
export async function saveCreatorCard(
  schoolId: string, ownerUid: string, draft: CreatorCard,
  confirm = (read: () => Promise<CreatorCard | null>) => read(),
): Promise<CreatorCard> {
  const normalized = validateCreatorCard(draft);
  const ref = cardRef(schoolId, ownerUid);
  const scope = JSON.stringify([schoolId, ownerUid]);
  pendingCardWrites.set(scope, (pendingCardWrites.get(scope) ?? 0) + 1);
  try {
    await setDoc(ref, {
      schoolId, ownerUid, ...normalized, updatedAt: serverTimestamp(),
    }, { merge: true });
  } finally {
    const pending = pendingCardWrites.get(scope) ?? 0;
    if (pending <= 1) pendingCardWrites.delete(scope);
    else pendingCardWrites.set(scope, pending - 1);
  }
  const confirmed = await confirm(() => readCreatorCard(schoolId, ownerUid, { requireCommitted: true }));
  if (!confirmed || CARD_FIELDS.some((field) => !creatorCardFieldMatches(confirmed, field, normalized[field]))) {
    throw new Error('Creator card update was not confirmed');
  }
  return confirmed;
}

export { EMPTY_CREATOR_CARD };
