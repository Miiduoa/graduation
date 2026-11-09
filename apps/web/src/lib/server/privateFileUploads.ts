import 'server-only';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { parsePrivateFilePath, type PrivateFileScope } from '@campus/shared/src/privateFileAccess';
import type { FileStorage } from './fileStorage';

export const UPLOAD_URL_TTL_MS = 7200_000;
// Signed upload URLs cannot enforce a category limit. Reserve the bucket ceiling.
export const UPLOAD_RESERVED_BYTES = 45 * 1024 * 1024;
export const USER_FILE_QUOTA_BYTES = 200 * 1024 * 1024;
export const GLOBAL_FILE_QUOTA_BYTES = 900 * 1024 * 1024;
export const MAX_PENDING_UPLOADS = 6;
export const ORPHAN_GRACE_MS = 2 * 3600_000;
export const SUBMISSION_GRACE_MS = 24 * 3600_000;

async function isOrphan(db: Firestore, tx: FirebaseFirestore.Transaction, path: string, now: number) {
  const scope = parsePrivateFilePath(path);
  if (!scope) return false;
  let ref;
  if (scope.kind === 'story') ref = db.collection('campusStories').doc(scope.storyId!);
  else if (scope.kind === 'group-cover') ref = db.collection('groups').doc(scope.groupId!);
  else if (scope.kind === 'group-post')
    ref = db.collection('groups').doc(scope.groupId!).collection('posts').doc(scope.postId!);
  else {
    const assignments = scope.groupId
      ? db.collection('groups').doc(scope.groupId).collection('assignments')
      : db.collection('assignments');
    ref = assignments.doc(scope.assignmentId!).collection('submissions').doc(scope.userId!);
  }
  const snap = await tx.get(ref);
  if (!snap.exists) return true;
  const row = snap.data()!;
  if (scope.kind === 'story') {
    const value = row.expiresAt;
    const expiry = typeof value === 'number' ? value : value instanceof Date ? value.getTime()
      : typeof value?.toMillis === 'function' ? value.toMillis() : Date.parse(value);
    return Number.isFinite(expiry) && expiry + ORPHAN_GRACE_MS < now;
  }
  // Container eligibility is separate from the global reference check below.
  return scope.kind === 'group-post' &&
    (row.deleted === true || row.isDeleted === true || row.deletedAt != null || row.status === 'deleted');
}
// Unfiltered collection-group scans use the built-in document-name index, not
// collection-group field indexes. Never infer absence from a truncated result.
export const REFERENCE_SCAN_LIMIT = 200;

const BUDGET_EXHAUSTED = new Error('Cleanup read budget exhausted');
// 48 scheduled runs/day * 300 = 14,400 reads/day, including discovery,
// empty queries (one read minimum), settlement and transaction retries.
// Each signing cleanup adds at most 50 reads: total <= 14,400 + 50 * requests/day.
// Signing traffic is unbounded, so this is not a site-wide daily quota.
export const SCHEDULED_CLEANUP_READ_BUDGET = 300;
export const SIGNING_CLEANUP_READ_BUDGET = 50;
export const CLEANUP_CANDIDATE_LIMIT = 5;

