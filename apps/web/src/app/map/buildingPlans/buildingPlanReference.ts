'use client';

import { createPersonalImportImagePreview } from '@/lib/personalImportImagePreview';

function requireActive(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('已取消讀取', 'AbortError');
}

/** Re-encode accepted raster pixels before exposing a reference; callers own object URLs. */
export async function prepareBuildingPlanReference(
  file: File,
  signal?: AbortSignal,
): Promise<{ blob: Blob; width: number; height: number; name: string }> {
  const activeSignal = signal ?? new AbortController().signal;
  // The shared preview boundary enforces PNG/JPEG/WebP, 10 MiB, 24M source pixels,
  // and re-encodes to PNG with the longest side at most 2048 pixels.
  const blob = await createPersonalImportImagePreview(file, activeSignal);
  requireActive(activeSignal);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    requireActive(activeSignal);
    throw new Error('無法讀取圖面圖片，請重新選擇 PNG、JPEG 或 WebP 圖片。');
  }
  try {
    requireActive(activeSignal);
    const { width, height } = bitmap;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      Math.max(width, height) > 2048)
      throw new Error('圖面圖片尺寸不正確，請重新選擇圖片。');
    return { blob, width, height, name: file.name };
  } finally {
    bitmap.close();
  }
}
