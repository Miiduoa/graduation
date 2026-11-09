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
