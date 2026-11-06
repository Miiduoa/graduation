import { beforeEach, expect, it, vi } from 'vitest';
import { createStoryId, publishStory } from './firestore';
import { uploadStoryMedia } from './media';

const mock = vi.hoisted(() => ({
  ref: vi.fn((_storage, path: string) => path),
  upload: vi.fn(),
  url: vi.fn(),
  cancel: vi.fn(),
  unsubscribe: vi.fn(),
  progress: (progress: { bytesTransferred: number; totalBytes: number }) => { void progress; },
  write: vi.fn(),
  readServer: vi.fn(),
  doc: vi.fn((collection: string, id = 'reserved') => ({ path: collection + '/' + id, id })),
}));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  doc: mock.doc,
  serverTimestamp: () => 'server-time',
  setDoc: mock.write,
  getDocFromServer: mock.readServer,
}));
vi.mock('firebase/app', () => ({ getApps: () => [{}] }));
vi.mock('firebase/storage', () => ({
  getStorage: () => ({}),
  ref: mock.ref,
  uploadBytes: vi.fn(),
  uploadBytesResumable: mock.upload,
  getDownloadURL: mock.url,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.upload.mockReset().mockImplementation(() => task(Promise.resolve()));
  mock.url.mockReset().mockResolvedValue('https://example.test/photo');
  mock.write.mockReset().mockResolvedValue(undefined);
  mock.readServer.mockReset().mockRejectedValue({ code: 'permission-denied' });
  mock.cancel.mockReset();
});

function task(completion: Promise<void>) {
  return Object.assign(completion, {
    cancel: mock.cancel,
    on: (_event: string, receive: typeof mock.progress) => {
      mock.progress = receive;
      return mock.unsubscribe;
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('writes the image at the school story Storage path and publishes the matching document ID', async () => {
  const storyId = createStoryId();
  const file = new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' });
  const { url } = await uploadStoryMedia({ schoolId: 'ncku', uid: 'student', storyId, file });
  expect(mock.upload).toHaveBeenCalledExactlyOnceWith('schools/ncku/stories/reserved/image', file, {
    contentType: 'image/jpeg',
    customMetadata: { ownerUid: 'student' },
  });
  await publishStory({
    storyId,
    schoolId: 'ncku',
    authorUid: 'student',
    kind: 'image',
    allowReplies: false,
    mediaUrl: url,
    expiresAtMs: 123,
  });
  expect(mock.write).toHaveBeenCalledExactlyOnceWith(
    { path: 'campusStories/reserved', id: 'reserved' },
    expect.objectContaining({
      schoolId: 'ncku',
      authorUid: 'student',
      kind: 'image',
      allowReplies: false,
      mediaUrl: url,
      createdAt: 'server-time',
      expiresAt: 123,
    }),
  );
});

it.each([
  new File(['clip'], 'clip.mov', { type: 'video/quicktime' }),
  new File([], 'empty.mp4', { type: 'video/mp4' }),
  new File([], 'empty.png', { type: 'image/png' }),
  new File([new ArrayBuffer(10 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' }),
])('rejects unsupported or empty media before Storage receives it', async (file) => {
  await expect(
    uploadStoryMedia({ schoolId: 'ncku', uid: 'student', storyId: 'reserved', file }),
  ).rejects.toThrow();
  expect(mock.upload).not.toHaveBeenCalled();
});

const content = {
  authorUid: 'student',
  schoolId: 'ncku',
  kind: 'image' as const,
  allowReplies: true,
  text: '球場集合',
  mediaUrl: 'https://example.test/photo',
  bgColor: '#243b35',
  poiId: 'court',
  poiName: '運動場',
};
const retry = { ...content, storyId: 'reserved', expiresAtMs: 200 };
const denied = { code: 'permission-denied' };

it('confirms an earlier immutable write at the reserved ID after a lost acknowledgement', async () => {
  mock.write.mockRejectedValueOnce(denied);
  mock.readServer.mockResolvedValueOnce({
    data: () => ({ ...content, createdAt: 'original server time', expiresAt: 100, viewCount: 2 }),
    metadata: { hasPendingWrites: false },
  });
  await expect(publishStory(retry)).resolves.toBe(retry.storyId);
  expect(mock.readServer).toHaveBeenCalledExactlyOnceWith(mock.write.mock.calls[0]![0]);
});

it.each(Object.keys(content))('rejects a reserved document with a different %s', async (field) => {
  mock.write.mockRejectedValueOnce(denied);
  mock.readServer.mockResolvedValueOnce({
    data: () => ({ ...content, [field]: 'other' }),
    metadata: { hasPendingWrites: false },
  });
  await expect(publishStory(retry)).rejects.toBe(denied);
});

it('does not confirm an uncommitted local overlay or an inaccessible story', async () => {
  mock.write.mockRejectedValueOnce(denied).mockRejectedValueOnce(denied);
  mock.readServer
    .mockResolvedValueOnce({ data: () => content, metadata: { hasPendingWrites: true } })
    .mockRejectedValueOnce(denied);
  await expect(publishStory(retry)).rejects.toBe(denied);
  await expect(publishStory(retry)).rejects.toBe(denied);
});

it('preserves an unavailable write error when the server cannot confirm its result', async () => {
  const offline = { code: 'unavailable' };
  mock.write.mockRejectedValueOnce(offline);
  await expect(publishStory(retry)).rejects.toBe(offline);
  expect(mock.readServer).toHaveBeenCalledExactlyOnceWith(mock.write.mock.calls[0]![0]);
});

it('uploads an MP4 at the reserved video path with uploader ownership', async () => {
  const file = new File(['clip'], 'clip.mp4', { type: 'video/mp4' });
  await uploadStoryMedia({ schoolId: 'ncku', uid: 'student', storyId: 'reserved', file });
  expect(mock.upload).toHaveBeenCalledExactlyOnceWith('schools/ncku/stories/reserved/video', file, {
    contentType: 'video/mp4',
    customMetadata: { ownerUid: 'student' },
  });
  Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 });
  await expect(
    uploadStoryMedia({ schoolId: 'ncku', uid: 'student', storyId: 'reserved', file }),
  ).rejects.toThrow('小於 100 MB');
  expect(mock.upload).toHaveBeenCalledTimes(1);
});

it('reports the SDK byte counts and stops observing completed uploads', async () => {
  const completion = deferred<void>();
  mock.upload.mockReturnValueOnce(task(completion.promise));
  const onProgress = vi.fn();
  const onUploaded = vi.fn();
  const file = new File(['0123456789'], 'photo.jpg', { type: 'image/jpeg' });
  const uploading = uploadStoryMedia({ schoolId: 'ncku', uid: 'student', storyId: 'reserved', file, onProgress, onUploaded });
  const observe = mock.progress;
  observe({ bytesTransferred: 4, totalBytes: 10 });
  expect(onProgress).toHaveBeenCalledExactlyOnceWith({ bytesTransferred: 4, totalBytes: 10 });
  completion.resolve();
  await expect(uploading).resolves.toMatchObject({ path: 'schools/ncku/stories/reserved/image' });
  expect(onUploaded).toHaveBeenCalledExactlyOnceWith('schools/ncku/stories/reserved/image');
  expect(mock.unsubscribe).toHaveBeenCalledTimes(1);
  observe({ bytesTransferred: 10, totalBytes: 10 });
  expect(onProgress).toHaveBeenCalledTimes(1);
});

it('rejects a pre-cancelled upload before creating a Storage task', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(uploadStoryMedia({
    schoolId: 'ncku', uid: 'student', storyId: 'reserved',
    file: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }), signal: controller.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(mock.upload).not.toHaveBeenCalled();
  expect(mock.url).not.toHaveBeenCalled();
});

it('cancels the resumable task and ignores progress delivered after cancellation', async () => {
  const completion = deferred<void>();
  mock.upload.mockReturnValueOnce(task(completion.promise));
  mock.cancel.mockImplementationOnce(() => completion.reject({ code: 'storage/canceled' }));
  const controller = new AbortController();
  const onProgress = vi.fn();
  const onUploaded = vi.fn();
  const uploading = uploadStoryMedia({
    schoolId: 'ncku', uid: 'student', storyId: 'reserved',
    file: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }), signal: controller.signal, onProgress, onUploaded,
  });
  const rejected = expect(uploading).rejects.toMatchObject({ code: 'storage/canceled' });
  controller.abort();
  mock.progress({ bytesTransferred: 5, totalBytes: 5 });
  await rejected;
  expect(mock.cancel).toHaveBeenCalledTimes(1);
  expect(mock.unsubscribe).toHaveBeenCalledTimes(1);
  expect(onProgress).not.toHaveBeenCalled();
  expect(onUploaded).not.toHaveBeenCalled();
  expect(mock.url).not.toHaveBeenCalled();
});

it('retains a completed upload when cancelled during URL retrieval and reuses its path on retry', async () => {
  const download = deferred<string>();
  mock.url.mockReturnValueOnce(download.promise);
  const controller = new AbortController();
  const onUploaded = vi.fn();
  const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
  const input = { schoolId: 'ncku', uid: 'student', storyId: 'reserved', file };
  const uploading = uploadStoryMedia({ ...input, signal: controller.signal, onUploaded });
  await vi.waitFor(() => expect(mock.url).toHaveBeenCalledTimes(1));
  expect(onUploaded).toHaveBeenCalledExactlyOnceWith('schools/ncku/stories/reserved/image');
  controller.abort();
  download.resolve('https://example.test/late-url');
  await expect(uploading).rejects.toMatchObject({ name: 'AbortError' });
  const retried = await uploadStoryMedia({ ...input, uploadedPath: onUploaded.mock.calls[0][0] });
  expect(retried.url).toBe('https://example.test/photo');
  expect(mock.upload).toHaveBeenCalledTimes(1);
  expect(mock.url).toHaveBeenCalledTimes(2);
});

it('keeps a completed path available after URL retrieval fails without uploading the file twice', async () => {
  mock.url.mockRejectedValueOnce(new Error('offline'));
  const onUploaded = vi.fn();
  const input = {
    schoolId: 'ncku', uid: 'student', storyId: 'reserved',
    file: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
  };
  await expect(uploadStoryMedia({ ...input, onUploaded })).rejects.toThrow('offline');
  await uploadStoryMedia({ ...input, uploadedPath: onUploaded.mock.calls[0][0] });
  expect(mock.upload).toHaveBeenCalledTimes(1);
});

it('does not reuse an uploaded path belonging to another school or story', async () => {
  await uploadStoryMedia({
    schoolId: 'ncku', uid: 'student', storyId: 'reserved', uploadedPath: 'schools/pu/stories/other/image',
    file: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
  });
  expect(mock.upload.mock.calls[0][0]).toBe('schools/ncku/stories/reserved/image');
});

it('confirms an actually committed publication after an unavailable acknowledgment without another write', async () => {
  let saved: Record<string, unknown> | undefined;
  mock.write.mockImplementationOnce(async (_reference, row) => {
    saved = row;
    throw { code: 'unavailable' };
  });
  mock.readServer.mockImplementation(async () => ({
    data: () => saved, metadata: { fromCache: false, hasPendingWrites: false },
  }));
  await expect(publishStory(retry)).resolves.toBe(retry.storyId);
  await expect(publishStory(retry, { confirmFirst: true })).resolves.toBe(retry.storyId);
  expect(mock.write).toHaveBeenCalledTimes(1);
  expect(saved).toMatchObject(content);
});

it('checks the original ID before retrying its fixed payload when confirmation is inaccessible', async () => {
  await publishStory(retry, { confirmFirst: true });
  expect(mock.readServer.mock.invocationCallOrder[0]).toBeLessThan(mock.write.mock.invocationCallOrder[0]);
  expect(mock.write.mock.calls[0][1]).toMatchObject({ ...content, expiresAt: retry.expiresAtMs });
});

it('rejects a cached confirmation even when its content matches the publication', async () => {
  mock.write.mockRejectedValueOnce(denied);
  mock.readServer.mockResolvedValueOnce({
    data: () => content, metadata: { fromCache: true, hasPendingWrites: false },
  });
  await expect(publishStory(retry)).rejects.toBe(denied);
});

it('aborts between the confirmation read and any retry write', async () => {
  const read = deferred<unknown>();
  mock.readServer.mockReturnValueOnce(read.promise);
  const controller = new AbortController();
  const confirming = publishStory(retry, { signal: controller.signal, confirmFirst: true });
  controller.abort();
  read.resolve({ data: () => content, metadata: { fromCache: false, hasPendingWrites: false } });
  await expect(confirming).rejects.toMatchObject({ name: 'AbortError' });
  expect(mock.write).not.toHaveBeenCalled();
});

it('ignores a late successful write after its publication scope is cancelled', async () => {
  const write = deferred<void>();
  mock.write.mockReturnValueOnce(write.promise);
  const controller = new AbortController();
  const publishing = publishStory(retry, { signal: controller.signal });
  controller.abort();
  write.resolve();
  await expect(publishing).rejects.toMatchObject({ name: 'AbortError' });
  expect(mock.readServer).not.toHaveBeenCalled();
});
