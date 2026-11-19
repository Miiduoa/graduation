// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { createGroupDiscussionHandlers } from './groupDiscussionHandlers';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';

type Row = { id: string; createdAt: Timestamp | string; [key: string]: unknown };
const testTime = (value: Timestamp | string) =>
  value instanceof Timestamp ? value : Timestamp.fromDate(new Date(value));

function setup(rows: Row[], status: string | null = 'active', options: { profile?: Record<string, unknown> | null; group?: Record<string, unknown> | null; schoolStatus?: string | null; globalRows?: Row[]; canonicalError?: boolean } = {}) {
  const writes = vi.fn(() => {
    throw new Error('Listing must not write');
  });
  const reads = vi.fn();
  const globalReads = vi.fn();
  const membershipReads = vi.fn();
  const isDocumentId = (field: unknown): field is FieldPath =>
    typeof field === 'object' && !!field && 'isEqual' in field && (field as FieldPath).isEqual(FieldPath.documentId());
  const typeRank = (value: Timestamp | string) => (typeof value === 'string' ? 4 : 3);
  // Firestore descending createdAt: strings (type 4) precede Timestamps (type 3).
  const byFirestoreCreatedAtDesc = [...rows].sort((a, b) => {
    const rankDiff = typeRank(b.createdAt) - typeRank(a.createdAt);
    if (rankDiff) return rankDiff;
    if (typeof a.createdAt === 'string' && typeof b.createdAt === 'string') {
      return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
    }
    return testTime(b.createdAt).toMillis() - testTime(a.createdAt).toMillis() || b.id.localeCompare(a.id);
  });
  const byDocumentId = [...rows].sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  function query(source: Row[] = byDocumentId, offset = 0, count = Infinity): any {
    return {
      orderBy: (field?: unknown, direction?: string) => {
        if (isDocumentId(field)) return query(byDocumentId, offset, count);
        if (field === 'createdAt') {
          expect(direction).toBe('desc');
          return query(byFirestoreCreatedAtDesc, offset, count);
        }
        return query(source, offset, count);
      },
      startAfter: (doc: { id: string }) => {
        const next = source.findIndex((row) => row.id === doc.id) + 1;
        return query(source, next > 0 ? next : source.length, count);
      },
      limit: (size: number) => query(source, offset, size),
      doc: (id: string) => ({ id }),
      get: async () => {
        reads();
        if (options.canonicalError) throw new Error('canonical read failed');
        return {
          docs: source
            .slice(offset, offset + count)
            .map((row) => ({ id: row.id, data: () => row })),
        };
      },
      set: writes,
      update: writes,
      delete: writes,
      add: writes,
    };
  }
  const db = {
    collection: (root: string) => root === 'groupPosts' ? {
      where: (field: string, operator: string, value: string) => {
        expect([field, operator, value]).toEqual(['groupId', '==', 'g1']);
        const orderedGlobal = [...(options.globalRows ?? [])].sort((a, b) =>
          Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
        function globalQuery(offset = 0, count = Infinity): any {
          return {
            orderBy: (field: FieldPath) => {
              expect(field.isEqual(FieldPath.documentId())).toBe(true);
              return globalQuery(offset, count);
            },
            startAfter: (doc: { id: string }) => {
              const next = orderedGlobal.findIndex(row => row.id === doc.id) + 1;
              expect(next).toBeGreaterThan(0);
              return globalQuery(next, count);
            },
            limit: (size: number) => globalQuery(offset, size),
            get: async () => {
              globalReads(count, offset);
              return { docs: orderedGlobal.slice(offset, offset + count)
                .map(row => ({ id: row.id, data: () => row })) };
            },
          };
        }
        return globalQuery();
      },
      set: writes, update: writes, delete: writes, add: writes,
    } : ({
      doc: (parentId: string) => ({
        get: async () => {
          const data = root === 'users'
            ? (options.profile === undefined ? { status: 'active' } : options.profile)
            : (options.group === undefined ? { schoolId: 'pu' } : options.group);
          return { exists: data !== null, data: () => data };
        },
        set: writes, update: writes, delete: writes,
        collection: (name: string) =>
          name === 'posts'
            ? query()
            : {
                doc: (uid: string) => ({
                  get: async () => {
                    membershipReads(`${root}/${parentId}/${name}/${uid}`);
                    const value = root === 'schools'
                      ? (options.schoolStatus === undefined ? 'active' : options.schoolStatus)
                      : status;
                    return { exists: value !== null, data: () => ({ status: value }) };
                  },
                  set: writes, update: writes, delete: writes,
                }),
              },
      }),
    }),
    runTransaction: writes,
    batch: writes,
  } as unknown as Firestore;
  return { db, writes, reads, globalReads, membershipReads, list: createGroupDiscussionHandlers({ db }).listGroupDiscussionPage };
}
const row = (id: string, extra: Record<string, unknown> = {}): Row => ({
  id,
  createdAt: new Timestamp(100, 123),
  title: id,
  ...extra,
});
const request = (data: Record<string, unknown> = {}) => ({
  auth: { uid: 'alice' },
  data: { groupId: 'g1', ...data },
});

it('includes legacy, partially populated and four-field published posts without writes', async () => {
  const { list, writes } = setup([
    row('legacy'),
    row('active', { status: 'active' }),
    row('empty-status', { status: '' }),
    row('partial', { published: true }),
    row('published', { published: true, status: 'published', deleted: false, deletedAt: null }),
  ]);
  const page = await list(request());
  expect(page.posts.map((p) => p.id).sort()).toEqual(['active', 'empty-status', 'legacy', 'partial', 'published']);
  expect(page.hasMore).toBe(false);
  expect(writes).not.toHaveBeenCalled();
});

it('pages ISO-string createdAt posts in chronological order', async () => {
  const { list } = setup([
    row('c', { createdAt: '2024-05-03T00:00:00.000Z', status: 'active' }),
    row('b', { createdAt: '2024-05-02T00:00:00.000Z', status: 'active' }),
    row('a', { createdAt: '2024-05-01T00:00:00.000Z', status: 'active' }),
  ]);
  const first = await list(request({ pageSize: 1 }));
  expect(first.posts.map((p) => p.id)).toEqual(['c']);
  expect(first.hasMore).toBe(true);
  const second = await list(request({ pageSize: 1, cursor: first.cursor }));
  expect(second.posts.map((p) => p.id)).toEqual(['b']);
  expect(second.hasMore).toBe(true);
  const third = await list(request({ pageSize: 1, cursor: second.cursor }));
  expect(third.posts.map((p) => p.id)).toEqual(['a']);
  expect(third.hasMore).toBe(false);
});

it('pages mixed ISO-string and Timestamp createdAt in parsed-time order', async () => {
  const { list } = setup([
    row('iso-0501', { createdAt: '2024-05-01T00:00:00.000Z', status: 'active' }),
    row('ts-0503', { createdAt: Timestamp.fromDate(new Date('2024-05-03T00:00:00.000Z')), status: 'active' }),
    row('ts-0430', { createdAt: Timestamp.fromDate(new Date('2024-04-30T00:00:00.000Z')), status: 'active' }),
  ]);
  const first = await list(request({ pageSize: 1 }));
  expect(first.posts.map((p) => p.id)).toEqual(['ts-0503']);
  expect(first.hasMore).toBe(true);
  const second = await list(request({ pageSize: 1, cursor: first.cursor }));
  expect(second.posts.map((p) => p.id)).toEqual(['iso-0501']);
  expect(second.hasMore).toBe(true);
  const third = await list(request({ pageSize: 1, cursor: second.cursor }));
  expect(third.posts.map((p) => p.id)).toEqual(['ts-0430']);
  expect(third.hasMore).toBe(false);
});

it('pages global ISO-string posts from the groupPosts fallback', async () => {
  const { list } = setup([], 'active', {
    globalRows: [
      row('c', { createdAt: '2024-05-03T00:00:00.000Z', status: 'active' }),
      row('b', { createdAt: '2024-05-02T00:00:00.000Z', status: 'active' }),
      row('a', { createdAt: '2024-05-01T00:00:00.000Z', status: 'active' }),
    ],
  });
  const first = await list(request({ pageSize: 1 }));
  expect(first.posts.map((p) => p.id)).toEqual(['c']);
  expect(first.hasMore).toBe(true);
  const second = await list(request({ pageSize: 1, cursor: first.cursor }));
  expect(second.posts.map((p) => p.id)).toEqual(['b']);
});

it('excludes every explicit hide signal, even on otherwise published posts', async () => {
  const hidden = [
    { published: false },
    ...['draft', 'unpublished', 'scheduled', 'pending', 'archived', 'cancelled', 'canceled', 'deleted'].map((status) => ({ status })),
    { deleted: true },
    { deletedAt: new Timestamp(1, 0) },
    { deletedAt: false },
    { deletedAt: 0 },
  ];
  const { list, writes } = setup(
    hidden.map((flags, i) =>
      row(String(i), {
        published: true,
        status: 'published',
        deleted: false,
        deletedAt: null,
        ...flags,
      }),
    ),
  );
  expect((await list(request())).posts).toEqual([]);
  expect(writes).not.toHaveBeenCalled();
});

it.each([null, 'left', 'removed', '', 'pending'])(
  'denies membership %s without reading posts',
  async (status) => {
    const { list, reads, writes } = setup([row('secret')], status);
    await expect(list(request())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(reads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  },
);

it('denies unauthenticated requests before reading posts', async () => {
  const { list, reads } = setup([row('secret')]);
  await expect(list({ data: { groupId: 'g1' } })).rejects.toMatchObject({
    code: 'unauthenticated',
  });
  expect(reads).not.toHaveBeenCalled();
});

it('fills pages through hidden batches and preserves timestamp ties across serializable cursors', async () => {
  const rows = Array.from({ length: 125 }, (_, i) =>
    row(String(200 - i).padStart(3, '0'), i % 31 === 0 ? {} : { status: 'draft' }),
  );
  const { list, reads, writes } = setup(rows);
  const first = await list(request({ pageSize: 2 }));
  expect(first.posts.map((p) => p.id)).toEqual(['200', '169']);
  expect(first.hasMore).toBe(true);
  expect(reads.mock.calls.length).toBeGreaterThan(1);
  // The cursor remains valid even if its document disappears between requests.
  const next = setup(rows.filter((r) => r.id !== '169'));
  const second = await next.list(
    request({ pageSize: 2, cursor: JSON.parse(JSON.stringify(first.cursor)) }),
  );
  expect(second.posts.map((p) => p.id)).toEqual(['138', '107']);
  expect(second.hasMore).toBe(true);
  const third = await list(request({ pageSize: 2, cursor: second.cursor }));
  expect(third.posts.map((p) => p.id)).toEqual(['076']);
  expect(third.hasMore).toBe(false);
  expect(writes).not.toHaveBeenCalled();
});

it.each([{ groupId: '../bad' }, { pageSize: 0 }, { pageSize: 1.5 }, { cursor: {} }])(
  'validates input %j',
  async (data) => {
    await expect(setup([]).list(request(data))).rejects.toMatchObject({ code: 'invalid-argument' });
  },
);

it('defaults to 20 and caps page sizes at 50', async () => {
  const { list } = setup(Array.from({ length: 60 }, (_, i) => row(String(i).padStart(3, '0'))));
  expect((await list(request())).posts).toHaveLength(20);
  expect((await list(request({ pageSize: 500 }))).posts).toHaveLength(50);
});

it('dispatches the hosted callable with verified authentication and HTTP denial codes', async () => {
  const { db } = setup([row('legacy')]);
  const verifyIdToken = vi.fn(async (token: string) => {
    if (token !== 'valid') throw new Error('invalid');
    return { uid: 'alice' };
  });
  const runtime = { db, verifyIdToken } as unknown as FnRuntime;
  async function call(token?: string, deps = runtime) {
    return dispatchFnRequest(
      'listGroupDiscussionPage',
      new Request('https://nuni.tw/api/fn/listGroupDiscussionPage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ data: { groupId: 'g1' } }),
      }),
      deps,
    );
  }
  expect((await call()).status).toBe(401);
  expect((await call('bad')).status).toBe(401);
  const allowed = await call('valid');
  expect(allowed.status).toBe(200);
  expect((await allowed.json()).result.posts[0].id).toBe('legacy');
  const denied = await call('valid', {
    ...runtime,
    db: setup([], 'removed').db as unknown as FnRuntime['db'],
  });
  expect(denied.status).toBe(403);
  expect(await denied.json()).not.toHaveProperty('result');
});

it.each([
  ...['disabled', 'suspended', 'deleted', 'inactive'].map((status) => ({ profile: { status } })),
  { profile: { accountDeletionInProgress: true } },
  ...[null, 'inactive', 'removed', 'pending', 'left', ''].map((schoolStatus) => ({ schoolStatus })),
  { group: null }, { group: {} },
])('denies unavailable accounts or revoked school membership despite active group membership: %j', async (options) => {
  const { list, reads, writes } = setup([row('secret')], 'active', options);
  await expect(list(request())).rejects.toMatchObject({ code: 'permission-denied' });
  expect(reads).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
});

it.each([null, {}, { schoolId: 'other', primarySchoolId: 'other' }])(
  'allows missing/legacy/transfer profiles with active membership in the group school: %j', async (profile) => {
    const { list, writes, membershipReads } = setup([row('legacy')], 'active', { profile });
    expect((await list(request())).posts.map((post) => post.id)).toEqual(['legacy']);
    expect(membershipReads.mock.calls.map(([path]) => path)).toEqual(['groups/g1/members/alice', 'schools/pu/members/alice']);
    expect(writes).not.toHaveBeenCalled();
  },
);

it.each([false, true])('reads global-only legacy posts when canonical fails=%s, sorts and paginates without writes', async (canonicalError) => {
  const globalRows = [
    row('old', { createdAt: new Timestamp(20, 1) }),
    row('tie-a'), row('tie-z'),
    row('new', { createdAt: new Timestamp(100, 124) }),
  ];
  const { list, writes, globalReads } = setup([], 'active', { globalRows, canonicalError });
  const first = await list(request({ pageSize: 2 }));
  expect(first.posts.map(p => p.id)).toEqual(['new', 'tie-z']);
  expect(first.hasMore).toBe(true);
  const next = setup([], 'active', { globalRows: globalRows.filter(r => r.id !== 'tie-z'), canonicalError });
  const second = await next.list(request({ pageSize: 2, cursor: JSON.parse(JSON.stringify(first.cursor)) }));
  expect(second.posts.map(p => p.id)).toEqual(['tie-a', 'old']);
  expect(second.hasMore).toBe(false);
  expect(globalReads).toHaveBeenCalledWith(500, 0);
  expect(writes).not.toHaveBeenCalled();
  expect(next.writes).not.toHaveBeenCalled();
});

it('applies every canonical visibility exclusion to global posts', async () => {
  const flags = [
    { published: false }, ...['draft', 'unpublished', 'scheduled', 'pending', 'archived', 'cancelled', 'canceled', 'deleted'].map(status => ({ status })),
    { deleted: true }, { deletedAt: new Timestamp(1, 0) }, { deletedAt: false }, { deletedAt: 0 },
  ];
  const { list, writes } = setup([], 'active', { globalRows: [row('legacy'), row('active', { status: 'active' }), row('published', { status: 'published' }), row('empty-status', { status: '' }),
    ...flags.map((data, i) => row(`hidden-${i}`, data))] });
  expect((await list(request())).posts.map(p => p.id)).toEqual(['published', 'legacy', 'empty-status', 'active']);
  expect(writes).not.toHaveBeenCalled();
});

it('never falls back for raw canonical rows, even hidden or past the cursor', async () => {
  const { list, globalReads } = setup([row('hidden', { status: 'draft' })], 'active', { globalRows: [row('global')] });
  expect((await list(request())).posts).toEqual([]);
  expect((await list(request({ cursor: { id: 'old', createdAt: { seconds: 1, nanoseconds: 0 } } }))).posts).toEqual([]);
  expect(globalReads).not.toHaveBeenCalled();
});

it('scans beyond 500 global rows before sorting and paginates visible legacy posts', async () => {
  const globalRows = Array.from({ length: 625 }, (_, i) => row(`post-${String(i).padStart(4, '0')}`, {
    status: 'active', createdAt: new Timestamp(i, 0),
  }));
  globalRows.push(...['draft', 'unpublished', 'deleted'].map((status, i) =>
    row(`hidden-${i}`, { status, createdAt: new Timestamp(1000 + i, 0) })));
  const { list, globalReads, writes } = setup([], 'active', { globalRows });
  const first = await list(request({ pageSize: 2 }));
  expect(first.posts.map(p => p.id)).toEqual(['post-0624', 'post-0623']);
  expect(first.hasMore).toBe(true);
  expect(globalReads.mock.calls).toEqual([[500, 0], [500, 500]]);
  const second = await list(request({ pageSize: 2, cursor: JSON.parse(JSON.stringify(first.cursor)) }));
  expect(second.posts.map(p => p.id)).toEqual(['post-0622', 'post-0621']);
  expect(second.hasMore).toBe(true);
  const last = await list(request({ cursor: { id: 'post-0002', createdAt: { seconds: 2, nanoseconds: 0 } } }));
  expect(last.posts.map(p => p.id)).toEqual(['post-0001', 'post-0000']);
  expect(last.hasMore).toBe(false);
  expect(writes).not.toHaveBeenCalled();
});

it('reads past 5,000 document IDs so the newest visible post is not dropped', async () => {
  const globalRows = Array.from({ length: 5001 }, (_, i) => row(`post-${String(i).padStart(4, '0')}`, {
    status: i < 4997 ? 'draft' : 'active', createdAt: new Timestamp(i, 0),
  }));
  const { list, globalReads, writes } = setup([], 'active', { globalRows });
  const first = await list(request({ pageSize: 2 }));
  expect(first.posts.map(p => p.id)).toEqual(['post-5000', 'post-4999']);
  expect(first.hasMore).toBe(true);
  expect(globalReads).toHaveBeenCalledTimes(11);
  const second = await list(request({ pageSize: 2, cursor: first.cursor }));
  expect(second.posts.map(p => p.id)).toEqual(['post-4998', 'post-4997']);
  expect(second.hasMore).toBe(false);
  expect(writes).not.toHaveBeenCalled();
});

it('pages a canonical collection whose newest post is beyond the first 5,000 document IDs', async () => {
  const rows = Array.from({ length: 5001 }, (_, i) => row(`post-${String(i).padStart(4, '0')}`, {
    status: 'active',
    createdAt: i === 5000
      ? Timestamp.fromDate(new Date('2026-11-19T00:00:00.000Z'))
      : '2024-05-01T00:00:00.000Z',
  }));
  const { list, writes } = setup(rows);
  const first = await list(request({ pageSize: 1 }));
  expect(first.posts.map(p => p.id)).toEqual(['post-5000']);
  expect(first.hasMore).toBe(true);
  const last = await list(request({
    pageSize: 1,
    cursor: { id: 'post-0000', createdAt: { seconds: Timestamp.fromDate(new Date('2024-05-01T00:00:00.000Z')).seconds, nanoseconds: 0 } },
  }));
  expect(last.posts.map(p => p.id)).toEqual([]);
  expect(last.hasMore).toBe(false);
  expect(writes).not.toHaveBeenCalled();
});

it('requires no groupId/createdAt composite index for global posts', () => {
  const config = JSON.parse(readFileSync(new URL('../../../../../backend/firestore/firestore.indexes.json', import.meta.url), 'utf8'));
  expect(config.indexes.some((index: { collectionGroup: string; fields: { fieldPath: string }[] }) =>
    index.collectionGroup === 'groupPosts' && ['groupId', 'createdAt'].every(field => index.fields.some(f => f.fieldPath === field))
  )).toBe(false);
});
