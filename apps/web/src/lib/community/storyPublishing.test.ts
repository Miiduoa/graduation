import { beforeEach, expect, it, vi } from 'vitest';
import { createStoryId, publishStory } from './firestore';
import { uploadStoryMedia } from './media';

const mock = vi.hoisted(() => ({
  ref: vi.fn((_storage, path: string) => path),
  upload: vi.fn(),
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
  uploadBytes: mock.upload,
  getDownloadURL: () => 'https://example.test/photo',
}));
beforeEach(() => {
  vi.clearAllMocks();
});

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

it('passes through unrelated write failures without a read', async () => {
  const offline = { code: 'unavailable' };
  mock.write.mockRejectedValueOnce(offline);
  await expect(publishStory(retry)).rejects.toBe(offline);
  expect(mock.readServer).not.toHaveBeenCalled();
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
