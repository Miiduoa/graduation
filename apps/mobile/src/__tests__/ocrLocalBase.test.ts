const mockCopy = jest.fn();
const mockDelete = jest.fn();
let mockCache = false;

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
    exists = mockCache;
    md5: string;
    constructor(...parts: string[]) {
      this.md5 = parts.includes('ruled-timetable-grid.js') ? 'prior-version' : 'bundled-version';
    }
    copy = mockCopy;
    delete = mockDelete;
  },
}));

import { prepareOcrBaseUrl } from '../services/ocrLocalBase';

test('copies bundled recognizer files to a local folder', async () => {
  const url = await prepareOcrBaseUrl();
  expect(url.startsWith('file:')).toBe(true);
  expect(url).not.toMatch(/jsdelivr|tessdata\.projectnaptha/);
  expect(mockCopy).toHaveBeenCalled();
});

test('refreshes an outdated local grid reader while retaining the cached OCR engine and languages', async () => {
  mockCache = true;
  mockCopy.mockClear();
  mockDelete.mockClear();
  await jest.isolateModulesAsync(async () => {
    const { prepareOcrBaseUrl } = jest.requireActual<typeof import('../services/ocrLocalBase')>('../services/ocrLocalBase');
    await prepareOcrBaseUrl();
  });
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockCopy).toHaveBeenCalledTimes(1);
  mockCache = false;
});
