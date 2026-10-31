import { assertAssignmentFileSize } from './assignmentFiles';

export const PHOTO_HEADER_BYTES = 256 * 1024;
export const MAX_PHOTO_PIXELS = 16_000_000;
export const MAX_RENDERED_PHOTO_PIXELS = 12_000_000;
export const MAX_TOTAL_PHOTO_PIXELS = 32_000_000;
export const PHOTO_BUDGET_MESSAGE =
  '照片超過處理預算：來源每張最多 1600 萬像素、合計 3200 萬像素，每張檔案最多 20 MiB。較大照片會縮至 1200 萬像素；超限請刪減照片再試。';

export function checkPhotoCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('已取消製作 PDF。');
}

export function checkPhotoPixels(width: number, height: number, previous = 0) {
  const pixels = width * height;
  if (
    !Number.isSafeInteger(pixels) ||
    width <= 0 ||
    height <= 0 ||
    pixels > MAX_PHOTO_PIXELS ||
    pixels + previous > MAX_TOTAL_PHOTO_PIXELS
  )
    throw new Error(PHOTO_BUDGET_MESSAGE);
  return previous + pixels;
}

export function checkPhotoBytes(bytes: number) {
  try {
    assertAssignmentFileSize('file', bytes + 16 * 1024);
  } catch {
    throw new Error(
      '照片檔案或累計影像超過 20 MiB 處理預算（含 PDF 結構保留空間），請刪減照片再試。',
    );
  }
}

// Only inspect a bounded header before allocating decoded pixels.
export function photoDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    view.getUint32(12) === 0x49484452
  )
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8)
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      offset += length;
    }
  }
  throw new Error('請使用可讀取尺寸的 JPEG 或 PNG 照片；其他格式請先另存後再選。');
}

export function photoRenderSize(width: number, height: number) {
  checkPhotoPixels(width, height);
  const scale = Math.min(1, Math.sqrt(MAX_RENDERED_PHOTO_PIXELS / (width * height)));
  return { width: Math.floor(width * scale), height: Math.floor(height * scale) };
}
