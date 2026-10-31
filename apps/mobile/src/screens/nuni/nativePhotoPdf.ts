import { File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { createPhotoPdf, type PdfPhoto } from '@campus/shared/src/photoPdf';
import type { LocalNativeFile } from './assignmentFileSubmit';

export type NativePhotoPage = { file: LocalNativeFile; rotation: number };

export async function buildNativePhotoPdf(pages: NativePhotoPage[]) {
  const temporary: File[] = [];
  try {
    const photos: PdfPhoto[] = [];
    const previews: string[] = [];
    for (const page of pages) {
      const image = await ImageManipulator.manipulateAsync(
        page.file.uri,
        [{ rotate: page.rotation }],
        { compress: 0.94, format: ImageManipulator.SaveFormat.JPEG },
      );
      const file = new File(image.uri);
      temporary.push(file);
      previews.push(image.uri);
      photos.push({
        jpeg: new Uint8Array(await file.arrayBuffer()),
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