class CleanupReadBudget {
  constructor(public remaining: number) {}
  spend(count: number) {
    if (count > this.remaining) throw BUDGET_EXHAUSTED;
    this.remaining -= count;
  }
  async query(query: FirebaseFirestore.Query, maximum: number, tx?: FirebaseFirestore.Transaction) {
    const limit = Math.min(maximum, this.remaining);
    if (limit < 1) throw BUDGET_EXHAUSTED;
    this.spend(limit);
    const result = tx ? await tx.get(query.limit(limit)) : await query.limit(limit).get();
    this.remaining += limit - Math.max(1, result.size);
    return { result, limit };
  }
  transaction(tx: FirebaseFirestore.Transaction): FirebaseFirestore.Transaction {
    return new Proxy(tx, {
      get: (target, key) => {
        if (key === 'get') return (ref: FirebaseFirestore.DocumentReference | FirebaseFirestore.Query) => {
          if (!('limit' in ref)) this.spend(1);
          return target.get(ref as FirebaseFirestore.DocumentReference);
        };
        if (key === 'getAll') return (...refs: FirebaseFirestore.DocumentReference[]) => {
          this.spend(refs.length);
          return target.getAll(...refs);
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
}

function attachmentReferences(value: unknown, path: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item: unknown) => item === path ||
    (item !== null && typeof item === 'object' &&
      ((item as { url?: unknown }).url === path || (item as { path?: unknown }).path === path)));
}

async function hasReferences(
  db: Firestore, tx: FirebaseFirestore.Transaction, path: string, budget: CleanupReadBudget,
): Promise<boolean> {
  try {
    // Equality queries need only built-in single-field indexes. Any match is
    // retained, including expired stories, since limit(1) cannot prove all expired.
    for (const query of [
      db.collection('campusStories').where('mediaUrl', '==', path),
      db.collection('groups').where('coverUrl', '==', path),
    ]) {
      const { result } = await budget.query(query, 1, tx);
      if (!result.empty) return true;
    }
    for (const query of [db.collectionGroup('posts'), db.collectionGroup('submissions')]) {
      const { result, limit } = await budget.query(query, REFERENCE_SCAN_LIMIT + 1, tx);
      // A budget-truncated scan cannot establish absence either.
      if (result.size > REFERENCE_SCAN_LIMIT || result.size === limit) return true;
      if (result.docs.some((doc) => attachmentReferences(doc.data().attachments, path))) return true;
    }
    return false;
  } catch (error) {
    if (error === BUDGET_EXHAUSTED) throw error;
    // Includes missing indexes and unavailable queries.
    return true;
  }
}
const fail = (statusCode: number, message: string): never => {
  throw Object.assign(new Error(message), { statusCode });
};
export const uploadId = (path: string) => createHash('sha256').update(path).digest('hex');
const userId = (uid: string) => `user-${uploadId(uid)}`;

export function createPrivateFileUploads(db: Firestore, storage: FileStorage) {
  const uploads = db.collection('privateFileUploads');
  const quota = db.collection('privateFileQuota');
  const global = quota.doc('global');
  async function read(path: string, uid?: string) {
    const snap = await uploads.doc(uploadId(path)).get();
    const row = snap.data();
    if (!row || row.path !== path || (uid && row.uid !== uid)) fail(404, '找不到檔案');
    return row!;
  }
  async function settle(path: string, uid: string, bytes: number | null, now = Date.now(), budget?: CleanupReadBudget) {
    return db.runTransaction(async (rawTx) => {
      const tx = budget ? budget.transaction(rawTx) : rawTx;
      const ref = uploads.doc(uploadId(path));
      const user = quota.doc(userId(uid));
      const [record, globalSnap, userSnap] = await tx.getAll(ref, global, user);
      const row = record.data();
      if (!row || row.path !== path || row.uid !== uid) fail(404, '找不到檔案');
      if (['finalized', 'claimed'].includes(row!.status)) return;
      if (bytes !== null && (row!.status !== 'pending' || row!.invalid || row!.expiresAt <= now))
        fail(409, '上傳已過期或無效，請重新上傳');
      if (bytes === null && row!.status !== 'cleaning') return;
      for (const [ref, snap] of [
        [global, globalSnap],
        [user, userSnap],
      ] as const) {
        const value = snap.data() || {};
        tx.set(ref, {
          reservedBytes: (value.reservedBytes || 0) - row!.reservedBytes,
          finalizedBytes: (value.finalizedBytes || 0) + (bytes ?? 0),
          ...(ref.path === user.path
            ? {
                pendingCount: (value.pendingCount || 0) - 1,
                pendingPaths: (value.pendingPaths || []).filter((item: string) => item !== path),
              }
            : {}),
        });
      }
      tx.update(ref, {
        status: bytes === null ? 'expired' : 'finalized',
        actualBytes: bytes,
        expiresAt: null,
        ...(bytes !== null ? { finalizedAt: now } : {}),
      });
    });
  }
  return {
    read,
    async claim(path: string, uid: string, now: number) {
      await db.runTransaction(async (tx) => {
        const ref = uploads.doc(uploadId(path));
        const row = (await tx.get(ref)).data();
        if (!row || row.path !== path || !['finalized', 'claimed'].includes(row.status))
          fail(410, '檔案已失效，請重新上傳');
        if (row!.uid !== uid) fail(403, 'File access denied');
        const scope = parsePrivateFilePath(path);
        if (scope?.kind === 'story') {
          const story = await tx.get(db.collection('campusStories').doc(scope.storyId!));
          const data = story.data();
          if (story.exists && (row!.status !== 'claimed' || data?.authorUid !== uid ||
            data?.schoolId !== scope.schoolId || data?.mediaUrl !== path)) fail(403, 'File access denied');
        }
        if (scope?.kind === 'group-cover' && row!.status !== 'claimed') {
          const covers = await tx.get(uploads.where('kind', '==', 'group-cover'));
          for (const previous of covers.docs) {
            const data = previous.data();
            if (data.path !== path && data.status === 'claimed' &&
              parsePrivateFilePath(data.path)?.groupId === scope.groupId)
              tx.update(previous.ref, { status: 'released', releasedAt: now });
          }
        }
        tx.update(ref, { status: 'claimed', claimedAt: now });
      });
    },
    async reserve(scope: PrivateFileScope, uid: string, now: number) {
      await db.runTransaction(async (tx) => {
        const ref = uploads.doc(uploadId(scope.path));
        const user = quota.doc(userId(uid));
        const [record, globalSnap, userSnap] = await tx.getAll(ref, global, user);
        if (record.exists) fail(409, '此檔案路徑已使用，請重新選擇檔案');
        const g = globalSnap.data() || {};
        const u = userSnap.data() || {};
        if (
          (u.pendingCount || 0) >= MAX_PENDING_UPLOADS ||
          (u.reservedBytes || 0) + (u.finalizedBytes || 0) + UPLOAD_RESERVED_BYTES >
            USER_FILE_QUOTA_BYTES
        )
          fail(429, '個人檔案配額已滿，請稍後再試');
        if (
          (g.reservedBytes || 0) + (g.finalizedBytes || 0) + UPLOAD_RESERVED_BYTES >
          GLOBAL_FILE_QUOTA_BYTES
        )
          fail(507, '檔案儲存空間已滿，請稍後再試');
        tx.create(ref, {
          path: scope.path,
          uid,
          kind: scope.kind,
          reservedBytes: UPLOAD_RESERVED_BYTES,
          status: 'pending',
          expiresAt: now + UPLOAD_URL_TTL_MS,
          createdAt: now,
        });
        for (const [ref, value] of [
          [global, g],
          [user, u],
        ] as const)
          tx.set(ref, {
            reservedBytes: (value.reservedBytes || 0) + UPLOAD_RESERVED_BYTES,
            finalizedBytes: value.finalizedBytes || 0,
            ...(ref.path === user.path
              ? {
                  pendingCount: (value.pendingCount || 0) + 1,
                  pendingPaths: [...(value.pendingPaths || []), scope.path],
                }
              : {}),
          });
      });
    },
    async confirmTicket(path: string, uid: string, now: number) {
      await db.runTransaction(async (tx) => {
        const ref = uploads.doc(uploadId(path));
        const row = (await tx.get(ref)).data();
        if (!row || row.uid !== uid || row.status !== 'pending')
          fail(409, '上傳已過期，請重新上傳');
        tx.update(ref, { expiresAt: now + UPLOAD_URL_TTL_MS });
      });
    },
    async invalidate(path: string, uid: string) {
      // Keep the reservation until token expiry: deletion permits token reuse.
      return db.runTransaction(async (tx) => {
        const ref = uploads.doc(uploadId(path));
        const snap = await tx.get(ref);
        const row = snap.data();
        if (row?.uid !== uid || row.status !== 'pending') return false;
        tx.update(ref, { invalid: true });
        return true;
      });
    },
    finalize: settle,
    async cleanup(now: number, limit = CLEANUP_CANDIDATE_LIMIT, uid?: string) {
      const maximum = Math.min(CLEANUP_CANDIDATE_LIMIT, Math.max(1, limit));
      const budget = new CleanupReadBudget(uid ? SIGNING_CLEANUP_READ_BUDGET : SCHEDULED_CLEANUP_READ_BUDGET);
      const cursor = db.collection('privateFileCleanup').doc('cursor');
      budget.spend(1);
      const cursorId = (await cursor.get()).data()?.lastId;
      if (uid) budget.spend(1);
      const own = uid ? (await quota.doc(userId(uid)).get()).data()?.pendingPaths || [] : [];
      budget.spend(Math.min(own.length, MAX_PENDING_UPLOADS));
      const ownRows = await Promise.all((own as string[]).slice(0, MAX_PENDING_UPLOADS)
        .map((path) => uploads.doc(uploadId(path)).get()));
      const pending = (await budget.query(uploads.where('expiresAt', '<=', now).orderBy('expiresAt'), maximum)).result;
      const deleting = (await budget.query(uploads.where('status', '==', 'deleting'), maximum)).result;
      // Single-field indexes only. Persist the scan position so live references
      // cannot starve later finalized rows; wrap after reaching the end.
      let scan = uploads.where('status', 'in', ['finalized', 'claimed', 'released']).orderBy('__name__');
      if (typeof cursorId === 'string') scan = scan.startAfter(cursorId);
      let finalized = (await budget.query(scan, maximum)).result;
      if (finalized.empty && cursorId)
        finalized = (await budget.query(uploads.where('status', 'in', ['finalized', 'claimed', 'released']).orderBy('__name__'), maximum)).result;
      let cleaned = 0;
      const candidates = new Map([...ownRows, ...pending.docs, ...deleting.docs, ...finalized.docs].map((snap) => [snap.id, snap]));
      let lastScanned: string | null = null;
      for (const snap of [...candidates.values()].slice(0, maximum)) {
        if (budget.remaining < 1) break;
        try {
          const row = snap.data();
          if (!row) continue;

          const claimed = await db.runTransaction(async (rawTx) => {
            const tx = budget.transaction(rawTx);
            const current = (await tx.get(snap.ref)).data();
            if (!current || current.path !== row.path) return false;
            if (['finalized', 'claimed', 'released', 'deleting'].includes(current.status)) {
              // Recheck on every transaction retry, including interrupted removals.
              if (current.status !== row.status || current.claimedAt !== row.claimedAt ||
                current.finalizedAt !== row.finalizedAt || current.releasedAt !== row.releasedAt ||
                await hasReferences(db, tx, current.path, budget)) return false;
            }
            if (current.status === 'deleting') return true;
            if (current.status === 'released') {
              const scope = parsePrivateFilePath(current.path);
              if (scope?.kind !== 'group-cover' || !Number.isFinite(current.releasedAt) ||
                current.releasedAt + ORPHAN_GRACE_MS > now) return false;
              const group = await tx.get(db.collection('groups').doc(scope.groupId!));
              if (group.data()?.coverUrl === current.path) return false;
              tx.update(snap.ref, { status: 'deleting' });
            } else if (['finalized', 'claimed'].includes(current.status)) {
              // A claim after the scan always wins, including on transaction retry.
              if (current.status !== row.status || current.claimedAt !== row.claimedAt) return false;
              if (current.status === 'finalized') {
                if (current.finalizedAt == null) {
                  tx.update(snap.ref, { finalizedAt: now });
                  return false;
                }
                if (!Number.isFinite(current.finalizedAt) || current.finalizedAt + SUBMISSION_GRACE_MS >= now)
                  return false;
              } else {
                const scope = parsePrivateFilePath(current.path);
                if (!scope || !Number.isFinite(current.claimedAt)) return false;
                // Give every claimed container a full day to finish publication.
                if (current.claimedAt + SUBMISSION_GRACE_MS >= now ||
                  !await isOrphan(db, tx, current.path, now)) return false;
              }
              tx.update(snap.ref, { status: 'deleting' });
            } else {
              if (!['pending', 'cleaning'].includes(current.status) || current.expiresAt > now) return false;
              tx.update(snap.ref, { status: 'cleaning' });
            }
            return true;
          });
          if (budget.remaining === 0) break;
          if (['finalized', 'claimed', 'released'].includes(row.status)) lastScanned = snap.id;
          if (!claimed) continue;
          // Keep deleting/cleaning state retryable if settlement runs out of budget.
          await storage.remove(row.path);
          if (['finalized', 'claimed', 'released', 'deleting'].includes(row.status)) {
            await db.runTransaction(async (rawTx) => {
              const tx = budget.transaction(rawTx);
              const user = quota.doc(userId(row.uid));
              const [record, globalSnap, userSnap] = await tx.getAll(snap.ref, global, user);
              const current = record.data();
              if (current?.status !== 'deleting') return;
              for (const [ref, value] of [[global, globalSnap.data()], [user, userSnap.data()]] as const)
                tx.set(ref, { ...value, finalizedBytes: (value?.finalizedBytes || 0) - current.actualBytes });
              tx.update(snap.ref, { status: 'deleted', deletedAt: now });
            });
          } else await settle(row.path, row.uid, null, now, budget);
          cleaned++;
        } catch (error) {
          if (error === BUDGET_EXHAUSTED) break;
          throw error;
        }
      }
      if (lastScanned) await cursor.set({ lastId: lastScanned });
      else if (finalized.empty) await cursor.set({ lastId: null });
      return cleaned;
    },
  };
}

// Server-only scheduled cleanup; no HTTP endpoint is exposed.
export async function cleanupExpiredPrivateFileUploads(
  db: Firestore,
  storage: FileStorage,
  now = Date.now(),
  limit = CLEANUP_CANDIDATE_LIMIT,
) {
  return createPrivateFileUploads(db, storage).cleanup(now, limit);
}
