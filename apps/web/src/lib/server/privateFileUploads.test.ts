// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { parsePrivateFilePath } from '@campus/shared/src/privateFileAccess';
import { createMemoryGroupStore } from './memoryGroupStore';
import type { FileStorage } from './fileStorage';
import {
  createPrivateFileUploads,
  GLOBAL_FILE_QUOTA_BYTES,
  UPLOAD_RESERVED_BYTES,
  UPLOAD_URL_TTL_MS,
  uploadId,
  ORPHAN_GRACE_MS,
  CLEANUP_LEASE_MS,
} from './privateFileUploads';

function setup() {
  const store = createMemoryGroupStore();
  const storage = { remove: vi.fn(async () => {}) } as unknown as FileStorage;
  return {
    ...store,
    storage,
    uploads: createPrivateFileUploads(store.db as unknown as Firestore, storage),
  };
}
const scope = (id: number) => parsePrivateFilePath(`groups/course/posts/post/file${id}.pdf`)!;
vi.mock('server-only', () => ({}));
const now = 1000;

it('reserves the bucket ceiling regardless of category or reported size and enforces user quota', async () => {
  const { uploads, docs } = setup();
  for (let id = 0; id < 4; id++) await uploads.reserve(scope(id), 'alice', now);
  expect(docs.get('privateFileQuota/global')?.reservedBytes).toBe(4 * UPLOAD_RESERVED_BYTES);
  await expect(uploads.reserve(scope(4), 'alice', now)).rejects.toMatchObject({ statusCode: 429 });
  expect(docs.has(`privateFileUploads/${uploadId(scope(4).path)}`)).toBe(false);
});

it('rejects global quota overflow atomically', async () => {
  const { uploads, docs } = setup();
  docs.set('privateFileQuota/global', {
    reservedBytes: GLOBAL_FILE_QUOTA_BYTES,
    finalizedBytes: 0,
  });
  await expect(uploads.reserve(scope(0), 'alice', now)).rejects.toMatchObject({ statusCode: 507 });
  expect(docs.size).toBe(1);
});

it('converts reservation to actual bytes once and refuses reuse of a path', async () => {
  const { uploads, docs } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  expect(docs.get('privateFileQuota/global')).toEqual({ reservedBytes: 0, finalizedBytes: 8 });
  await expect(uploads.reserve(scope(0), 'alice', now)).rejects.toMatchObject({ statusCode: 409 });
  expect(await uploads.cleanup(now + UPLOAD_URL_TTL_MS)).toBe(0);
});

it('retains invalid upload reservations until token expiry and cleans once', async () => {
  const { uploads, docs, storage } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.invalidate(scope(0).path, 'alice');
  expect(await uploads.cleanup(now + 1)).toBe(0);
  await expect(uploads.finalize(scope(0).path, 'alice', 8, now + 1)).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(await uploads.cleanup(now + UPLOAD_URL_TTL_MS + CLEANUP_LEASE_MS)).toBe(1);
  expect(await uploads.cleanup(now + UPLOAD_URL_TTL_MS)).toBe(0);
  expect(storage.remove).toHaveBeenCalledTimes(1);
  expect(docs.get('privateFileQuota/global')).toEqual({ reservedBytes: 0, finalizedBytes: 0 });
  expect((await uploads.read(scope(0).path)).status).toBe('expired');
});

it('retries failed deletion without releasing quota or allowing finalize', async () => {
  const { uploads, storage, docs } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  vi.mocked(storage.remove).mockRejectedValueOnce(new Error('unavailable'));
  await expect(uploads.cleanup(now + UPLOAD_URL_TTL_MS)).rejects.toThrow('unavailable');
  expect(docs.get('privateFileQuota/global')?.reservedBytes).toBe(UPLOAD_RESERVED_BYTES);
  await expect(uploads.finalize(scope(0).path, 'alice', 8, now + 1)).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(await uploads.cleanup(now + UPLOAD_URL_TTL_MS + CLEANUP_LEASE_MS)).toBe(1);
});

it('does not create reservation when transaction commit fails', async () => {
  const { uploads, docs, failNextCommit } = setup();
  failNextCommit();
  await expect(uploads.reserve(scope(0), 'alice', now)).rejects.toThrow();
  expect(docs.size).toBe(0);
});


