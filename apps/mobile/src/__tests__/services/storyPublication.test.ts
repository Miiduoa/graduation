import { collection, doc, getDoc, getDocFromServer, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes, uploadBytesResumable } from 'firebase/storage';
import { uploadRawToPath, uploadStoryImage, uploadStoryVideo } from '../../services/mediaUpload';
import { markStoryViewed, publishStory, reserveStoryId } from '../../services/stories';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocFromServer: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  serverTimestamp: jest.fn(),
}));
jest.mock('../../firebase', () => ({ getDb: () => ({}), getStorageInstance: () => ({}) }));
jest.mock('firebase/storage', () => ({
  ref: jest.fn(() => 'storage-ref'),
  uploadBytes: jest.fn(),
  uploadBytesResumable: jest.fn(),
  getDownloadURL: jest.fn(() => 'https://example.com/photo'),
}));

const originalFetch = global.fetch;
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(ref).mockReturnValue('storage-ref' as never);
  jest.mocked(doc).mockReturnValue({ id: 'reserved' } as never);
  jest.mocked(collection).mockReturnValue({} as never);
  jest.mocked(getDownloadURL).mockResolvedValue('https://example.com/photo');
  jest.mocked(setDoc).mockResolvedValue(undefined);
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});
function localPhoto(type: string, size: number) {
  global.fetch = jest.fn(async () => ({ blob: async () => ({ type, size }) })) as jest.Mock;
}

test('uploads to the matching school and reserved document, keeping the image type', async () => {
  localPhoto('image/png', 123);
  jest.mocked(doc).mockReturnValue({ id: 'story-one' } as never);
  jest.mocked(collection).mockReturnValue({} as never);
  const id = reserveStoryId();
  const mediaUrl = await uploadStoryImage('pu', id, 'alice', 'file:///local.png', 'image/png');
  await publishStory(id, {
    allowReplies: true,
    schoolId: 'pu',
    authorUid: 'alice',
    kind: 'image',
    mediaUrl,
    expiresAtMs: 42,
  });
  expect(ref).toHaveBeenCalledWith({}, 'schools/pu/stories/story-one/image');
  expect(uploadBytes).toHaveBeenCalledWith('storage-ref', expect.anything(), {
    contentType: 'image/png',
    customMetadata: { ownerUid: 'alice' },
  });
  expect(doc).toHaveBeenLastCalledWith(expect.anything(), id);
  expect(setDoc).toHaveBeenCalledWith(
    { id },
    expect.objectContaining({ schoolId: 'pu', mediaUrl, expiresAt: 42 }),
  );
});

test.each([
  ['video/mp4', 42],
  ['image/png', 0],
  ['image/jpeg', 10 * 1024 * 1024],
] as const)('rejects an invalid photo (%s, %i bytes) before uploading', async (type, size) => {
  localPhoto(type, size);
  await expect(
    uploadStoryImage('pu', 'reserved', 'alice', 'file:///local', 'image/jpeg'),
  ).rejects.toThrow();
  expect(uploadBytes).not.toHaveBeenCalled();
});

test('opening your own story does not access viewer receipts', async () => {
  await markStoryViewed({ id: 'story', schoolId: 'pu', authorUid: 'alice' }, 'alice');
  expect(doc).not.toHaveBeenCalled();
  expect(getDoc).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
});

test('records a view without trying to modify the read-only story document', async () => {
  jest.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
  await markStoryViewed({ id: 'story', schoolId: 'pu', authorUid: 'bob' }, 'alice');
  expect(doc).toHaveBeenCalledWith({}, 'campusStories', 'story', 'schools', 'pu', 'authors', 'bob', 'views', 'alice');
  expect(setDoc).toHaveBeenCalledTimes(1);
  expect(updateDoc).not.toHaveBeenCalled();
});

