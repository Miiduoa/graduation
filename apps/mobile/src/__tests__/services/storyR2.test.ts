const mockUpload = jest.fn();
const mockLegacy = jest.fn();
let mockEnabled = false;
jest.mock('../../services/privateFiles', () => ({
  isR2FileStorageEnabled: () => mockEnabled,
  privateStoryPath: jest.requireActual('@campus/shared/src/privateFileAccess').privateStoryPath,
  uploadPrivateFile: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock('../../firebase', () => ({ getStorageInstance: () => ({}) }));
jest.mock('firebase/storage', () => ({
  ref: (_: unknown, path: string) => path,
  uploadBytes: (...args: unknown[]) => mockLegacy(...args),
  getDownloadURL: async () => 'https://legacy/image',
}));
import { uploadStoryImage } from '../../services/mediaUpload';
beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled = false;
  global.fetch = jest.fn(async () => ({
    blob: async () => new Blob(['image'], { type: 'image/png' }),
  })) as unknown as typeof fetch;
});
test('R2 stores a path and never writes Firebase Storage', async () => {
  mockEnabled = true;
  expect(await uploadStoryImage('pu', 's', 'alice', 'file:///image', 'image/png')).toMatch(/^schools\/pu\/stories\/s\/image-[a-z0-9-]+\.jpg$/);
  expect(mockUpload).toHaveBeenCalledWith(
    expect.objectContaining({ path: expect.stringMatching(/^schools\/pu\/stories\/s\/image-[a-z0-9-]+\.jpg$/), contentType: 'image/png' }),
  );
  expect(mockLegacy).not.toHaveBeenCalled();
});
test('R2 off preserves the legacy uploader', async () => {
  expect(await uploadStoryImage('pu', 's', 'alice', 'file:///image', 'image/png')).toBe(
    'https://legacy/image',
  );
  expect(mockUpload).not.toHaveBeenCalled();
});

it('uses a new key after an upload acknowledgement is lost', async () => {
  mockEnabled = true;
  mockUpload.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({});
  await expect(uploadStoryImage('pu', 's', 'alice', 'file:///image', 'image/png')).rejects.toThrow('network');
  await uploadStoryImage('pu', 's', 'alice', 'file:///image', 'image/png');
  expect(mockUpload.mock.calls[0][0].path).not.toBe(mockUpload.mock.calls[1][0].path);
});
