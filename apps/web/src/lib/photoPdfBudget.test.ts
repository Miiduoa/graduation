// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  checkPhotoPixels,
  MAX_RENDERED_PHOTO_PIXELS,
  PHOTO_BUDGET_MESSAGE,
  photoDimensions,
  photoRenderSize,
} from '@campus/shared/src/photoPdfBudget';

describe('shared photo PDF processing budget', () => {
  it('rejects truncated JPEG fill bytes and segment lengths with a readable error', () => {
    for (const bytes of [
      [255, 216, 255, 255, 255, 255],
      [255, 216, 255, 255, 192, 0],
      [255, 216, 255, 255, 192],
    ]) {
      expect(() => photoDimensions(Uint8Array.from(bytes))).toThrow(
        '請使用可讀取尺寸的 JPEG 或 PNG',
      );
    }
  });

  it('still reads a valid JPEG dimension header with fill bytes', () => {
    const bytes = Uint8Array.from([255, 216, 255, 255, 192, 0, 8, 8, 0, 4, 0, 3, 1]);
    expect(photoDimensions(bytes)).toEqual({ width: 3, height: 4 });
  });

  it('rejects fractional dimensions and invalid cumulative pixel totals', () => {
    for (const [width, height, previous] of [
      [1.5, 2, 0],
      [2, 1.5, 0],
      [4000, 4000, -1],
      [4000, 4000, NaN],
      [1, 1, 0.5],
    ]) {
      expect(() => checkPhotoPixels(width, height, previous)).toThrow(PHOTO_BUDGET_MESSAGE);
    }
  });

  it('preserves the exact cumulative pixel boundary', () => {
    expect(checkPhotoPixels(4000, 4000, 16_000_000)).toBe(32_000_000);
    expect(() => checkPhotoPixels(4000, 4000, 16_000_001)).toThrow(PHOTO_BUDGET_MESSAGE);
  });

  it('keeps both rendered dimensions positive without exceeding the pixel budget', () => {
    for (const [width, height] of [
      [1, 16_000_000],
      [16_000_000, 1],
      [4000, 4000],
      [3, 4],
    ]) {
      const rendered = photoRenderSize(width, height);
      expect(rendered.width).toBeGreaterThanOrEqual(1);
      expect(rendered.height).toBeGreaterThanOrEqual(1);
      expect(rendered.width * rendered.height).toBeLessThanOrEqual(MAX_RENDERED_PHOTO_PIXELS);
    }
    expect(photoRenderSize(3, 4)).toEqual({ width: 3, height: 4 });
  });
});
