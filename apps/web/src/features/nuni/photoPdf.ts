import { createPhotoPdf, type PdfPhoto } from '@campus/shared/src/photoPdf';

export type PhotoPage = { key: string; file: File; rotation: number; url: string };

export async function renderPhoto(page: PhotoPage): Promise<PdfPhoto> {
  const image = new Image();
  image.src = page.url;
  await image.decode();
  const sideways = page.rotation % 180 !== 0;
  const canvas = document.createElement('canvas');
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
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function buildPhotoPdf(pages: PhotoPage[]): Promise<File> {
  const photos: PdfPhoto[] = [];
  for (const page of pages) photos.push(await renderPhoto(page));
  const bytes = createPhotoPdf(photos);
  return new File([bytes as Uint8Array<ArrayBuffer>], '作業照片.pdf', { type: 'application/pdf' });
}
