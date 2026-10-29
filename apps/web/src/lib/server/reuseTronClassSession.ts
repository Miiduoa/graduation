import type { SchoolLoginFirestore } from './schoolLoginProfile';
import { schoolSessionCookies, schoolSessionExpiry } from './academicRecordsHandlers';

type SessionRecord = Record<string, unknown>;
type SessionSnap = { exists: boolean; data: () => SessionRecord };
type SessionRef = { id?: string; get?: () => Promise<SessionSnap> };
type SessionQuery = {
  where: (field: string, op: string, value: unknown) => SessionQuery;
  orderBy: (field: string, direction: 'desc') => SessionQuery;
  limit: (count: number) => SessionQuery;
  get: () => Promise<{ docs: Array<SessionSnap & { id: string }> }>;
};
type SessionDb = SchoolLoginFirestore & { collection?: (path: string) => SessionQuery };

const SESSION_ID = /^[a-f0-9]{32}$/;

export async function reuseOwnedTronClassSession({
  db, uid, studentId, portalId, now = Date.now,
}: {
  db: SchoolLoginFirestore;
  uid: string;
  studentId: string;
  portalId: string;
  now?: () => number;
}): Promise<boolean> {
  const store = db as SessionDb;
  if (typeof store.collection !== 'function' || !uid || !portalId) return false;
  const previous = await store.collection('_puSessions')
    .where('ownerUid', '==', uid).orderBy('expiresAt', 'desc').limit(8).get();

  for (const candidate of previous.docs) {
    if (candidate.id === portalId) continue;
    const portal = candidate.data();
    const linkedId = portal.tronClassSessionId;
    if (portal.ownerUid !== uid || portal.studentId !== studentId ||
      schoolSessionExpiry(portal.expiresAt) <= now() ||
      typeof linkedId !== 'string' || !SESSION_ID.test(linkedId)) continue;

    const portalRef = db.doc('_puSessions/' + portalId);
    const lmsRef = db.doc('_puTronClassSessions/' + linkedId);
    const oldRef = db.doc('_puSessions/' + candidate.id);
    const success = await db.runTransaction(async (tx) => {
      const [current, original, lms] = await Promise.all([
        tx.get(portalRef), tx.get(oldRef), tx.get(lmsRef),
      ]);
      const next = current.data();
      const old = original.data();
      const stored = lms.data();
      if (!current.exists || next.ownerUid !== uid || next.studentId !== studentId ||
        schoolSessionExpiry(next.expiresAt) <= now() || next.tronClassSessionId ||
        !original.exists || old.ownerUid !== uid || old.studentId !== studentId ||
        old.tronClassSessionId !== linkedId || schoolSessionExpiry(old.expiresAt) <= now() ||
        !lms.exists || stored.ownerUid !== uid || stored.studentId !== studentId ||
        schoolSessionExpiry(stored.expiresAt) <= now() ||
        !schoolSessionCookies(stored.cookies)) return false;

      tx.set(portalRef, { tronClassSessionId: linkedId, lmsConnectingUntil: null }, { merge: true });
      return true;
    });
    if (success) return true;
  }
  return false;
}
