export const PERSONAL_IMPORT_UNDO_LABEL = '撤銷上次匯入';
export const PERSONAL_IMPORT_UNDO_TITLE = '撤銷上次匯入？';
export const PERSONAL_IMPORT_UNDO_CONFIRM = '撤銷';
export const PERSONAL_IMPORT_UNDO_KEEP = '先不要';

export const PERSONAL_IMPORT_IMAGE_UNREADABLE =
  '這張圖片打不開，可能檔案壞了或格式不支援，請換一張截圖再試。';

export const PERSONAL_IMPORT_OCR_LANGUAGES = 'chi_tra+eng';
export const PERSONAL_IMPORT_OCR_PUBLIC_DIR = '/ocr';
export const PERSONAL_IMPORT_OCR_SCRIPT = '/ocr/tesseract.min.js';
export const PERSONAL_IMPORT_OCR_WORKER = '/ocr/worker.min.js';
export const PERSONAL_IMPORT_OCR_CORE = '/ocr/tesseract-core-simd-lstm.wasm.js';
export const PERSONAL_IMPORT_OCR_LANG = '/ocr/lang';

export function personalImportUndoBody(count: number): string {
  return `上次匯入的 ${count} 筆會從這台裝置刪掉，你原本的資料不會動。刪掉後沒辦法復原。`;
}

export function personalImportSavedNotice(added: number): string {
  return `已在這台裝置新增 ${added} 筆，原有資料保留。換裝置或清除資料前，請確認同步成功，或下載完整備份。`;
}

export function personalImportUndoneNotice(removed: number): string {
  return `已撤銷上次匯入的 ${removed} 筆，原本的資料都還在。`;
}

export function isUnreadablePersonalImportImage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /decod|encodingerror|invalidstateerror|corrupt|unrecognized image|imagebitmap|failed to load image|source image|could not be read|invalid image|image format|unsupported image/i.test(
    message,
  );
}

export function personalImportErrorMessage(error: unknown, fallback: string): string {
  if (isUnreadablePersonalImportImage(error)) return PERSONAL_IMPORT_IMAGE_UNREADABLE;
  const message = error instanceof Error ? error.message.trim() : '';
  if (message && /[\u4e00-\u9fff]/.test(message)) return message;
  return fallback;
}
