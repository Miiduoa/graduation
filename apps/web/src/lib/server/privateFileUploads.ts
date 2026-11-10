import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
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

export const MAX_FILE_REFS = 4;
const BUDGET_EXHAUSTED = new Error('Cleanup read budget exhausted');
export const SCHEDULED_CLEANUP_READ_BUDGET = 390;
export const CLEANUP_DAILY_READ_BUDGET = 5000;
export const CLEANUP_CANDIDATE_LIMIT = 20;
export const CLEANUP_LEASE_MS = 25 * 60_000;

export function privateFileReference(path: string): string {
  const scope = parsePrivateFilePath(path);
  if (!scope) return fail(400, 'Invalid private file path');
  return scope.kind === 'story' ? `campusStories/${scope.storyId}`
    : scope.kind === 'group-cover' ? `groups/${scope.groupId}`
    : path.slice(0, path.lastIndexOf('/'));
}

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
  db: Firestore, tx: FirebaseFirestore.Transaction, path: string, refs: string[], now: number,
): Promise<boolean> {
  // Only server-recorded claims count. Direct cross-document writes without a
  // claim remain a known limitation of the existing client write rules.
  for (const ref of refs) {
    const snap = await tx.get(db.doc(ref));
    if (!snap.exists) continue;
    const row = snap.data()!;
    if (ref.startsWith('campusStories/')) {
      const value = row.expiresAt;
      const expiry = typeof value === 'number' ? value : value instanceof Date ? value.getTime()
        : typeof value?.toMillis === 'function' ? value.toMillis() : Date.parse(value);
      if (Number.isFinite(expiry) && expiry + ORPHAN_GRACE_MS < now) continue;
    }
    if (row.mediaUrl === path || row.coverUrl === path || attachmentReferences(row.attachments, path)) return true;
  }
  return false;
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
  async function settle(path: string, uid: string, bytes: number | null, now = Date.now(), budget?: CleanupReadBudget, leaseOwner?: string) {
    return db.runTransaction(async (rawTx) => {
      const tx = budget ? budget.transaction(rawTx) : rawTx;
      if (leaseOwner && (await tx.get(db.collection('privateFileCleanup').doc('lease'))).data()?.owner !== leaseOwner)
        throw BUDGET_EXHAUSTED;
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
    async claim(path: string, uid: string, now: number, reference = privateFileReference(path)) {
      if (reference !== privateFileReference(path)) fail(403, 'File access denied');
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
        const refs = [...new Set([...(row!.refs || [privateFileReference(path)]), reference])];
        if (refs.length > MAX_FILE_REFS) fail(409, 'Too many file references');
        if (scope?.kind === 'group-cover' && row!.status !== 'claimed') {
          // Rules have no matching allow for this top-level collection: Admin only.
          const state = db.collection('privateFileGroupCovers').doc(scope.groupId!);
          const previousId = (await tx.get(state)).data()?.current;
          const previous = typeof previousId === 'string' && previousId !== ref.id
            ? await tx.get(uploads.doc(previousId)) : null;
          if (previous?.data()?.status === 'claimed')
            tx.update(previous.ref, { status: 'released', releasedAt: now });
          tx.set(state, { current: ref.id, pendingRelease: previousId || null });
        }
        tx.update(ref, { status: 'claimed', claimedAt: now, refs });
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
          refs: [privateFileReference(scope.path)],
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
    async cleanup(now: number, limit = CLEANUP_CANDIDATE_LIMIT) {
      const maximum = Math.min(CLEANUP_CANDIDATE_LIMIT, Math.max(1, limit));
      const startedAt = Date.now();
      const lease = db.collection('privateFileCleanup').doc('lease');
      const owner = randomUUID();
      const daily = db.collection('privateFileCleanup').doc(`day-${new Date(now).toISOString().slice(0, 10)}`);
      // Precharge 400 reads per accepted run, even on failure; never refund.
      // At most 12 runs/site/day: <= 4,800 worker reads, <= 996 writes
      // (20 * 4 candidate/settlement writes + cursor + lease + daily per run).
      // This includes transaction retries through the local 390-read meter.
      // Lease/budget admission adds 2 reads per invocation, including rejected
      // contenders; admission disables SDK retries. This polling overhead
      // depends on replica count; worker work is globally capped.
      // With R continuously running replicas (48 polls/day each), the worst
      // total is <= 4,800 + 96*R reads and 996 writes/day. For R <= 10 this
      // is <= 5,760 reads, far below Spark's 50k reads / 20k writes. No
      // Firestore lease can bound probes from arbitrarily many new replicas.
      const acquired = await db.runTransaction(async (tx) => {
        const [held, day] = await tx.getAll(lease, daily);
        if ((held.data()?.until || 0) > now || (day.data()?.reads || 0) + 400 > CLEANUP_DAILY_READ_BUDGET) return false;
        tx.set(lease, { until: now + CLEANUP_LEASE_MS, owner });
        tx.set(daily, { reads: (day.data()?.reads || 0) + 400 });
        return true;
      }, { maxAttempts: 1 });
      if (!acquired) return 0;
      const budget = new CleanupReadBudget(SCHEDULED_CLEANUP_READ_BUDGET);
      const cursor = db.collection('privateFileCleanup').doc('cursor');
      // Lease stays held on success/failure. Stop starting work after 20 min,
      // leaving five minutes for outstanding storage/Firestore operations.
      budget.spend(1);
      const cursorId = (await cursor.get()).data()?.lastId;
      // Document-name ordering only: no field filters or composite indexes.
      // Terminal records also advance the durable cursor; wrap on an empty page.
      let scan: FirebaseFirestore.Query = uploads.orderBy('__name__');
      if (typeof cursorId === 'string') scan = scan.startAfter(cursorId);
      let page = (await budget.query(scan, maximum)).result;
      if (page.empty && cursorId)
        page = (await budget.query(uploads.orderBy('__name__'), maximum)).result;
      let cleaned = 0;
      let lastScanned: string | null = null;
      for (const snap of page.docs) {
        if (Date.now() - startedAt >= 20 * 60_000) break;
        if (budget.remaining < 1) break;
        try {
          const row = snap.data();
          if (!row) continue;

          const claimed = await db.runTransaction(async (rawTx) => {
            const tx = budget.transaction(rawTx);
            if (Date.now() - startedAt >= 20 * 60_000 || (await tx.get(lease)).data()?.owner !== owner) return false;
            const current = (await tx.get(snap.ref)).data();
            if (!current || current.path !== row.path) return false;
            if (['finalized', 'claimed', 'released', 'deleting'].includes(current.status)) {
              // Recheck on every transaction retry, including interrupted removals.
              if (current.status !== row.status || current.claimedAt !== row.claimedAt ||
                current.finalizedAt !== row.finalizedAt || current.releasedAt !== row.releasedAt ||
                await hasReferences(db, tx, current.path, (current.refs || [privateFileReference(current.path)]).slice(0, MAX_FILE_REFS), now)) return false;
            }
            if (current.status === 'deleting') return true;
            if (current.status === 'released') {
              const scope = parsePrivateFilePath(current.path);
              if (scope?.kind !== 'group-cover' || !Number.isFinite(current.releasedAt) ||
                current.releasedAt + ORPHAN_GRACE_MS > now) return false;
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
                // Publication grace: two hours for covers/stories, one day for attachments.
                if (current.claimedAt + (['group-cover', 'story'].includes(scope.kind) ? ORPHAN_GRACE_MS : SUBMISSION_GRACE_MS) >= now) return false;
              }
              tx.update(snap.ref, { status: 'deleting' });
            } else {
              if (!['pending', 'cleaning'].includes(current.status) || current.expiresAt > now) return false;
              tx.update(snap.ref, { status: 'cleaning' });
            }
            return true;
          });
          if (budget.remaining === 0 || Date.now() - startedAt >= 20 * 60_000) break;
          lastScanned = snap.id;
          if (!claimed) continue;
          // Keep deleting/cleaning state retryable if settlement runs out of budget.
          await storage.remove(row.path);
          if (['finalized', 'claimed', 'released', 'deleting'].includes(row.status)) {
            await db.runTransaction(async (rawTx) => {
              const tx = budget.transaction(rawTx);
              if ((await tx.get(lease)).data()?.owner !== owner) throw BUDGET_EXHAUSTED;
              const user = quota.doc(userId(row.uid));
              const [record, globalSnap, userSnap] = await tx.getAll(snap.ref, global, user);
              const current = record.data();
              if (current?.status !== 'deleting') return;
              for (const [ref, value] of [[global, globalSnap.data()], [user, userSnap.data()]] as const)
                tx.set(ref, { ...value, finalizedBytes: (value?.finalizedBytes || 0) - current.actualBytes });
              tx.update(snap.ref, { status: 'deleted', deletedAt: now });
            });
          } else await settle(row.path, row.uid, null, now, budget, owner);
          cleaned++;
        } catch (error) {
          if (error === BUDGET_EXHAUSTED) break;
          throw error;
        }
      }
      if (budget.remaining > 0) await db.runTransaction(async (rawTx) => {
        const tx = budget.transaction(rawTx);
        if ((await tx.get(lease)).data()?.owner !== owner || Date.now() - startedAt >= CLEANUP_LEASE_MS) return;
        if (lastScanned) tx.set(cursor, { lastId: lastScanned });
        else if (page.empty) tx.set(cursor, { lastId: null });
      });
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
