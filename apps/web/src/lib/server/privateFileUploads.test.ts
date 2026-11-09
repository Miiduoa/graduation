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

const cases = [
  ['schools/school/stories/story/image.jpg', 'campusStories/story', { expiresAt: 10 ** 12 }, { expiresAt: 0 }, 2 * 3600_000],
  ['groups/course/posts/post/file.pdf', 'groups/course/posts/post', { attachments: [{ url: 'groups/course/posts/post/file.pdf' }] }, { attachments: [] }, 2 * 3600_000],
  ['groups/course/assignments/work/submissions/alice/file.pdf', 'groups/course/assignments/work/submissions/alice', { attachments: [{ url: 'groups/course/assignments/work/submissions/alice/file.pdf' }] }, { attachments: [] }, 24 * 3600_000],
  ['assignments/work/submissions/alice/file.pdf', 'assignments/work/submissions/alice', { attachments: ['assignments/work/submissions/alice/file.pdf'] }, { attachments: [] }, 24 * 3600_000],
  ['groups/course/cover.jpg', 'groups/course', { coverUrl: 'groups/course/cover.jpg' }, { coverUrl: 'groups/course/new.jpg' }, 2 * 3600_000],
] as const;

it.each(cases)('keeps references and grace, then deletes orphan %s', async (path, ref, live, orphan, grace) => {
  const { uploads, docs, storage } = setup();
  await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
  await uploads.finalize(path, 'alice', 123, now + 1);
  expect(await uploads.cleanup(now + grace)).toBe(0);
  docs.set(ref, live);
  expect(await uploads.cleanup(now + grace + 2)).toBe(0);
  // A scan wraps at the end; the next pass revisits the reference.
  await uploads.cleanup(now + grace + 2);
  docs.set(ref, orphan);
  expect(await uploads.cleanup(now + grace + 2)).toBe(1);
  expect(storage.remove).toHaveBeenCalledWith(path);
  expect((await uploads.read(path)).status).toBe('deleted');
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(0);
  const personal = [...docs.entries()].find(([key]) => key.startsWith('privateFileQuota/user-'))![1];
  expect(personal).toMatchObject({ finalizedBytes: 0, reservedBytes: 0, pendingCount: 0 });
});

it.each(cases)('deletes missing reference %s only after grace', async (path, _ref, _live, _orphan, grace) => {
  const { uploads } = setup();
  await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
  await uploads.finalize(path, 'alice', 3, now + 1);
  expect(await uploads.cleanup(now + grace + 2)).toBe(1);
});

it.each([{ deleted: true }, { isDeleted: true }, { deletedAt: now }, { status: 'deleted' }])('cleans a deleted post even when its old attachments remain (%j)', async (tombstone) => {
  const { uploads, docs } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  docs.set('groups/course/posts/post', { ...tombstone, attachments: [{ url: scope(0).path }] });
  expect(await uploads.cleanup(now + 3 * 3600_000)).toBe(1);
});

it('retries finalized deletion and accounting commits without double debit', async () => {
  const { uploads, storage, docs, failNextCommit } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  const later = now + 3 * 3600_000;
  vi.mocked(storage.remove).mockRejectedValueOnce(new Error('unavailable'));
  await expect(uploads.cleanup(later)).rejects.toThrow();
  expect((await uploads.read(scope(0).path)).status).toBe('deleting');
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(8);
  vi.mocked(storage.remove).mockImplementationOnce(async () => { failNextCommit(); });
  await expect(uploads.cleanup(later)).rejects.toThrow();
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(8);
  expect(await uploads.cleanup(later)).toBe(1);
  expect(await uploads.cleanup(later)).toBe(0);
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(0);
});

it('bounds batches and scans past retained references without starvation', async () => {
  const { uploads, docs } = setup();
  const paths = [scope(0).path, scope(1).path].sort((a, b) => uploadId(a).localeCompare(uploadId(b)));
  for (const path of paths) {
    await uploads.reserve(parsePrivateFilePath(path)!, 'alice', now);
    await uploads.finalize(path, 'alice', 8, now + 1);
  }
  docs.set('groups/course/posts/post', { attachments: [paths[0]] });
  expect(await uploads.cleanup(now + 3 * 3600_000, 1)).toBe(0);
  expect(await uploads.cleanup(now + 3 * 3600_000, 1)).toBe(1);
  expect(docs.get('privateFileQuota/global')?.finalizedBytes).toBe(8);
});

it('gives older finalized records a fresh grace period without a migration', async () => {
  const { uploads, docs } = setup();
  await uploads.reserve(scope(0), 'alice', now);
  await uploads.finalize(scope(0).path, 'alice', 8, now + 1);
  delete docs.get(`privateFileUploads/${uploadId(scope(0).path)}`)!.finalizedAt;
  const later = now + 3 * 3600_000;
  expect(await uploads.cleanup(later)).toBe(0);
  expect(await uploads.cleanup(later + 2 * 3600_000)).toBe(1);
});