const day = 24 * 3600_000;
const cases = [
  ['schools/school/stories/story/image.jpg', 'campusStories/story', { expiresAt: 10 ** 12 }],
  ['groups/course/posts/post/file.pdf', 'groups/course/posts/post', { attachments: [] }],
  ['groups/course/assignments/work/submissions/alice/file.pdf', 'groups/course/assignments/work/submissions/alice', { attachments: [] }],
  ['assignments/work/submissions/alice/file.pdf', 'assignments/work/submissions/alice', { attachments: [] }],
  ['groups/course/cover.jpg', 'groups/course', { coverUrl: 'groups/course/cover.new.jpg' }],
] as const;

it.each(cases)('uses only recorded references for %s', async (path, reference) => {
  const { uploads, docs, storage } = setup();
  await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
  await uploads.finalize(path, 'alice', 8, now + 1);
  await uploads.claim(path, 'alice', now + 2, reference);
  const row = docs.get(`privateFileUploads/${uploadId(path)}`)!;
  expect(row.refs).toEqual([reference]);
  docs.set(reference, { attachments: [{ path }], expiresAt: now + 10 * day });
  expect(await uploads.cleanup(now + 2 * day)).toBe(0);
  docs.set(reference, { attachments: [] });
  expect(await uploads.cleanup(now + 2 * day + CLEANUP_LEASE_MS)).toBe(1);
  expect(storage.remove).toHaveBeenCalledWith(path);
  expect(await uploads.cleanup(now + 3 * day)).toBe(0);
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(0);
});

it('reclaims expired stories even when their document retains mediaUrl', async () => {
  const { uploads, docs } = setup();
  const path = cases[0][0];
  await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
  await uploads.finalize(path, 'alice', 8, now + 1);
  await uploads.claim(path, 'alice', now + 2);
  docs.set('campusStories/story', { mediaUrl: path, expiresAt: now + 2 * day });
  expect(await uploads.cleanup(now + 2 * day + ORPHAN_GRACE_MS)).toBe(0);
  expect(await uploads.cleanup(now + 2 * day + ORPHAN_GRACE_MS + CLEANUP_LEASE_MS)).toBe(1);
});

it('reclaims the last cover after failed publication without another claim', async () => {
  const { uploads, docs } = setup();
  const path = 'groups/course/cover.jpg';
  await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
  await uploads.finalize(path, 'alice', 8, now + 1);
  await uploads.claim(path, 'alice', now + 2);
  docs.set('groups/course', { coverUrl: 'old' });
  expect(await uploads.cleanup(now + ORPHAN_GRACE_MS + 2)).toBe(0);
  expect(await uploads.cleanup(now + ORPHAN_GRACE_MS + 2 + CLEANUP_LEASE_MS)).toBe(1);
});

it('cover claims read at most three documents regardless of history', async () => {
  const { uploads, docs, db } = setup();
  for (let i = 0; i < 1000; i++) docs.set(`privateFileUploads/history${i}`, { kind: 'group-cover', status: 'deleted' });
  for (const path of ['groups/course/cover.1.jpg', 'groups/course/cover.2.jpg']) {
    await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
    await uploads.finalize(path, 'alice', 8, now + 1);
  }
  const original = db.runTransaction.bind(db);
  let reads = 0;
  vi.spyOn(db, 'runTransaction').mockImplementation((callback) => original((tx) => callback({ ...tx,
    get: async (ref: Parameters<typeof tx.get>[0]) => { reads++; expect((ref as { filters?: unknown }).filters).toBeUndefined(); return tx.get(ref); },
  })));
  await uploads.claim('groups/course/cover.1.jpg', 'alice', now + 2);
  expect(reads).toBe(2);
  reads = 0;
  await uploads.claim('groups/course/cover.2.jpg', 'alice', now + 3);
  expect(reads).toBe(3);
  expect((await uploads.read('groups/course/cover.1.jpg')).status).toBe('released');
});

it('shares a 25 minute lease across independent workers', async () => {
  const { uploads, db, storage, docs } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  expect(await uploads.cleanup(now + 2 * day)).toBe(1);
  const other = createPrivateFileUploads(db as unknown as Firestore, storage);
  expect(await other.cleanup(now + 2 * day)).toBe(0);
  expect(docs.get('privateFileCleanup/day-1970-01-03')?.reads).toBe(400);
});

it('stops at the persistent daily budget and resumes on the next UTC day', async () => {
  const { uploads, docs, storage } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  docs.set('privateFileCleanup/day-1970-01-03', { reads: 4800 });
  expect(await uploads.cleanup(now + 2 * day)).toBe(0);
  expect(storage.remove).not.toHaveBeenCalled();
  expect(await uploads.cleanup(now + 3 * day)).toBe(1);
});