test('recovers a committed create after a lost response only for the same story content', async () => {
  const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
  const content = {
    allowReplies: true,
    schoolId: 'pu',
    authorUid: 'alice',
    kind: 'image' as const,
    text: '社團招新',
    mediaUrl: 'https://example.com/photo',
    bgColor: '#000000',
    poiId: null,
    poiName: null,
  };
  const persisted = { ...content, expiresAt: Date.now() + 60_000 };
  const draft = { ...content, expiresAtMs: Date.now() + 86_400_000 };
  jest.mocked(doc).mockReturnValue({ id: 'reserved' } as never);
  jest.mocked(setDoc).mockRejectedValue(denied);
  jest.mocked(getDocFromServer).mockResolvedValue({ data: () => persisted } as never);
  await expect(publishStory('reserved', draft)).resolves.toBe('reserved');
  for (const changed of [
    { text: '不同的貼文' },
    { allowReplies: false },
    { authorUid: 'other' },
    { schoolId: 'other' },
    { mediaUrl: 'wrong' },
    { bgColor: '#fff' },
    { poiId: 'different' },
    { kind: 'text' },
    { expiresAt: 0 },
    { expiresAt: NaN },
    { expiresAt: Infinity },
  ]) {
    jest
      .mocked(getDocFromServer)
      .mockResolvedValue({ data: () => ({ ...persisted, ...changed }) } as never);
    await expect(publishStory('reserved', draft)).rejects.toBe(denied);
  }
});

test('publishes a checked MP4 at the reserved video object with the signed-in owner', async () => {
  localPhoto('video/mp4', 9500);
  await uploadStoryVideo('tw-pu', 'reserved', 'alice', 'file:///clip.mp4', 30_000);
  expect(ref).toHaveBeenCalledWith({}, 'schools/tw-pu/stories/reserved/video');
  expect(uploadBytes).toHaveBeenCalledWith('storage-ref', expect.anything(), {
    contentType: 'video/mp4',
    customMetadata: { ownerUid: 'alice' },
  });
});

