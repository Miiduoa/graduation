import { afterEach, expect, it, vi } from 'vitest';
import { buildPhotoPdf, validatePhotoPages, type PhotoPage } from './photoPdf';
import { checkPhotoPixels, photoDimensions } from '@campus/shared/src/photoPdfBudget';

function page(width = 100, height = 100): PhotoPage {
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x89504e47);
  view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  const file = {
    size: 24,
    slice: () => ({ arrayBuffer: async () => header.buffer }),
  } as unknown as File;
  return { key: 'test', url: 'blob:test', rotation: 0, file };
}
afterEach(() => vi.unstubAllGlobals());

it('rejects excessive single and total pixels before decoding, including unsupported headers', async () => {
  await expect(validatePhotoPages([page(8064, 6048)])).rejects.toThrow('處理預算');
  await expect(validatePhotoPages(Array(3).fill(page(4000, 3000)))).rejects.toThrow('處理預算');
  expect(() => checkPhotoPixels(0, 1)).toThrow();
  expect(() => photoDimensions(new Uint8Array([1, 2]))).toThrow('JPEG');
  await expect(validatePhotoPages([page(4000, 3000)])).resolves.toBeUndefined();
});

function renderer(blobSize: number, duringEncode?: () => void) {
  const decode = vi.fn(async () => {});
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 100;
      naturalHeight = 100;
      src = '';
      decode = decode;
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillRect() {}, translate() {}, rotate() {}, drawImage() {} }),
    toBlob: (callback: (blob: unknown) => void) => {
      duringEncode?.();
      callback({
        size: blobSize,
        arrayBuffer: async () => new Uint8Array([255, 216, 255, 218]).buffer,
      });
    },
  };
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
  return { canvas, decode };
}

afterEach(() => vi.restoreAllMocks());
it('stops before the second page when the first encoded page is oversized and releases the canvas', async () => {
  const { canvas, decode } = renderer(20 * 1024 * 1024);
  await expect(buildPhotoPdf([page(), page()])).rejects.toThrow();
  expect(decode).toHaveBeenCalledTimes(1);
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
});
it('stops after cancellation at an async boundary and releases the canvas', async () => {
  const controller = new AbortController();
  const { canvas, decode } = renderer(4, () => controller.abort());
  await expect(buildPhotoPdf([page(), page()], controller.signal)).rejects.toThrow('取消');
  expect(decode).toHaveBeenCalledTimes(1);
  expect(canvas.width).toBe(0);
});
