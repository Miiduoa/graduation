import {
  NativeTronClassFileCache,
  discardTronClassPickerCopies,
} from '../services/tronClassNativeFileCache';
import { fileBytes, directories, deleted, resetFileSystem } from './fixtures/tronClassFileSystem';

jest.mock('expo-file-system', () => require('./fixtures/tronClassFileSystem'));
let mockId = 0;
const mockShare = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => `cache-${++mockId}` }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
const asset = {
  uri: 'file:///cache/picked.pdf',
  name: '答案.pdf',
  size: 3,
  mimeType: 'application/pdf',
};
beforeEach(() => {
  resetFileSystem();
  mockShare.mockReset().mockResolvedValue(undefined);
  fileBytes.set(asset.uri, new Uint8Array([1, 2, 3]));
});
it('takes ownership of a picker copy, discovers missing size metadata from File, and removes it on discard', () => {
  const cache = new NativeTronClassFileCache();
  const files = cache.adopt([{ ...asset, size: undefined }]);
  expect(files[0]).toMatchObject({ name: '答案.pdf', size: 3, contentType: 'application/pdf' });
  expect(files[0].uri).toMatch(/^file:\/\/\/cache\/nuni-tronclass-/);
  expect(fileBytes.has(asset.uri)).toBe(false);
  cache.retain([]);
  expect(fileBytes.has(files[0].uri)).toBe(false);
  cache.dispose();
});
it('never deletes an original outside the app cache', () => {
  const original = { ...asset, uri: 'file:///documents/original.pdf' };
  fileBytes.set(original.uri, new Uint8Array([1, 2, 3]));
  const cache = new NativeTronClassFileCache();
  expect(() => cache.adopt([original])).toThrow('PICKER_CACHE_REQUIRED');
  discardTronClassPickerCopies([original]);
  expect(fileBytes.has(original.uri)).toBe(true);
  cache.dispose();
});
it('retains a live screen cache but removes abandoned roots left by a previous process', () => {
  const live = new NativeTronClassFileCache();
  const files = live.adopt([asset]);
  directories.add('file:///cache/nuni-tronclass-abandoned');
  fileBytes.set('file:///cache/nuni-tronclass-abandoned/old.draft', new Uint8Array([1]));
  fileBytes.set(asset.uri, new Uint8Array([1, 2, 3]));
  const other = new NativeTronClassFileCache();
  other.adopt([asset]);
  expect(fileBytes.has(files[0].uri)).toBe(true);
  expect(fileBytes.has('file:///cache/nuni-tronclass-abandoned/old.draft')).toBe(false);
  live.dispose();
  other.dispose();
});
it('deletes download bytes after sharing returns or rejects', async () => {
  const cache = new NativeTronClassFileCache();
  const result = {
    bytes: new Uint8Array([1, 2, 3]),
    filename: '講義.pdf',
    contentType: 'application/pdf',
  };
  await cache.share(result, () => true);
  const first = mockShare.mock.calls[0][0];
  expect(deleted).toContain(first);
  expect(fileBytes.has(first)).toBe(false);
  mockShare.mockRejectedValueOnce(new Error('share cancelled'));
  await expect(cache.share(result, () => true)).rejects.toThrow('share cancelled');
  expect(fileBytes.has(mockShare.mock.calls[1][0])).toBe(false);
  cache.dispose();
});
it('removes all owned files on disposal and refuses a late picker while still clearing its cache copy', () => {
  const cache = new NativeTronClassFileCache();
  const [file] = cache.adopt([asset]);
  cache.dispose();
  expect(fileBytes.has(file.uri)).toBe(false);
  fileBytes.set(asset.uri, new Uint8Array([1, 2, 3]));
  expect(() => cache.adopt([asset])).toThrow('DRAFT_SCOPE_CLOSED');
  expect(fileBytes.has(asset.uri)).toBe(false);
});