test.each([
  ['video/mp4', 42, 30_001],
  ['video/mp4', 42, NaN],
  ['video/mp4', 100 * 1024 * 1024, 30_000],
  ['video/quicktime', 900, 7000],
  ['video/mp4', 0, 7000],
] as const)('rejects invalid clip %s/%i/%i before upload', async (mime, bytes, duration) => {
  localPhoto(mime, bytes);
  await expect(
    uploadStoryVideo('pu', 'reserved', 'alice', 'file:///clip', duration),
  ).rejects.toThrow();
  expect(uploadBytes).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function uploadTask() {
  let progress!: (snapshot: { bytesTransferred: number; totalBytes: number }) => void;
  let fail!: (error: Error) => void;
  let complete!: () => void;
  const unsubscribe = jest.fn();
  const cancel = jest.fn(() => true);
  jest.mocked(uploadBytesResumable).mockReturnValue({
    cancel,
    on: jest.fn((_event, onProgress, onError, onComplete) => {
      progress = onProgress;
      fail = onError;
      complete = onComplete;
      return unsubscribe;
    }),
  } as never);
  return {
    cancel,
    unsubscribe,
    progress: (loaded: number, total: number) => progress({ bytesTransferred: loaded, totalBytes: total }),
    fail: (error: Error) => fail(error),
    complete: () => complete(),
  };
}

test('reports actual transferred bytes, completes once, and preserves owner metadata', async () => {
  const task = uploadTask();
  const onProgress = jest.fn();
  const onUploadComplete = jest.fn();
  const body = new Blob(['picture'], { type: 'image/png' });
  const promise = uploadRawToPath('schools/pu/stories/s1/image', body, 'image/png', { ownerUid: 'alice' }, {
    onProgress, onUploadComplete,
  });
  task.progress(512, 2048);
  expect(onProgress).toHaveBeenLastCalledWith({ loaded: 512, total: 2048, percentage: 25 });
  expect(uploadBytesResumable).toHaveBeenCalledWith('storage-ref', body, {
    contentType: 'image/png', customMetadata: { ownerUid: 'alice' },
  });
  task.complete();
  await expect(promise).resolves.toBe('https://example.com/photo');
  task.progress(999, 1000);
  task.fail(new Error('retired'));
  task.complete();
  expect(onUploadComplete).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenCalledTimes(1);
  expect(task.unsubscribe).toHaveBeenCalledTimes(1);
  expect(uploadBytes).not.toHaveBeenCalled();
});

test('aborting cancels the Storage task and ignores queued progress, completion, and errors', async () => {
  const task = uploadTask();
  const controller = new AbortController();
  const onProgress = jest.fn();
  const onUploadComplete = jest.fn();
  const promise = uploadRawToPath('path', new Blob(['photo']), 'image/png', { ownerUid: 'alice' }, {
    signal: controller.signal, onProgress, onUploadComplete,
  });
  controller.abort();
  await expect(promise).rejects.toMatchObject({ code: 'storage/canceled' });
  task.progress(1000, 1000);
  task.complete();
  task.fail(new Error('queued error'));
  expect(task.cancel).toHaveBeenCalledTimes(1);
  expect(task.unsubscribe).toHaveBeenCalledTimes(1);
  expect(onProgress).not.toHaveBeenCalled();
  expect(onUploadComplete).not.toHaveBeenCalled();
  expect(getDownloadURL).not.toHaveBeenCalled();
});

test('a failed upload unsubscribes and a late abort does not affect a settled task', async () => {
  const task = uploadTask();
  const controller = new AbortController();
  const onUploadComplete = jest.fn();
  const promise = uploadRawToPath('path', new Blob(['photo']), 'image/png', undefined, {
    signal: controller.signal, onUploadComplete,
  });
  const error = new Error('offline');
  task.fail(error);
  await expect(promise).rejects.toBe(error);
  controller.abort();
  task.complete();
  expect(task.unsubscribe).toHaveBeenCalledTimes(1);
  expect(task.cancel).not.toHaveBeenCalled();
  expect(onUploadComplete).not.toHaveBeenCalled();
});

test('a canceled URL lookup retains a completed upload for a retry without retransmitting bytes', async () => {
  const task = uploadTask();
  const url = deferred<string>();
  const controller = new AbortController();
  const onUploadComplete = jest.fn();
  jest.mocked(getDownloadURL).mockReturnValueOnce(url.promise);
  const body = new Blob(['photo']);
  const first = uploadRawToPath('path', body, 'image/png', undefined, {
    signal: controller.signal, onUploadComplete,
  });
  task.complete();
  await Promise.resolve();
  expect(getDownloadURL).toHaveBeenCalledTimes(1);
  expect(onUploadComplete).toHaveBeenCalledTimes(1);
  controller.abort();
  url.resolve('https://example.com/late');
  await expect(first).rejects.toMatchObject({ code: 'storage/canceled' });
  await expect(uploadRawToPath('path', body, 'image/png', undefined, { uploaded: true })).resolves.toBe('https://example.com/photo');
  expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
  expect(getDownloadURL).toHaveBeenCalledTimes(2);
});

test.each(['image', 'video'])('reuses a completed %s stage even after its local file becomes unreadable', async (kind) => {
  global.fetch = jest.fn().mockRejectedValue(new Error('local file removed'));
  const promise = kind === 'image'
    ? uploadStoryImage('pu', 'reserved', 'alice', 'file:///missing', 'image/png', { uploaded: true })
    : uploadStoryVideo('pu', 'reserved', 'alice', 'file:///missing', 1000, { uploaded: true });
  await expect(promise).resolves.toBe('https://example.com/photo');
  expect(ref).toHaveBeenCalledWith({}, `schools/pu/stories/reserved/${kind}`);
  expect(getDownloadURL).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(uploadBytesResumable).not.toHaveBeenCalled();
  expect(uploadBytes).not.toHaveBeenCalled();
});

test.each(['image', 'video'])('an already aborted %s stage retry does not read its URL or local file', async (kind) => {
  global.fetch = jest.fn();
  const controller = new AbortController();
  controller.abort();
  const options = { uploaded: true, signal: controller.signal };
  const promise = kind === 'image'
    ? uploadStoryImage('pu', 'reserved', 'alice', 'file:///missing', 'image/png', options)
    : uploadStoryVideo('pu', 'reserved', 'alice', 'file:///missing', 1000, options);
  await expect(promise).rejects.toMatchObject({ code: 'storage/canceled' });
  expect(getDownloadURL).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['photo', 'video'])('aborting before local %s decoding never starts an upload', async (kind) => {
  localPhoto(kind === 'photo' ? 'image/png' : 'video/mp4', 100);
  const controller = new AbortController();
  controller.abort();
  const promise = kind === 'photo'
    ? uploadStoryImage('pu', 's1', 'alice', 'file:///photo', 'image/png', { signal: controller.signal })
    : uploadStoryVideo('pu', 's1', 'alice', 'file:///video', 1000, { signal: controller.signal });
  await expect(promise).rejects.toMatchObject({ code: 'storage/canceled' });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(uploadBytesResumable).not.toHaveBeenCalled();
});

test('cancellation during local file decoding cannot start the Storage task afterward', async () => {
  const data = deferred<Blob>();
  const controller = new AbortController();
  global.fetch = jest.fn(async () => ({ blob: () => data.promise })) as jest.Mock;
  const promise = uploadStoryImage('pu', 's1', 'alice', 'file:///photo', 'image/png', { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  data.resolve(new Blob(['photo'], { type: 'image/png' }));
  await expect(promise).rejects.toMatchObject({ code: 'storage/canceled' });
  expect(global.fetch).toHaveBeenCalledWith('file:///photo', { signal: controller.signal });
  expect(uploadBytesResumable).not.toHaveBeenCalled();
});

const originalPayload = {
  schoolId: 'pu', authorUid: 'alice', kind: 'text' as const, text: '原版內容',
  allowReplies: true, bgColor: '#000000', mediaUrl: null, poiId: null, poiName: null,
  expiresAtMs: 42,
};
const originalRow = { ...originalPayload, expiresAt: 42 };

test('confirms an exact expired original from the server without issuing another write', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue({
    data: () => originalRow,
    metadata: { fromCache: false, hasPendingWrites: false },
  } as never);
  await expect(publishStory('reserved', originalPayload, { confirmFirst: true })).resolves.toBe('reserved');
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(setDoc).not.toHaveBeenCalled();
});

test.each(['unavailable', 'permission-denied'])('recovers a lost %s receipt from exact server evidence', async (code) => {
  jest.mocked(setDoc).mockRejectedValue(Object.assign(new Error('lost receipt'), { code }));
  jest.mocked(getDocFromServer).mockResolvedValue({ data: () => originalRow } as never);
  await expect(publishStory('reserved', originalPayload)).resolves.toBe('reserved');
  expect(setDoc).toHaveBeenCalledTimes(1);
});

test.each([
  { fromCache: true, hasPendingWrites: false },
  { fromCache: false, hasPendingWrites: true },
])('does not accept local-only confirmation %j', async (metadata) => {
  const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
  jest.mocked(setDoc).mockRejectedValue(denied);
  jest.mocked(getDocFromServer).mockResolvedValue({ data: () => originalRow, metadata } as never);
  await expect(publishStory('reserved', originalPayload, { confirmFirst: true })).rejects.toBe(denied);
});

test('an unavailable confirmation read retries the exact original ID, payload, and expiry', async () => {
  jest.mocked(getDocFromServer).mockRejectedValue(new Error('offline read'));
  await expect(publishStory('reserved', originalPayload, { confirmFirst: true })).resolves.toBe('reserved');
  expect(setDoc).toHaveBeenCalledWith({ id: 'reserved' }, expect.objectContaining({
    text: '原版內容', allowReplies: true, expiresAt: 42,
  }));
});

test('an aborted confirmation read cannot fall through to a new write', async () => {
  const controller = new AbortController();
  const snapshot = deferred<never>();
  jest.mocked(getDocFromServer).mockReturnValue(snapshot.promise);
  const promise = publishStory('reserved', originalPayload, { signal: controller.signal, confirmFirst: true });
  controller.abort();
  snapshot.resolve({ data: () => null } as never);
  await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  expect(setDoc).not.toHaveBeenCalled();
});

test('an aborted publication ignores a late successful write receipt', async () => {
  const controller = new AbortController();
  const write = deferred<void>();
  jest.mocked(setDoc).mockReturnValue(write.promise);
  const promise = publishStory('reserved', originalPayload, { signal: controller.signal });
  controller.abort();
  write.resolve();
  await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  expect(getDocFromServer).not.toHaveBeenCalled();
});
