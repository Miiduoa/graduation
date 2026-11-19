import { FieldPath, Timestamp, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { CallableRequest } from './groupInviteHandlers';
import { HttpsError } from './httpsError';
import { isAccountUnavailable } from './dmConversationsHandler';

function validId(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 160 && !value.includes('/');
}

/** Normalize Timestamp, ISO/date strings, millis, or {seconds,nanoseconds} for stable sort and cursors. */
export function createdAtTime(value: unknown): Timestamp {
  if (value instanceof Timestamp) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Timestamp.fromMillis(value.getTime());
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return Timestamp.fromMillis(ms);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : value;
    if (ms >= 0) return Timestamp.fromMillis(ms);
  }
  if (value && typeof value === 'object') {
    const rec = value as { seconds?: unknown; nanoseconds?: unknown; _seconds?: unknown; _nanoseconds?: unknown };
    const seconds = rec.seconds ?? rec._seconds;
    const nanos = rec.nanoseconds ?? rec._nanoseconds ?? 0;
    if (typeof seconds === 'number' && Number.isInteger(seconds) && typeof nanos === 'number' && Number.isInteger(nanos)) {
      return new Timestamp(seconds, nanos);
    }
  }
  return new Timestamp(0, 0);
}

export function createGroupDiscussionHandlers({ db }: { db: Firestore }) {
  async function listGroupDiscussionPage(request: CallableRequest) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入');
    const input = (request.data ?? {}) as Record<string, unknown>;
    if (!validId(input.groupId)) throw new HttpsError('invalid-argument', '群組代碼無效');
    const pageSize = input.pageSize ?? 20;
    if (!Number.isInteger(pageSize) || (pageSize as number) < 1) {
      throw new HttpsError('invalid-argument', '分頁大小無效');
    }
    const size = Math.min(pageSize as number, 50);
    const group = db.collection('groups').doc(input.groupId);
    const [profile, groupSnapshot, member] = await Promise.all([
      db.collection('users').doc(uid).get(),
      group.get(),
      group.collection('members').doc(uid).get(),
    ]);
    const schoolId = groupSnapshot.data()?.schoolId;
    // Missing legacy profiles are allowed, just as in isSignedIn. School
    // membership belongs to this group, regardless of the user's current school.
    if (
      (profile.exists && isAccountUnavailable(profile.data())) ||
      !groupSnapshot.exists || !validId(schoolId) ||
      !member.exists || member.data()?.status !== 'active'
    ) {
      throw new HttpsError('permission-denied', '僅限有效群組成員讀取');
    }
    const schoolMember = await db.collection('schools').doc(schoolId).collection('members').doc(uid).get();
    if (!schoolMember.exists || schoolMember.data()?.status !== 'active') {
      throw new HttpsError('permission-denied', '僅限有效群組成員讀取');
    }
    const postsRef = group.collection('posts');
    const base = postsRef.orderBy('createdAt', 'desc');
    let boundary: { id: string; time: Timestamp } | null = null;
    if (input.cursor != null) {
      const cursor = input.cursor as {
        createdAt?: { seconds?: number; nanoseconds?: number };
        id?: unknown;
      };
      const time = cursor.createdAt;
      if (
        !validId(cursor.id) ||
        !time ||
        !Number.isInteger(time.seconds) ||
        !Number.isInteger(time.nanoseconds) ||
        time.nanoseconds! < 0 ||
        time.nanoseconds! >= 1e9 ||
        time.seconds! < -62135596800 ||
        time.seconds! > 253402300799
      ) {
        throw new HttpsError('invalid-argument', '分頁游標無效');
      }
      boundary = { id: cursor.id, time: new Timestamp(time.seconds!, time.nanoseconds!) };
    }
    type PostDoc = QueryDocumentSnapshot;
    async function readPage(globalDocs?: PostDoc[]) {
      const posts: Record<string, unknown>[] = [];
      let nextCursor: { id: string; createdAt: { seconds: number; nanoseconds: number } } | null =
        null;
      const batchSize = Math.max(size + 1, 50);
      // Apply the cursor only in process so ISO-string and Timestamp createdAt
      // values stay in one order. startAt(Timestamp) would skip legacy string rows.
      let scan = base;
      while (true) {
        const batch = globalDocs ? { docs: globalDocs } : await scan.limit(batchSize).get();
        for (const doc of batch.docs) {
          const data = doc.data();
          // Legacy ISO/date strings and Timestamp values must sort and page the same way.
          const time = createdAtTime(data.createdAt);
          if (
            boundary &&
            (time.seconds > boundary.time.seconds ||
              (time.seconds === boundary.time.seconds && time.nanoseconds > boundary.time.nanoseconds) ||
              (time.isEqual(boundary.time) &&
                Buffer.compare(Buffer.from(doc.id), Buffer.from(boundary.id)) >= 0))
          )
            continue;
          if (
            data.published === false ||
            [
              'draft', 'scheduled', 'pending', 'unpublished',
              'archived', 'cancelled', 'canceled', 'deleted',
            ].includes(data.status) ||
            data.deleted === true ||
            data.deletedAt != null
          )
            continue;
          // Look ahead by one visible row, without advancing the returned cursor past it.
          if (posts.length === size) return { posts, cursor: nextCursor, hasMore: true };
          nextCursor = {
            id: doc.id,
            createdAt: { seconds: time.seconds, nanoseconds: time.nanoseconds },
          };
          posts.push({
            ...data,
            id: doc.id,
            createdAt: nextCursor.createdAt,
            ...(data.pinnedAt instanceof Timestamp
              ? {
                  pinnedAt: {
                    seconds: data.pinnedAt.seconds,
                    nanoseconds: data.pinnedAt.nanoseconds,
                  },
                }
              : {}),
          });
        }
        if (globalDocs || batch.docs.length < batchSize) {
          return { posts, cursor: nextCursor, hasMore: false };
        }
        scan = base.startAfter(batch.docs[batch.docs.length - 1]!);
      }
    }
    try {
      // Probe raw canonical rows independently of the cursor and visibility.
      // Hidden rows and exhausted pages must never activate the legacy fallback.
      const canonical = await base.limit(1).get();
      if (canonical.docs.length > 0) return await readPage();
    } catch {
      // Match the legacy read path when the canonical read is unavailable.
    }
    // Equality plus document-ID ordering uses the automatic single-field index.
    // Scan before sorting: document-ID batches do not represent the newest rows.
    // At the safety cap, paginate only the documents actually collected.
    const maxLegacyRows = 5000;
    const legacyBatchSize = 500;
    const legacyBase = db.collection('groupPosts')
      .where('groupId', '==', input.groupId)
      .orderBy(FieldPath.documentId());
    const legacyDocs: PostDoc[] = [];
    let legacyScan = legacyBase;
    while (legacyDocs.length < maxLegacyRows) {
      const count = Math.min(legacyBatchSize, maxLegacyRows - legacyDocs.length);
      const batch = await legacyScan.limit(count).get();
      legacyDocs.push(...batch.docs);
      if (batch.docs.length < count) break;
      legacyScan = legacyBase.startAfter(batch.docs[batch.docs.length - 1]!);
    }
    const timeOf = (doc: PostDoc): Timestamp => createdAtTime(doc.data().createdAt);
    const sorted = legacyDocs.sort((a, b) => {
      const left = timeOf(a);
      const right = timeOf(b);
      return (
        right.seconds - left.seconds || right.nanoseconds - left.nanoseconds ||
        Buffer.compare(Buffer.from(b.id), Buffer.from(a.id))
      );
    });
    return readPage(sorted);
  }
  return { listGroupDiscussionPage };
}
