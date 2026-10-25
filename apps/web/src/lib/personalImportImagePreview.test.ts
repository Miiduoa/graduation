import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PERSONAL_IMPORT_IMAGE_UNREADABLE } from '@campus/shared';
import { createPersonalImportImagePreview } from './personalImportImagePreview';

let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let png: Blob;
const drawImage = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  bitmap = { width: 640, height: 480, close: vi.fn() };
  png = new Blob(['encoded pixels'], { type: 'image/png' });
  drawImage.mockReset();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(png));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['image/png', 'image/jpeg', 'image/webp'])('re-encodes %s pixels as a separate PNG preview', async (type) => {
  const original = new File(['original bytes'], 'screenshot', { type });
  const result = await createPersonalImportImagePreview(original, new AbortController().signal);
  expect(createImageBitmap).toHaveBeenCalledWith(original);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 640, 480);
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  expect(result).toBe(png);
  expect(result).not.toBe(original);
  expect(result.type).toBe('image/png');
  expect(bitmap.close).toHaveBeenCalledOnce();
  const canvas = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.contexts[0] as HTMLCanvasElement;
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
});

it.each(['image/svg+xml', 'text/html', 'image/gif'])('rejects %s before decoding or creating a preview', async (type) => {
  const file = new File(['<svg onload="alert(1)"></svg>'], 'screenshot.png', { type });
  await expect(createPersonalImportImagePreview(file, new AbortController().signal)).rejects.toThrow('請選 PNG、JPEG 或 WebP 圖片。');
  expect(createImageBitmap).not.toHaveBeenCalled();
  expect(drawImage).not.toHaveBeenCalled();
});

it('keeps the OCR input-size boundary and rejects oversized files before decoding', async () => {
  const file = new File(['pixels'], 'screenshot.jpg', { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { configurable: true, value: 10 * 1024 * 1024 });
  await expect(createPersonalImportImagePreview(file, new AbortController().signal)).resolves.toBe(png);
  vi.mocked(createImageBitmap).mockClear();
  Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 });
  await expect(createPersonalImportImagePreview(file, new AbortController().signal)).rejects.toThrow('圖片超過 10 MB');
  expect(createImageBitmap).not.toHaveBeenCalled();
});

it('accepts the existing pixel limit and closes an oversized decoded image', async () => {
  const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' });
  bitmap.width = 6000;
  bitmap.height = 4000;
  await expect(createPersonalImportImagePreview(file, new AbortController().signal)).resolves.toBe(png);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2048, 1365);
  bitmap.close.mockClear();
  drawImage.mockClear();
  bitmap.height = 4001;
  await expect(createPersonalImportImagePreview(file, new AbortController().signal)).rejects.toThrow('圖片尺寸太大');
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(drawImage).not.toHaveBeenCalled();
});

it('rejects HTML disguised as an accepted image when decoding fails', async () => {
  vi.mocked(createImageBitmap).mockRejectedValue(new Error('not an image'));
  const file = new File(['<html><script>alert(1)</script></html>'], 'screenshot.png', { type: 'image/png' });
  await expect(createPersonalImportImagePreview(file, new AbortController().signal)).rejects.toThrow(PERSONAL_IMPORT_IMAGE_UNREADABLE);
  expect(drawImage).not.toHaveBeenCalled();
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
});

it.each(['context', 'drawing', 'null-blob', 'wrong-type', 'encoding'] as const)('fails closed on %s failure and releases the bitmap', async (failure) => {
  if (failure === 'context') vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  if (failure === 'drawing') drawImage.mockImplementation(() => { throw new Error('draw failed'); });
  if (failure === 'null-blob') vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(null));
  if (failure === 'wrong-type') vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(new Blob(['html'], { type: 'text/html' })));
  if (failure === 'encoding') vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(() => { throw new Error('encoding failed'); });
  const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' });
  await expect(createPersonalImportImagePreview(file, new AbortController().signal)).rejects.toThrow(PERSONAL_IMPORT_IMAGE_UNREADABLE);
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it('does not decode an already cancelled file', async () => {
  const controller = new AbortController();
  controller.abort();
  const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' });
  await expect(createPersonalImportImagePreview(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(createImageBitmap).not.toHaveBeenCalled();
});

it('closes a decoded bitmap that finishes after cancellation', async () => {
  let finish!: (value: ImageBitmap) => void;
  vi.mocked(createImageBitmap).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' });
  const pending = createPersonalImportImagePreview(file, controller.signal);
  controller.abort();
  finish(bitmap as unknown as ImageBitmap);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(drawImage).not.toHaveBeenCalled();
});

it('discards a PNG encoding that completes after cancellation', async () => {
  let finish!: BlobCallback;
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => { finish = callback; });
  const controller = new AbortController();
  const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' });
  const pending = createPersonalImportImagePreview(file, controller.signal);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(bitmap.close).toHaveBeenCalledOnce();
  finish(png);
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});
