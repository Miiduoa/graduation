const mockCopy = jest.fn();

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: jest.fn().mockResolvedValue(undefined),
      localUri: 'file:///bundled/ocr-file',
    }),
  },
}));

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  Directory: class {
    uri = 'file:///cache/personal-import-ocr';
    create() {}
  },
  File: class {
    exists = false;
    copy = mockCopy;
  },
}));

import { prepareOcrBaseUrl } from '../services/ocrLocalBase';

test('copies bundled recognizer files to a local folder', async () => {
  const url = await prepareOcrBaseUrl();
  expect(url.startsWith('file:')).toBe(true);
  expect(url).not.toMatch(/jsdelivr|tessdata\.projectnaptha/);
  expect(mockCopy).toHaveBeenCalled();
});
