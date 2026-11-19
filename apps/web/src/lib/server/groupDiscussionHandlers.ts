import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from './groupInviteHandlers';
import { HttpsError } from './httpsError';

function validId(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 160 && !value.includes('/');
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
    const member = await group.collection('members').doc(uid).get();
    if (!member.exists || member.data()?.status !== 'active') {
      throw new HttpsError('permission-denied', '僅限有效群組成員讀取');
    }
    const postsRef = group.collection('posts');
    const base = postsRef.orderBy('createdAt', 'desc');
    let scan = base;
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
      // Resume at the timestamp, then apply the implicit descending document-ID
      // boundary in process. This uses only the createdAt single-field index and
      // remains valid if the cursor document has been deleted.
      scan = base.startAt(boundary.time);
    }
    const posts: Record<string, unknown>[] = [];
    let nextCursor: { id: string; createdAt: { seconds: number; nanoseconds: number } } | null =
      null;
    const batchSize = Math.max(size + 1, 50);
    while (true) {
      const batch = await scan.limit(batchSize).get();
      for (const doc of batch.docs) {
        const data = doc.data();
        const time = data.createdAt as Timestamp;
        if (
          boundary &&
          time.isEqual(boundary.time) &&
          Buffer.compare(Buffer.from(doc.id), Buffer.from(boundary.id)) >= 0
        )
          continue;
        if (
          data.published === false ||
          (typeof data.status === 'string' && data.status !== 'published') ||
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
      if (batch.docs.length < batchSize) return { posts, cursor: nextCursor, hasMore: false };
      scan = base.startAfter(batch.docs[batch.docs.length - 1]!);
    }
  }
  return { listGroupDiscussionPage };
}
