import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareBuildingPlanReference } from './buildingPlanReference';

type Bitmap = { width: number; height: number; close: ReturnType<typeof vi.fn> };
let source: Bitmap;
let preview: Bitmap;
let png: Blob;
const drawImage = vi.fn();

function imageFile(type = 'image/png') {
  return new File(['original untrusted bytes'], 'floor-plan.png', { type });
}

beforeEach(() => {
  source = { width: 640, height: 480, close: vi.fn() };
  preview = { width: 640, height: 480, close: vi.fn() };
  png = new Blob(['re-encoded pixels'], { type: 'image/png' });
  drawImage.mockReset();
  vi.stubGlobal('createImageBitmap', vi.fn(async (input: Blob) => input === png ? preview : source));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(png));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('building plan reference image boundary', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('only returns re-encoded pixels and dimensions for %s', async type => {
    const file = imageFile(type);
    const result = await prepareBuildingPlanReference(file);
    expect(createImageBitmap).toHaveBeenNthCalledWith(1, file);
    expect(createImageBitmap).toHaveBeenNthCalledWith(2, png);
    expect(result).toEqual({ blob: png, width: 640, height: 480, name: file.name });
    expect(result.blob).not.toBe(file);
    expect(source.close).toHaveBeenCalledOnce();
    expect(preview.close).toHaveBeenCalledOnce();
    const canvas = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.contexts[0] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('reports resized PNG dimensions rather than the original image size', async () => {
    source.width = 6000;
    source.height = 4000;
    preview.width = 2048;
    preview.height = 1365;
    const result = await prepareBuildingPlanReference(imageFile());
    expect(result).toMatchObject({ width: 2048, height: 1365 });
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 2048, 1365);
    expect(source.close).toHaveBeenCalledOnce();
    expect(preview.close).toHaveBeenCalledOnce();
  });

  it.each(['image/svg+xml', 'text/html', 'image/gif', 'application/octet-stream', ''])
  ('rejects %s before any bitmap decoding', async type => {
    await expect(prepareBuildingPlanReference(imageFile(type))).rejects.toThrow(/PNG、JPEG 或 WebP/);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('inherits the 10 MiB input limit before decoding', async () => {
    const file = imageFile();
    Object.defineProperty(file, 'size', { configurable: true, value: 10 * 1024 * 1024 });
    await expect(prepareBuildingPlanReference(file)).resolves.toMatchObject({ blob: png });
    vi.mocked(createImageBitmap).mockClear();
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 });
    await expect(prepareBuildingPlanReference(file)).rejects.toThrow(/10 MB/);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('closes an oversized source and never performs the second decode', async () => {
    source.width = 6000;
    source.height = 4001;
    await expect(prepareBuildingPlanReference(imageFile())).rejects.toThrow(/圖片尺寸太大/);
    expect(source.close).toHaveBeenCalledOnce();
    expect(preview.close).not.toHaveBeenCalled();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('rejects a disguised non-image when the initial decoder fails', async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(new Error('invalid image bytes'));
    await expect(prepareBuildingPlanReference(imageFile())).rejects.toThrow();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(drawImage).not.toHaveBeenCalled();
    expect(preview.close).not.toHaveBeenCalled();
  });

  it('stops after a PNG encoding failure while releasing the source bitmap and canvas', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(null));
    await expect(prepareBuildingPlanReference(imageFile())).rejects.toThrow();
    expect(source.close).toHaveBeenCalledOnce();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    const canvas = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.contexts[0] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('returns a readable error if the safe PNG cannot be decoded for dimensions', async () => {
    vi.mocked(createImageBitmap)
      .mockResolvedValueOnce(source as unknown as ImageBitmap)
      .mockRejectedValueOnce(new Error('second decode failed'));
    await expect(prepareBuildingPlanReference(imageFile())).rejects.toThrow(/無法讀取圖面圖片/);
    expect(source.close).toHaveBeenCalledOnce();
    expect(preview.close).not.toHaveBeenCalled();
  });

  it.each([[0, 480], [640, 0], [2049, 1000], [NaN, 480], [0.5, 480], [Infinity, 480]])
  ('closes a decoded preview with invalid dimensions %s by %s', async (width, height) => {
    preview.width = width;
    preview.height = height;
    await expect(prepareBuildingPlanReference(imageFile())).rejects.toThrow(/圖片尺寸不正確/);
    expect(source.close).toHaveBeenCalledOnce();
    expect(preview.close).toHaveBeenCalledOnce();
  });
});

describe('reference cancellation and late decoding', () => {
  it('never decodes an already cancelled image', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareBuildingPlanReference(imageFile(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('discards a source decoded after cancellation and closes it without creating a preview', async () => {
    let finish!: (value: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = prepareBuildingPlanReference(imageFile(), controller.signal);
    controller.abort();
    finish(source as unknown as ImageBitmap);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.close).toHaveBeenCalledOnce();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('does not start another decode if cancellation happens while re-encoding', async () => {
    let finish!: BlobCallback;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => { finish = callback; });
    const controller = new AbortController();
    const pending = prepareBuildingPlanReference(imageFile(), controller.signal);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    finish(png);
    expect(source.close).toHaveBeenCalledOnce();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
  });

  it('closes the second bitmap even if it only arrives after cancellation', async () => {
    let finish!: (value: ImageBitmap) => void;
    vi.mocked(createImageBitmap)
      .mockResolvedValueOnce(source as unknown as ImageBitmap)
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = prepareBuildingPlanReference(imageFile(), controller.signal);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    finish(preview as unknown as ImageBitmap);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.close).toHaveBeenCalledOnce();
    expect(preview.close).toHaveBeenCalledOnce();
  });

  it('preserves AbortError if the pending second decode rejects after cancellation', async () => {
    let reject!: (reason: unknown) => void;
    vi.mocked(createImageBitmap)
      .mockResolvedValueOnce(source as unknown as ImageBitmap)
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const controller = new AbortController();
    const pending = prepareBuildingPlanReference(imageFile(), controller.signal);
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    controller.abort();
    reject(new Error('decode failed'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.close).toHaveBeenCalledOnce();
    expect(preview.close).not.toHaveBeenCalled();
  });
});
