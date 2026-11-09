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
  expect(await uploadStoryImage('pu', 's', 'alice', 'file:///image', 'image/png')).toBe(
    'schools/pu/stories/s/image',
  );
  expect(mockUpload).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'schools/pu/stories/s/image', contentType: 'image/png' }),
  );
  expect(mockLegacy).not.toHaveBeenCalled();
});
test('R2 off preserves the legacy uploader', async () => {
  expect(await uploadStoryImage('pu', 's', 'alice', 'file:///image', 'image/png')).toBe(
    'https://legacy/image',
  );
  expect(mockUpload).not.toHaveBeenCalled();
});
