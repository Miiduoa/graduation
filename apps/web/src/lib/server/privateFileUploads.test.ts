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
  expect(await uploads.cleanup(now + UPLOAD_URL_TTL_MS)).toBe(1);
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
  expect(await uploads.cleanup(now + UPLOAD_URL_TTL_MS)).toBe(1);
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

it.each(cases)('retains claimed files while container exists regardless of references: %s', async (path, ref, live) => {
  const { uploads, docs, storage } = setup();
  await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
  await uploads.finalize(path, 'alice', 123, now + 1);
  await uploads.claim(path, 'alice', now + 2);
  docs.set(ref, live);
  docs.set('groups/course/posts/other', { attachments: [path] });
  expect(await uploads.cleanup(now + 2 * day)).toBe(0);
  expect(storage.remove).not.toHaveBeenCalled();
  docs.delete(ref);
  expect(await uploads.cleanup(now + 2 * day)).toBe(1);
  expect((await uploads.read(path)).status).toBe('deleted');
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(0);
});

it.each(cases)('keeps missing claimed containers for a full day: %s', async (path) => {
  const { uploads } = setup();
  await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
  await uploads.finalize(path, 'alice', 3, now + 1);
  await uploads.claim(path, 'alice', now + 2);
  expect(await uploads.cleanup(now + day + 2)).toBe(0);
  expect(await uploads.cleanup(now + day + 3)).toBe(1);
});

it('reclaims unclaimed finalized drafts only after 24 hours', async () => {
  const { uploads } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  expect(await uploads.cleanup(now + day + 1)).toBe(0);
  expect(await uploads.cleanup(now + day + 2)).toBe(1);
  await expect(uploads.claim(scope(0).path, 'alice', now + day + 3)).rejects.toMatchObject({ statusCode: 410 });
});

it('refreshes claim to protect a publication retry', async () => {
  const { uploads } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  await uploads.claim(scope(0).path, 'alice', now + 2);
  await uploads.claim(scope(0).path, 'alice', now + day);
  expect(await uploads.cleanup(now + day + 3)).toBe(0);
});

it.each(['pending', 'deleting', 'deleted', 'missing'])('claim rejects unavailable %s records with 410', async (status) => {
  const { uploads, docs } = setup();
  if (status !== 'missing') {
    await uploads.reserve(scope(0), 'alice', now);
    docs.get(`privateFileUploads/${uploadId(scope(0).path)}`)!.status = status;
  }
  await expect(uploads.claim(scope(0).path, 'alice', now)).rejects.toMatchObject({ statusCode: 410 });
});

it('abandons deletion when claimedAt changes between scan and transaction', async () => {
  const { uploads, docs, db, storage } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  await uploads.claim(scope(0).path, 'alice', now + 2);
  const original = db.runTransaction.bind(db);
  vi.spyOn(db, 'runTransaction').mockImplementationOnce((...args) => {
    docs.get(`privateFileUploads/${uploadId(scope(0).path)}`)!.claimedAt = now + 3;
    return original(...args);
  });
  expect(await uploads.cleanup(now + 2 * day)).toBe(0);
  expect(storage.remove).not.toHaveBeenCalled();
});

it('honors the two hour story expiry grace', async () => {
  const { uploads, docs } = setup();
  const path = cases[0][0];
  await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
  await uploads.finalize(path, 'alice', 8, now + 1);
  await uploads.claim(path, 'alice', now + 2);
  docs.set(cases[0][1], { expiresAt: now + 2 * day });
  expect(await uploads.cleanup(now + 2 * day + 2 * 3600_000)).toBe(0);
  expect(await uploads.cleanup(now + 2 * day + 2 * 3600_000 + 1)).toBe(1);
});

it.each([{ deleted: true }, { isDeleted: true }, { deletedAt: now }, { status: 'deleted' }])('cleans tombstoned posts after claim grace (%j)', async (tombstone) => {
  const { uploads, docs } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  await uploads.claim(scope(0).path, 'alice', now + 2);
  docs.set('groups/course/posts/post', tombstone);
  expect(await uploads.cleanup(now + day + 3)).toBe(1);
});

it('retries deletion and quota settlement without double debit', async () => {
  const { uploads, storage, docs, failNextCommit } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  const later = now + 2 * day;
  vi.mocked(storage.remove).mockRejectedValueOnce(new Error('unavailable'));
  await expect(uploads.cleanup(later)).rejects.toThrow();
  await expect(uploads.claim(scope(0).path, 'alice', later)).rejects.toMatchObject({ statusCode: 410 });
  vi.mocked(storage.remove).mockImplementationOnce(async () => { failNextCommit(); });
  await expect(uploads.cleanup(later)).rejects.toThrow();
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(8);
  expect(await uploads.cleanup(later)).toBe(1);
  expect(await uploads.cleanup(later)).toBe(0);
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(0);
});

it('gives older records a fresh day without a migration', async () => {
  const { uploads, docs } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  delete docs.get(`privateFileUploads/${uploadId(scope(0).path)}`)!.finalizedAt;
  expect(await uploads.cleanup(now + day)).toBe(0);
  expect(await uploads.cleanup(now + 2 * day + 1)).toBe(1);
});

it('advances the bounded scan past retained claimed containers', async () => {
  const { uploads, docs } = setup();
  const paths = ['groups/course/posts/live/a.pdf', 'groups/course/posts/missing/b.pdf']
    .sort((a, b) => uploadId(a).localeCompare(uploadId(b)));
  for (const path of paths) {
    await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
    await uploads.finalize(path, 'alice', 8, now + 1);
    await uploads.claim(path, 'alice', now + 2);
  }
  docs.set(paths[0].slice(0, paths[0].lastIndexOf('/')), { attachments: [] });
  expect(await uploads.cleanup(now + 2 * day, 1)).toBe(0);
  expect(await uploads.cleanup(now + 2 * day, 1)).toBe(1);
});

it('releases 31 replaced covers, respects publication grace and current cover, and settles both quotas once', async () => {
  const { uploads, docs, storage } = setup();
  const bytes = 5 * 1024 * 1024 - 1;
  const paths = Array.from({ length: 32 }, (_, i) => `groups/course/cover.${i}.jpg`);
  for (const path of paths) {
    await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
    await uploads.finalize(path, 'alice', bytes, now + 1);
    await uploads.claim(path, 'alice', now + 2);
  }
  await expect(uploads.reserve(scope(98), 'alice', now)).rejects.toMatchObject({ statusCode: 429 });
  docs.set('groups/course', { coverUrl: paths[0] });
  await uploads.claim(paths[31], 'alice', now + 3);
  expect((await uploads.read(paths[0])).releasedAt).toBe(now + 2);
  expect(await uploads.cleanup(now + 2 * 3600_000, 50)).toBe(0);
  expect(storage.remove).not.toHaveBeenCalled();
  expect(await uploads.cleanup(now + 2 * 3600_000 + 2, 50)).toBe(30);
  expect(storage.remove).not.toHaveBeenCalledWith(paths[0]);
  docs.set('groups/course', { coverUrl: paths[31] });
  expect(await uploads.cleanup(now + 2 * 3600_000 + 3, 50)).toBe(1);
  expect(await uploads.cleanup(now + 2 * 3600_000 + 4, 50)).toBe(0);
  for (const [key, value] of docs) {
    if (key.startsWith('privateFileQuota/')) expect(value.finalizedBytes).toBe(bytes);
  }
  await expect(uploads.reserve(scope(99), 'alice', now + day)).resolves.toBeUndefined();
});
