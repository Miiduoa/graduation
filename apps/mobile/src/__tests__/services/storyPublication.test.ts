import { collection, doc, getDoc, getDocFromServer, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { uploadStoryImage, uploadStoryVideo } from '../../services/mediaUpload';
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
  getDownloadURL: jest.fn(() => 'https://example.com/photo'),
}));

const originalFetch = global.fetch;
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

test('recovers a committed create after a lost response only for the same active story', async () => {
  const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
  const content = {
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
    { authorUid: 'other' },
    { schoolId: 'other' },
    { mediaUrl: 'wrong' },
    { bgColor: '#fff' },
    { poiId: 'different' },
    { kind: 'text' },
    { expiresAt: 1 },
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
