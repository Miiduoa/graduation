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
  // Cleanup relies on writers restricting paths to their own container namespace.
  return scope.kind === 'group-post' &&
    (row.deleted === true || row.isDeleted === true || row.deletedAt != null || row.status === 'deleted');
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
  async function settle(path: string, uid: string, bytes: number | null, now = Date.now()) {
    return db.runTransaction(async (tx) => {
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
    async cleanup(now: number, limit = 20, uid?: string) {
      const maximum = Math.min(50, Math.max(1, limit));
      const cursor = db.collection('privateFileCleanup').doc('cursor');
      const cursorId = (await cursor.get()).data()?.lastId;
      const own = uid ? (await quota.doc(userId(uid)).get()).data()?.pendingPaths || [] : [];
      const ownRows = await Promise.all((own as string[]).slice(0, MAX_PENDING_UPLOADS)
        .map((path) => uploads.doc(uploadId(path)).get()));
      const pending = await uploads.where('expiresAt', '<=', now).orderBy('expiresAt').limit(maximum).get();
      const deleting = await uploads.where('status', '==', 'deleting').limit(maximum).get();
      // Single-field indexes only. Persist the scan position so live references
      // cannot starve later finalized rows; wrap after reaching the end.
      let scan = uploads.where('status', 'in', ['finalized', 'claimed']).orderBy('__name__');
      if (typeof cursorId === 'string') scan = scan.startAfter(cursorId);
      let finalized = await scan.limit(maximum).get();
      if (finalized.empty && cursorId)
        finalized = await uploads.where('status', 'in', ['finalized', 'claimed']).orderBy('__name__').limit(maximum).get();
      let cleaned = 0;
      const candidates = new Map([...ownRows, ...pending.docs, ...deleting.docs, ...finalized.docs].map((snap) => [snap.id, snap]));
      let lastScanned: string | null = null;
      for (const snap of [...candidates.values()].slice(0, maximum)) {
        const row = snap.data();
        if (!row) continue;
        if (['finalized', 'claimed'].includes(row.status)) lastScanned = snap.id;
        const claimed = await db.runTransaction(async (tx) => {
          const current = (await tx.get(snap.ref)).data();
          if (!current || current.path !== row.path) return false;
          if (current.status === 'deleting') return true;
          if (['finalized', 'claimed'].includes(current.status)) {
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
        if (!claimed) continue;
        await storage.remove(row.path);
        if (['finalized', 'claimed', 'deleting'].includes(row.status)) {
          await db.runTransaction(async (tx) => {
            const user = quota.doc(userId(row.uid));
            const [record, globalSnap, userSnap] = await tx.getAll(snap.ref, global, user);
            const current = record.data();
            if (current?.status !== 'deleting') return;
            for (const [ref, value] of [[global, globalSnap.data()], [user, userSnap.data()]] as const)
              tx.set(ref, { ...value, finalizedBytes: (value?.finalizedBytes || 0) - current.actualBytes });
            tx.update(snap.ref, { status: 'deleted', deletedAt: now });
          });
        } else await settle(row.path, row.uid, null);
        cleaned++;
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
  limit = 20,
) {
  return createPrivateFileUploads(db, storage).cleanup(now, limit);
}
