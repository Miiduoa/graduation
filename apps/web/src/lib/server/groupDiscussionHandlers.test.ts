// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { createGroupDiscussionHandlers } from './groupDiscussionHandlers';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';

type Row = { id: string; createdAt: Timestamp; [key: string]: unknown };
function setup(rows: Row[], status: string | null = 'active') {
  const writes = vi.fn(() => {
    throw new Error('Listing must not write');
  });
  const reads = vi.fn();
  const ordered = [...rows].sort(
    (a, b) => b.createdAt.toMillis() - a.createdAt.toMillis() || b.id.localeCompare(a.id),
  );
  function query(offset = 0, count = Infinity): any {
    return {
      orderBy: () => query(offset, count),
      startAt: (time: Timestamp) => {
        const next = ordered.findIndex((r) => r.createdAt.toMillis() <= time.toMillis());
        return query(next < 0 ? rows.length : next, count);
      },
      startAfter: (timeOrDoc: Timestamp | { id: string }, ref?: { id: string }) => {
        const id = ref?.id ?? (timeOrDoc as { id: string }).id;
        const time = ref ? (timeOrDoc as Timestamp) : rows.find((r) => r.id === id)!.createdAt;
        const next = ordered.findIndex(
          (r) =>
            r.createdAt.toMillis() < time.toMillis() ||
            (r.createdAt.isEqual(time) && r.id.localeCompare(id) < 0),
        );
        return query(next < 0 ? rows.length : next, count);
      },
      limit: (size: number) => query(offset, size),
      doc: (id: string) => ({ id }),
      get: async () => {
        reads();
        return {
          docs: ordered
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
    collection: () => ({
      doc: () => ({
        collection: (name: string) =>
          name === 'posts'
            ? query()
            : {
                doc: () => ({
                  get: async () => ({ exists: status !== null, data: () => ({ status }) }),
                  set: writes,
                  update: writes,
                }),
              },
      }),
    }),
    runTransaction: writes,
    batch: writes,
  } as unknown as Firestore;
  return { db, writes, reads, list: createGroupDiscussionHandlers({ db }).listGroupDiscussionPage };
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
    row('partial', { published: true }),
    row('published', { published: true, status: 'published', deleted: false, deletedAt: null }),
  ]);
  const page = await list(request());
  expect(page.posts.map((p) => p.id).sort()).toEqual(['legacy', 'partial', 'published']);
  expect(page.hasMore).toBe(false);
  expect(writes).not.toHaveBeenCalled();
});

it('excludes every explicit hide signal, even on otherwise published posts', async () => {
  const hidden = [
    { published: false },
    ...['draft', 'unpublished', 'scheduled', 'pending', ''].map((status) => ({ status })),
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
