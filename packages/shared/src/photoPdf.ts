import { checkPhotoBytes, checkPhotoPixels } from './photoPdfBudget';
import { assertAssignmentFileSize, MAX_ASSIGNMENT_IMAGES } from './assignmentFiles';

export type PdfPhoto = { jpeg: Uint8Array; width: number; height: number };

// Keep image data only: APP markers can contain EXIF, location, thumbnails and comments.
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('無法讀取照片，請換一張再試。');
  const chunks = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 255) throw new Error('照片格式不完整。');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) {
      chunks.push(bytes.subarray(start));
      return concat(chunks);
    }
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw new Error('照片格式不完整。');
    if (!(marker >= 224 && marker <= 239) && marker !== 254)
      chunks.push(bytes.subarray(start, offset + length));
    offset += length;
  }
  throw new Error('照片格式不完整。');
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// A small PDF writer shared by both clients; no original photo file is embedded.
export function createPhotoPdf(photos: PdfPhoto[]): Uint8Array {
  if (!photos.length || photos.length > MAX_ASSIGNMENT_IMAGES) throw new Error('請選 1–8 張照片。');
  let pixels = 0;
  let imageBytes = 0;
  for (const photo of photos) {
    pixels = checkPhotoPixels(photo.width, photo.height, pixels);
    imageBytes += photo.jpeg.length;
    checkPhotoBytes(imageBytes);
  }
  const encode = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let length = 0;
  const append = (value: Uint8Array) => {
    chunks.push(value);
    length += value.length;
  };
  const object = (id: number, body: Uint8Array) => {
    offsets[id] = length;
    append(encode(`${id} 0 obj\n`));
    append(body);
    append(encode('\nendobj\n'));
  };
  append(encode('%PDF-1.4\n%\xff\xff\xff\xff\n'));
  object(1, encode('<< /Type /Catalog /Pages 2 0 R >>'));
  object(
    2,
    encode(
      `<< /Type /Pages /Count ${photos.length} /Kids [${photos.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`,
    ),
  );
  photos.forEach((photo, index) => {
    if (
      !Number.isSafeInteger(photo.width) ||
      !Number.isSafeInteger(photo.height) ||
      photo.width <= 0 ||
      photo.height <= 0
    )
      throw new Error('照片尺寸不正確。');
    const jpeg = stripJpegMetadata(photo.jpeg);
    const id = 3 + index * 3;
    const scale = Math.min(1, 14400 / Math.max(photo.width, photo.height));
    const width = Math.round(photo.width * scale);
    const height = Math.round(photo.height * scale);
    const content = encode(`q\n${width} 0 0 ${height} 0 0 cm\n/Photo Do\nQ`);
    object(
      id,
      encode(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Photo ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
      ),
    );
    object(
      id + 1,
      concat([
        encode(
          `<< /Type /XObject /Subtype /Image /Width ${photo.width} /Height ${photo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        ),
        jpeg,
        encode('\nendstream'),
      ]),
    );
    object(
      id + 2,
      concat([encode(`<< /Length ${content.length} >>\nstream\n`), content, encode('\nendstream')]),
    );
    assertAssignmentFileSize('file', length);
  });
  const xref = length;
  append(
    encode(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  assertAssignmentFileSize('file', length);
  return concat(chunks);
}
