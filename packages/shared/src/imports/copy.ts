export const PERSONAL_IMPORT_UNDO_LABEL = '撤銷上次匯入';
export const PERSONAL_IMPORT_UNDO_TITLE = '撤銷上次匯入？';
export const PERSONAL_IMPORT_UNDO_CONFIRM = '撤銷';
export const PERSONAL_IMPORT_UNDO_KEEP = '先不要';

export const PERSONAL_IMPORT_IMAGE_UNREADABLE =
  '這張圖片打不開，可能檔案壞了或格式不支援，請換一張截圖再試。';

export const PERSONAL_IMPORT_SYNCING = '正在同步到你的帳號…';
export const PERSONAL_IMPORT_SYNCED = '已同步到你的帳號，換裝置登入同一個帳號並開啟同步就能看到。';
export const PERSONAL_IMPORT_SYNC_NETWORK_FAILURE = '還沒同步到你的帳號，請確認網路後再試。';
export const PERSONAL_IMPORT_SYNC_CONFLICT = '另一台裝置剛更新資料，請重新同步。';
export const PERSONAL_IMPORT_SYNC_SESSION_EXPIRED =
  '登入狀態已變更，請重新登入後同步；這台裝置的資料仍保留。';

export const PERSONAL_IMPORT_OCR_LANGUAGES = 'chi_tra+eng';
export const PERSONAL_IMPORT_OCR_PUBLIC_DIR = '/ocr';
export const PERSONAL_IMPORT_OCR_SCRIPT = '/ocr/tesseract.min.js';
export const PERSONAL_IMPORT_OCR_WORKER = '/ocr/worker.min.js';
export const PERSONAL_IMPORT_OCR_CORE = '/ocr/tesseract-core-simd-lstm.wasm.js';
export const PERSONAL_IMPORT_OCR_LANG = '/ocr/lang';

export function personalImportUndoBody(count: number): string {
  return `上次匯入的 ${count} 筆會從這台裝置刪掉，你原本的資料不會動。刪掉後沒辦法復原。`;
}

export function personalImportPreviewNotice(count: number): string {
  return `整理出 ${count} 筆，請逐筆核對再匯入。`;
}

export function personalImportSavedNotice(added: number, syncEnabled = false): string {
  return syncEnabled
    ? `已在這台裝置新增 ${added} 筆，原有資料保留。`
    : `已在這台裝置新增 ${added} 筆，原有資料保留。資料只存在這台裝置，換手機或清除資料就會不見。`;
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
