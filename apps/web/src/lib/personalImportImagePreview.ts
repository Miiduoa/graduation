'use client';

import { PERSONAL_IMPORT_IMAGE_UNREADABLE } from '@campus/shared';

function requireActive(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('已取消讀取', 'AbortError');
}

/** Only decoded pixels enter the preview; the original file stays with OCR. */
export async function createPersonalImportImagePreview(
  file: File,
  signal: AbortSignal,
): Promise<Blob> {
  requireActive(signal);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('請選 PNG、JPEG 或 WebP 圖片。');
  if (file.size > 10 * 1024 * 1024) throw new Error('圖片超過 10 MB，請裁切後再選一次。');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    requireActive(signal);
    throw new Error(PERSONAL_IMPORT_IMAGE_UNREADABLE);
  }

  try {
    requireActive(signal);
    if (bitmap.width * bitmap.height > 24_000_000)
      throw new Error('圖片尺寸太大，請裁切到需要的表格後再試。');
    if (!bitmap.width || !bitmap.height) throw new Error(PERSONAL_IMPORT_IMAGE_UNREADABLE);

    const canvas = document.createElement('canvas');
    try {
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error(PERSONAL_IMPORT_IMAGE_UNREADABLE);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob>((resolve, reject) => {
        const abort = () => reject(new DOMException('已取消讀取', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
          signal.removeEventListener('abort', abort);
          abort();
          return;
        }
        try {
          canvas.toBlob((blob) => {
            signal.removeEventListener('abort', abort);
            if (signal.aborted) abort();
            else if (blob?.type === 'image/png') resolve(blob);
            else reject(new Error(PERSONAL_IMPORT_IMAGE_UNREADABLE));
          }, 'image/png');
        } catch (error) {
          signal.removeEventListener('abort', abort);
          reject(error);
        }
      });
      requireActive(signal);
      return png;
    } catch {
      requireActive(signal);
      throw new Error(PERSONAL_IMPORT_IMAGE_UNREADABLE);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}
