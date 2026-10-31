import { Image } from 'react-native';
import { File, Paths } from 'expo-file-system';
import {
  checkPhotoBytes,
  checkPhotoCancellation,
  checkPhotoPixels,
  photoDimensions,
  photoRenderSize,
  PHOTO_HEADER_BYTES,
} from '@campus/shared/src/photoPdfBudget';

import { createPhotoPdf, type PdfPhoto } from '@campus/shared/src/photoPdf';
import type { LocalNativeFile } from './assignmentFileSubmit';

export function photoPdfAvailable() {
  try {
    return Boolean(require('expo-image-manipulator').manipulateAsync);
  } catch {
    return false;
  }
}

export type NativePhotoPage = { file: LocalNativeFile; rotation: number };

export async function buildNativePhotoPdf(pages: NativePhotoPage[], signal?: AbortSignal) {
  checkPhotoCancellation(signal);
  if (!photoPdfAvailable()) throw new Error('此版本尚未支援照片轉 PDF，請更新應用程式。');
  const ImageManipulator: typeof import('expo-image-manipulator') = require('expo-image-manipulator');
  const dimensions = await validateNativePhotoPages(pages, signal);
  checkPhotoCancellation(signal);
  const temporary: File[] = [];
  try {
    const photos: PdfPhoto[] = [];
    const previews: string[] = [];
    let bytesSoFar = 0;
    for (const [index, page] of pages.entries()) {
      checkPhotoCancellation(signal);
      const source = dimensions[index];
      let target = photoRenderSize(source.width, source.height);
      const resize = target.width !== source.width || target.height !== source.height;
      if (resize) {
        // Read display orientation only after every source has passed the budget.
        const displayed = await new Promise<{ width: number; height: number }>((resolve, reject) =>
          Image.getSize(page.file.uri, (width, height) => resolve({ width, height }), reject),
        );
        checkPhotoCancellation(signal);
        target = photoRenderSize(displayed.width, displayed.height);
      }
      const image = await ImageManipulator.manipulateAsync(
        page.file.uri,
        [...(resize ? [{ resize: target }] : []), { rotate: page.rotation }],
        { compress: 0.94, format: ImageManipulator.SaveFormat.JPEG },
      );
      const file = new File(image.uri);
      temporary.push(file);
      checkPhotoCancellation(signal);
      checkPhotoPixels(image.width, image.height);
      checkPhotoBytes(file.size + bytesSoFar);
      previews.push(image.uri);
      const jpeg = new Uint8Array(await file.arrayBuffer());
      checkPhotoCancellation(signal);
      bytesSoFar += jpeg.length;
      checkPhotoBytes(bytesSoFar);
      photos.push({
        jpeg,
        width: image.width,
        height: image.height,
      });
    }
    const bytes = createPhotoPdf(photos);
    const output = new File(
      Paths.cache,
      `assignment-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
    );
    temporary.push(output);
    output.write(bytes);
    const file: LocalNativeFile = {
      key: output.uri,
      uri: output.uri,
      name: '作業照片.pdf',
      contentType: 'application/pdf',
      byteSize: bytes.length,
      kind: 'file',
    };
    return {
      file,
      previews,
      dispose: (keepPdf = false) => {
        for (const item of temporary)
          if ((!keepPdf || item.uri !== output.uri) && item.exists) item.delete();
      },
    };
  } catch (error) {
    for (const file of temporary) if (file.exists) file.delete();
    throw error;
  }
}

export async function validateNativePhotoPages(pages: NativePhotoPage[], signal?: AbortSignal) {
  if (!pages.length || pages.length > 8) throw new Error('請選 1–8 張照片。');
  let pixels = 0;
  const sizes: { width: number; height: number }[] = [];
  for (const page of pages) {
    checkPhotoCancellation(signal);
    const source = new File(page.file.uri);
    checkPhotoBytes(source.size);
    const dimensions = photoDimensions(
      new Uint8Array(await source.slice(0, PHOTO_HEADER_BYTES).arrayBuffer()),
    );
    checkPhotoCancellation(signal);
    pixels = checkPhotoPixels(dimensions.width, dimensions.height, pixels);
    sizes.push(dimensions);
  }
  return sizes;
}
