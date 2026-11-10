// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ enabled: false, upload: vi.fn(), legacy: vi.fn() }));
vi.mock('../privateFiles', async () => ({
  privateFilesEnabled: () => state.enabled,
  privateStoryPath: (await import('@campus/shared/src/privateFileAccess')).privateStoryPath,
  uploadPrivateFile: state.upload,
}));
vi.mock('firebase/app', () => ({ getApps: () => [{}] }));
vi.mock('firebase/storage', () => ({
  getStorage: () => ({}),
  ref: (_: unknown, path: string) => path,
  uploadBytes: state.legacy,
  getDownloadURL: async () => 'https://legacy/image',
}));
import { uploadStoryImage } from './media';
beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = false;
});
it('writes the object path into the existing URL result in Supabase mode', async () => {
  state.enabled = true;
  const file = new File(['image'], 'photo.png', { type: 'image/png' });
  const result = await uploadStoryImage({ schoolId: 'pu', storyId: 's', uid: 'alice', file });
  expect(result.url).toMatch(/^schools\/pu\/stories\/s\/image-[a-z0-9-]+\.jpg$/);
  expect(state.upload).toHaveBeenCalledWith({
    path: result.url,
    body: file,
    contentType: 'image/png',
  });
  expect(state.legacy).not.toHaveBeenCalled();
});
it('preserves the legacy uploader with Supabase off', async () => {
  const result = await uploadStoryImage({
    schoolId: 'pu',
    storyId: 's',
    uid: 'alice',
    file: new File(['image'], 'photo.png', { type: 'image/png' }),
  });
  expect(result.url).toBe('https://legacy/image');
  expect(state.upload).not.toHaveBeenCalled();
});

it('uses a new key after an upload acknowledgement is lost', async () => {
  state.enabled = true;
  state.upload.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({});
  const input = { schoolId: 'pu', storyId: 's', uid: 'alice', file: new File(['image'], 'photo.png', { type: 'image/png' }) };
  await expect(uploadStoryImage(input)).rejects.toThrow('network');
  await uploadStoryImage(input);
  expect(state.upload.mock.calls[0][0].path).not.toBe(state.upload.mock.calls[1][0].path);
});

it('does not return story media when finalization fails', async () => {
  state.enabled = true;
  state.upload.mockRejectedValueOnce(Object.assign(new Error('File is too large'), { statusCode: 413 }));
  await expect(uploadStoryImage({ schoolId: 'pu', storyId: 's', uid: 'alice', file: new File(['image'], 'photo.png', { type: 'image/png' }) })).rejects.toMatchObject({ statusCode: 413 });
  expect(state.legacy).not.toHaveBeenCalled();
});
