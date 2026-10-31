import { buildNativePhotoPdf } from '../screens/nuni/nativePhotoPdf';
import { createPhotoPdf } from '@campus/shared/src/photoPdf';
import * as ImageManipulator from 'expo-image-manipulator';

const mockWrites = jest.fn();
const mockDeletes = jest.fn();
let mockPixels = new Uint8Array([
  255, 216, 255, 225, 0, 5, 71, 80, 83, 255, 218, 0, 2, 1, 2, 255, 217,
]);
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache/' },
  File: class {
    uri: string;
    exists = true;
    constructor(...paths: string[]) {
      this.uri = paths.join('/');
    }
    async arrayBuffer() {
      return mockPixels.buffer;
    }
    write(bytes: Uint8Array) {
      mockWrites(bytes);
    }
    delete() {
      mockDeletes(this.uri);
    }
  },
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async (uri: string, actions: { rotate: number }[]) => ({
    uri: `${uri}-rendered`,
    width: actions[0].rotate % 180 ? 30 : 20,
    height: actions[0].rotate % 180 ? 20 : 30,
  })),
}));
const page = (name: string, rotation: number) => ({
  file: {
    uri: name,
    key: name,
    name,
    contentType: 'image/jpeg',
    byteSize: 100,
    kind: 'image' as const,
  },
  rotation,
});
beforeEach(() => {
  jest.clearAllMocks();
});

test('renders edited order and rotations, writes the same metadata-free PDF, and retains only confirmed output', async () => {
  const proof = await buildNativePhotoPdf([page('b', 90), page('a', 180)]);
  expect(ImageManipulator.manipulateAsync).toHaveBeenNthCalledWith(1, 'b', [{ rotate: 90 }], {
    compress: 0.94,
    format: 'jpeg',
  });
  expect(ImageManipulator.manipulateAsync).toHaveBeenNthCalledWith(2, 'a', [{ rotate: 180 }], {
    compress: 0.94,
    format: 'jpeg',
  });
  expect(mockWrites).toHaveBeenCalledWith(
    createPhotoPdf([
      { jpeg: mockPixels, width: 30, height: 20 },
      { jpeg: mockPixels, width: 20, height: 30 },
    ]),
  );
  expect(proof.previews).toEqual(['b-rendered', 'a-rendered']);
  expect(proof.file.contentType).toBe('application/pdf');
  proof.dispose(true);
  expect(mockDeletes.mock.calls.flat()).toEqual(['b-rendered', 'a-rendered']);
});

test('cancel removes the generated PDF and page images', async () => {
  const proof = await buildNativePhotoPdf([page('a', 270)]);
  proof.dispose();
  expect(mockDeletes).toHaveBeenCalledWith(proof.file.uri);
  expect(mockDeletes).toHaveBeenCalledWith('a-rendered');
});

test('cleans up and refuses an oversized document', async () => {
  const original = mockPixels;
  mockPixels = new Uint8Array(20 * 1024 * 1024);
  mockPixels.set([255, 216, 255, 218]);
  jest
    .mocked(ImageManipulator.manipulateAsync)
    .mockResolvedValueOnce({ uri: 'large', width: 20, height: 10 });
  await expect(buildNativePhotoPdf([page('a', 0)])).rejects.toThrow();
  expect(mockWrites).not.toHaveBeenCalled();
  expect(mockDeletes).toHaveBeenCalledWith('large');
  mockPixels = original;
});
