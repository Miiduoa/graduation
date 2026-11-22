import { doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';
import { EMPTY_CREATOR_CARD, readCreatorCardFields, validateCreatorCard, type CreatorCard } from '@campus/shared/src/creatorCard';

const CARD_FIELDS = ['headline', 'bio', 'linkUrl'] as const;
// Retain which empty display fields still have a value to clear on the server.
const hiddenFields = new WeakMap<CreatorCard, ReadonlySet<keyof CreatorCard>>();

export function hasHiddenCreatorCardValue(card: CreatorCard, field: keyof CreatorCard): boolean {
  return hiddenFields.get(card)?.has(field) ?? false;
}

export function creatorCardFieldMatches(card: CreatorCard, field: keyof CreatorCard, expected: string): boolean {
  return card[field] === expected && (expected !== '' || !hasHiddenCreatorCardValue(card, field));
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
  // A server read can still include local changes awaiting acknowledgement.
  if (requireCommitted && snapshot.metadata.hasPendingWrites) {
    throw new Error('Creator card has pending writes');
  }
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Record<string, unknown>;
  if (data.schoolId !== schoolId || data.ownerUid !== ownerUid) {
    throw new Error('Creator card scope mismatch');
  }
  const card = readCreatorCardFields(data);
  hiddenFields.set(card, new Set(CARD_FIELDS.filter((field) => card[field] === '' && data[field] !== '')));
  return card;
}

/** Save the selected public fields and confirm them against the server. */
export async function saveCreatorCard(
  schoolId: string, ownerUid: string, draft: CreatorCard,
  fields: readonly (keyof CreatorCard)[] = CARD_FIELDS,
): Promise<CreatorCard> {
  const normalized = validateCreatorCard(draft);
  const changes: Partial<CreatorCard> = {};
  for (const field of fields) changes[field] = normalized[field];
  await setDoc(cardRef(schoolId, ownerUid), {
    schoolId, ownerUid, ...changes, updatedAt: serverTimestamp(),
  }, { merge: true });
  const confirmed = await readCreatorCard(schoolId, ownerUid, { requireCommitted: true });
  if (!confirmed || fields.some((field) => !creatorCardFieldMatches(confirmed, field, normalized[field]))) {
    throw new Error('Creator card update was not confirmed');
  }
  return confirmed;
}

export { EMPTY_CREATOR_CARD };
