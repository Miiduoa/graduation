// @vitest-environment node
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createPhotoPdf, stripJpegMetadata } from '@campus/shared/src/photoPdf';

async function photo(width: number, height: number, color: string) {
  const jpeg = await sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
  return { width, height, jpeg: new Uint8Array(jpeg) };
}

describe('photo PDF', () => {
  it('opens with ordered, readable image pages and correct landscape dimensions', async () => {
    const first = await photo(60, 20, '#ff0000');
    const second = await photo(20, 60, '#0000ff');
    const bytes = createPhotoPdf([first, second]);
    const task = getDocument({ data: bytes, useSystemFonts: false });
    const document = await task.promise;
    expect(document.numPages).toBe(2);
    for (const [index, expected] of [first, second].entries()) {
      const page = await document.getPage(index + 1);
      expect(page.getViewport({ scale: 1 }).width).toBe(expected.width);
      expect(page.getViewport({ scale: 1 }).height).toBe(expected.height);
      const operations = await page.getOperatorList();
      expect(operations.fnArray).toContain(OPS.paintImageXObject);
    }
    await task.destroy();
  });

  it('removes EXIF/GPS, thumbnail and comment payloads without damaging pixels', async () => {
    const original = await photo(12, 8, '#00ff00');
    const payload = Buffer.from('Exif\0\0GPS-private-location-thumbnail');
    const marker = Buffer.from([255, 225, 0, payload.length + 2]);
    const annotated = new Uint8Array(
      Buffer.concat([original.jpeg.subarray(0, 2), marker, payload, original.jpeg.subarray(2)]),
    );
    const stripped = stripJpegMetadata(annotated);
    expect(Buffer.from(stripped).includes(payload)).toBe(false);
    const pixels = await sharp(stripped).raw().toBuffer();
    expect(pixels).toEqual(await sharp(original.jpeg).raw().toBuffer());
    const pdf = createPhotoPdf([{ ...original, jpeg: annotated }]);
    expect(Buffer.from(pdf).includes(payload)).toBe(false);
  });

  it('accepts one or eight pages, rejects empty, nine, malformed images and oversized output', async () => {
    const page = await photo(4, 6, '#ffffff');
    expect(createPhotoPdf([page]).length).toBeGreaterThan(0);
    expect(createPhotoPdf(Array(8).fill(page)).length).toBeGreaterThan(0);
    expect(() => createPhotoPdf([])).toThrow();
    expect(() => createPhotoPdf(Array(9).fill(page))).toThrow();
    expect(() => createPhotoPdf([{ ...page, jpeg: new Uint8Array([1, 2]) }])).toThrow();
    const large = new Uint8Array(20 * 1024 * 1024);
    large.set([255, 216, 255, 218]);
    expect(() => createPhotoPdf([{ ...page, jpeg: large }])).toThrow();
  });
});