it('continues the document-name cursor past live references and wraps', async () => {
  const { uploads, docs } = setup();
  const paths = ['groups/course/posts/live/a.pdf', 'groups/course/posts/missing/b.pdf']
    .sort((a, b) => uploadId(a).localeCompare(uploadId(b)));
  for (const path of paths) {
    await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
    await uploads.finalize(path, 'alice', 8, now + 1);
    await uploads.claim(path, 'alice', now + 2);
  }
  docs.set(paths[0].slice(0, paths[0].lastIndexOf('/')), { attachments: [{ url: paths[0] }] });
  expect(await uploads.cleanup(now + 2 * day, 1)).toBe(0);
  expect(docs.get('privateFileCleanup/cursor')?.lastId).toBe(uploadId(paths[0]));
  expect(await uploads.cleanup(now + 2 * day + CLEANUP_LEASE_MS, 1)).toBe(1);
  expect(await uploads.cleanup(now + 2 * day + 2 * CLEANUP_LEASE_MS, 1)).toBe(0);
  expect(docs.get('privateFileCleanup/cursor')?.lastId).toBe(uploadId(paths[0]));
});

it('ignores unclaimed cross-document references without scanning the site', async () => {
  const { uploads, docs, db } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  for (let i = 0; i < 1000; i++) docs.set(`groups/elsewhere/posts/p${i}`, { attachments: [scope(0).path] });
  const scan = vi.spyOn(db, 'collectionGroup');
  expect(await uploads.cleanup(now + 2 * day)).toBe(1);
  expect(scan).not.toHaveBeenCalled();
});

it('retries failed storage removal and debits quota exactly once', async () => {
  const { uploads, storage, docs } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  vi.mocked(storage.remove).mockRejectedValueOnce(new Error('unavailable'));
  await expect(uploads.cleanup(now + 2 * day)).rejects.toThrow('unavailable');
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(8);
  expect(await uploads.cleanup(now + 2 * day + CLEANUP_LEASE_MS)).toBe(1);
  expect(await uploads.cleanup(now + 3 * day)).toBe(0);
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(0);
});

it('processes at most twenty candidates and resumes the remaining page', async () => {
  const { uploads, docs } = setup();
  for (let id = 0; id < 25; id++) {
    await uploads.reserve(scope(id), 'alice', now);
    await uploads.finalize(scope(id).path, 'alice', 8, now + 1);
  }
  expect(await uploads.cleanup(now + 2 * day, 100)).toBe(20);
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(40);
  expect(await uploads.cleanup(now + 2 * day + CLEANUP_LEASE_MS, 100)).toBe(5);
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(0);
});

it('does not delete when a recorded reference read fails', async () => {
  const { uploads, db, storage } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  const original = db.runTransaction.bind(db);
  vi.spyOn(db, 'runTransaction').mockImplementation((callback) => original((tx) => callback({ ...tx,
    get: async (reference: { path: string }) => {
      if (reference.path === 'groups/course/posts/post') throw new Error('unavailable');
      return tx.get(reference);
    },
  })));
  await expect(uploads.cleanup(now + 2 * day)).rejects.toThrow('unavailable');
  expect(storage.remove).not.toHaveBeenCalled();
});

it('reclaims a short-lived story two hours after expiry without waiting a day', async () => {
  const { uploads, docs } = setup();
  const path = cases[0][0];
  await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
  await uploads.finalize(path, 'alice', 8, now + 1);
  await uploads.claim(path, 'alice', now + 2);
  docs.set('campusStories/story', { mediaUrl: path, expiresAt: now + 1000 });
  expect(await uploads.cleanup(now + 1000 + ORPHAN_GRACE_MS + 1)).toBe(1);
});

it('fences settlement when another worker takes over the lease', async () => {
  const { uploads, docs, storage } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  vi.mocked(storage.remove).mockImplementationOnce(async () => {
    docs.get('privateFileCleanup/lease')!.owner = 'replacement';
  });
  expect(await uploads.cleanup(now + 2 * day)).toBe(0);
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(8);
  expect(docs.has('privateFileCleanup/cursor')).toBe(false);
  expect(await uploads.cleanup(now + 2 * day + CLEANUP_LEASE_MS)).toBe(1);
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(0);
});
