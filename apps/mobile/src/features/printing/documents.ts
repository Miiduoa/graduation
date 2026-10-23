import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const DOCUMENT_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'application/msword': 'office',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'office',
} as const;
const EXTENSION_TYPES: Record<string, keyof typeof DOCUMENT_TYPES> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
export type PrintDocument = {
  name: string;
  uri: string;
  size: number | null;
  mimeType: keyof typeof DOCUMENT_TYPES;
  kind: 'pdf' | 'image' | 'office';
  browserFile?: globalThis.File;
};
export class DocumentOperationError extends Error {}

function ensureSize(size: number | undefined | null) {
  if (size != null && (!Number.isFinite(size) || size < 0 || size > MAX_DOCUMENT_BYTES)) {
    throw new DocumentOperationError('檔案大小超過 25 MB，請先壓縮檔案或分成較小的文件。');
  }
}

export async function pickPrintDocument(): Promise<PrintDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: Object.keys(DOCUMENT_TYPES),
    copyToCacheDirectory: true,
    multiple: false,
    base64: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const reportedType = asset.mimeType?.toLowerCase();
  const mimeType =
    reportedType && reportedType !== 'application/octet-stream'
      ? reportedType
      : EXTENSION_TYPES[asset.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!mimeType || !Object.prototype.hasOwnProperty.call(DOCUMENT_TYPES, mimeType)) {
    throw new DocumentOperationError('請選擇 PDF、PNG、JPEG 或 Word 文件。');
  }
  if (
    Platform.OS === 'web'
      ? !asset.file || !asset.uri.startsWith('blob:')
      : !/^(file|content):\/\//.test(asset.uri)
  ) {
    throw new DocumentOperationError('無法讀取這個檔案，請重新從裝置選取。');
  }
  ensureSize(asset.size ?? asset.file?.size);
  const type = mimeType as keyof typeof DOCUMENT_TYPES;
  return {
    name: asset.name,
    uri: asset.uri,
    size: asset.size ?? asset.file?.size ?? null,
    mimeType: type,
    kind: DOCUMENT_TYPES[type],
    browserFile: asset.file,
  };
}

function localFile(document: PrintDocument) {
  const file = new File(document.uri);
  if (!file.exists) throw new DocumentOperationError('找不到所選文件，請重新選取檔案。');
  ensureSize(file.size);
  return file;
}

export function isDocumentActionCancelled(error: unknown): boolean {
  const record = error as { code?: string; name?: string } | null;
  return (
    record?.name === 'AbortError' ||
    record?.code === 'ERR_PRINT_INCOMPLETE' ||
    record?.code === 'ERR_PRINT_CANCELLED' ||
    record?.code === 'ERR_CANCELED'
  );
}

export async function previewAndPrintDocument(document: PrintDocument, isCurrent: () => boolean) {
  if (!isCurrent()) return;
  if (document.kind === 'office') {
    throw new DocumentOperationError('Word 文件請先用其他 App 開啟，或轉成 PDF 後列印。');
  }
  if (Platform.OS === 'web') {
    if (!document.browserFile) throw new DocumentOperationError('請重新選取要預覽的文件。');
    // expo-print on web prints the app page, so open only the selected file instead.
    const blob = new Blob([document.browserFile], { type: document.mimeType });
    const url = URL.createObjectURL(blob);
    const preview = window.open(url, '_blank');
    if (!preview) {
      URL.revokeObjectURL(url);
      throw new DocumentOperationError('瀏覽器阻擋了文件預覽，請允許開啟新分頁後再試。');
    }
    preview.opener = null;
    // Keep the URL alive for the browser's PDF viewer and print controls.
    return;
  }
  const file = localFile(document);
  if (document.kind === 'pdf') {
    await Print.printAsync({ uri: file.uri });
    return;
  }
  const base64 = await file.base64();
  if (!isCurrent()) return;
  await Print.printAsync({
    html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>@page { margin: 12mm; } body { margin: 0; } img { display: block; max-width: 100%; max-height: 95vh; object-fit: contain; margin: auto; }</style></head><body><img src="data:${document.mimeType};base64,${base64}" alt=""></body></html>`,
  });
}

export async function sharePrintDocument(document: PrintDocument, isCurrent: () => boolean) {
  if (!isCurrent()) return;
  if (Platform.OS === 'web') {
    if (!document.browserFile || !navigator.canShare?.({ files: [document.browserFile] })) {
      throw new DocumentOperationError('此瀏覽器無法分享檔案，請使用「儲存檔案」後自行傳送。');
    }
    await navigator.share({ files: [document.browserFile], title: document.name });
    return;
  }
  const available = await Sharing.isAvailableAsync();
  if (!isCurrent()) return;
  if (!available) throw new DocumentOperationError('此裝置目前無法分享檔案。');
  const file = localFile(document);
  await Sharing.shareAsync(file.uri, {
    mimeType: document.mimeType,
    dialogTitle: '選擇開啟或分享文件的 App',
  });
}

export function savePrintDocument(document: PrintDocument) {
  if (Platform.OS !== 'web' || !document.browserFile) return;
  const blob = new Blob([document.browserFile], { type: document.mimeType });
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = document.name;
  globalThis.document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function documentSizeLabel(size: number | null): string {
  if (size === null) return '大小未提供';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
