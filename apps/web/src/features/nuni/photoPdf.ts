import {
  checkPhotoBytes,
  checkPhotoCancellation,
  checkPhotoPixels,
  photoDimensions,
  PHOTO_HEADER_BYTES,
} from '@campus/shared/src/photoPdfBudget';
import { createPhotoPdf, type PdfPhoto } from '@campus/shared/src/photoPdf';

export type PhotoPage = { key: string; file: File; rotation: number; url: string };

export async function renderPhoto(page: PhotoPage, signal?: AbortSignal): Promise<PdfPhoto> {
  checkPhotoCancellation(signal);
  const image = new Image();
  const canvas = document.createElement('canvas');
  const cancel = () => {
    image.src = '';
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    image.src = page.url;
    await image.decode();
    const sideways = page.rotation % 180 !== 0;
    checkPhotoCancellation(signal);
    checkPhotoPixels(image.naturalWidth, image.naturalHeight);
    canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
    canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
    if (!canvas.width || !canvas.height) throw new Error('無法讀取照片。');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('這個瀏覽器無法製作 PDF，請換個瀏覽器再試。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((page.rotation * Math.PI) / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.94),
    );
    if (!blob) throw new Error('這張照片無法轉換，請換一張再試。');
    checkPhotoCancellation(signal);
    checkPhotoBytes(blob.size);
    return {
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    signal?.removeEventListener('abort', cancel);
    canvas.width = 0;
    canvas.height = 0;
    image.src = '';
  }
}

export async function buildPhotoPdf(pages: PhotoPage[], signal?: AbortSignal): Promise<File> {
  await validatePhotoPages(pages, signal);
  checkPhotoCancellation(signal);
  const photos: PdfPhoto[] = [];
  let bytesSoFar = 0;
  for (const page of pages) {
    checkPhotoCancellation(signal);
    const photo = await renderPhoto(page, signal);
    checkPhotoCancellation(signal);
    bytesSoFar += photo.jpeg.length;
    checkPhotoBytes(bytesSoFar);
    photos.push(photo);
  }
  const bytes = createPhotoPdf(photos);
  return new File([bytes as Uint8Array<ArrayBuffer>], '作業照片.pdf', { type: 'application/pdf' });
}

export async function validatePhotoPages(pages: PhotoPage[], signal?: AbortSignal) {
  if (!pages.length || pages.length > 8) throw new Error('請選 1–8 張照片。');
  let pixels = 0;
  for (const page of pages) {
    checkPhotoCancellation(signal);
    checkPhotoBytes(page.file.size);
    const dimensions = photoDimensions(
      new Uint8Array(await page.file.slice(0, PHOTO_HEADER_BYTES).arrayBuffer()),
    );
    checkPhotoCancellation(signal);
    pixels = checkPhotoPixels(dimensions.width, dimensions.height, pixels);
  }
}
