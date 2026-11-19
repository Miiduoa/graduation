import { Timestamp, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { CallableRequest } from './groupInviteHandlers';
import { HttpsError } from './httpsError';
import { isAccountUnavailable } from './dmConversationsHandler';

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
      // Resume using the single-field index, then apply timestamp/document-ID
      // boundaries in process, even if the cursor document has been deleted.
      let scan = boundary ? base.startAt(boundary.time) : base;
      while (true) {
        const batch = globalDocs ? { docs: globalDocs } : await scan.limit(batchSize).get();
        for (const doc of batch.docs) {
          const data = doc.data();
          // Legacy rows without a timestamp use the epoch for a stable JSON cursor.
          const time = data.createdAt instanceof Timestamp ? data.createdAt : new Timestamp(0, 0);
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
    // Equality-only query uses the automatic single-field index. Read one extra
    // row to detect overflow; never return a partial or incorrectly sorted page.
    const maxLegacyRows = 500;
    const legacy = await db.collection('groupPosts')
      .where('groupId', '==', input.groupId)
      .limit(maxLegacyRows + 1)
      .get();
    if (legacy.docs.length > maxLegacyRows) {
      throw new HttpsError('resource-exhausted', '群組歷史貼文超過讀取上限，請聯絡管理員');
    }
    const timeOf = (doc: PostDoc): Timestamp => {
      const value = doc.data().createdAt;
      return value instanceof Timestamp ? value : new Timestamp(0, 0);
    };
    const sorted = [...legacy.docs].sort((a, b) => {
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
