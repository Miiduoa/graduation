import { Image } from 'react-native';
import { buildNativePhotoPdf } from '../screens/nuni/nativePhotoPdf';
import { createPhotoPdf } from '@campus/shared/src/photoPdf';
import * as ImageManipulator from 'expo-image-manipulator';

let mockWidth = 20;
let mockHeight = 30;
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
    get size() {
      return this.uri.endsWith('-rendered') || this.uri === 'large' ? mockPixels.length : 100;
    }
    slice() {
      const header = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 30, 0, 20, 3]);
      new DataView(header.buffer).setUint16(9, mockWidth);
      new DataView(header.buffer).setUint16(7, mockHeight);
      return { arrayBuffer: async () => header.buffer };
    }
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

test('cancellation during native conversion cleans the current image and never starts another page', async () => {
  const controller = new AbortController();
  jest.mocked(ImageManipulator.manipulateAsync).mockImplementationOnce(async () => {
    controller.abort();
    return { uri: 'cancelled-rendered', width: 20, height: 30 };
  });
  await expect(
    buildNativePhotoPdf([page('a', 0), page('b', 0)], controller.signal),
  ).rejects.toThrow('取消');
  expect(ImageManipulator.manipulateAsync).toHaveBeenCalledTimes(1);
  expect(mockDeletes).toHaveBeenCalledWith('cancelled-rendered');
  expect(mockWrites).not.toHaveBeenCalled();
});

test('oversized first page never starts the second conversion', async () => {
  const original = mockPixels;
  try {
    mockPixels = new Uint8Array(20 * 1024 * 1024);
    await expect(buildNativePhotoPdf([page('a', 0), page('b', 0)])).rejects.toThrow();
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledTimes(1);
    expect(mockDeletes).toHaveBeenCalledWith('a-rendered');
  } finally {
    mockPixels = original;
  }
});

test('來源像素預算在呼叫原生轉檔前拒絕過大的照片與整批工作量', async () => {
  try {
    mockWidth = 8064;
    mockHeight = 6048;
    await expect(buildNativePhotoPdf([page('a', 0)])).rejects.toThrow('處理預算');
    mockWidth = 4000;
    mockHeight = 3000;
    await expect(buildNativePhotoPdf(Array(3).fill(page('a', 0)))).rejects.toThrow('處理預算');
    expect(ImageManipulator.manipulateAsync).not.toHaveBeenCalled();
  } finally {
    mockWidth = 20;
    mockHeight = 30;
  }
});

test('常見相機照片在旋轉與編碼前縮至安全尺寸', async () => {
  try {
    mockWidth = 4032;
    mockHeight = 3024;
    const size = jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => {
      success(3024, 4032);
    });
    const proof = await buildNativePhotoPdf([page('camera', 90)]);
    size.mockRestore();
    const actions = jest.mocked(ImageManipulator.manipulateAsync).mock.calls[0][1];
    const target = (actions[0] as { resize: { width: number; height: number } }).resize;
    expect(target.width * target.height).toBeLessThanOrEqual(12_000_000);
    expect(target.width / target.height).toBeCloseTo(3 / 4, 2);
    expect(actions[1]).toEqual({ rotate: 90 });
    proof.dispose();
  } finally {
    mockWidth = 20;
    mockHeight = 30;
  }
});
