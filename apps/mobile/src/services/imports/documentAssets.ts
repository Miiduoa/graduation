import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { prepareOcrBaseUrl } from '../ocrLocalBase';
import { PersonalImportDocumentError } from '@campus/shared';
let prepared: Promise<string> | null = null;
export function prepareDocumentBaseUrl(): Promise<string> {
  if (!prepared)
    prepared = (async () => {
      const baseUrl = await prepareOcrBaseUrl();
      const asset = Asset.fromModule(require('../../../assets/documents/document-reader.bin'));
      await asset.downloadAsync();
      if (!asset.localUri)
        throw new PersonalImportDocumentError(
          '文件讀取程式未能載入，請重新開啟 App。',
          'unavailable',
        );
      const target = new File(`${baseUrl}document-reader.js`);
      // Refresh after App updates; an old cache must never execute a previous reader.
      if (target.exists) target.delete();
      new File(asset.localUri).copy(target);
      return baseUrl;
    })().catch((error) => {
      prepared = null;
      throw error;
    });
  return prepared;
}
export const DOCUMENT_IMPORT_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self' file:; worker-src 'self' file: blob:; img-src 'self' data: blob:; style-src 'unsafe-inline'"></head><body><script>window.CampusDocumentOcrBase='./';</script><script src="tesseract.min.js"></script><script src="document-reader.js"></script></body></html>`;
