import { readDocumentBytes } from './reader';
import { PersonalImportDocumentError } from '../../packages/shared/src/imports/documents';
const scope = window as typeof window & {
  ReactNativeWebView?: { postMessage: (value: string) => void };
  CampusDocumentOcrBase?: string;
  readCampusDocument?: (id: number, name: string, base64: string) => void;
};
const send = (value: unknown) => {
  if (scope.ReactNativeWebView) scope.ReactNativeWebView.postMessage(JSON.stringify(value));
  else if (parent !== window) parent.postMessage(value, location.origin);
};
let busy = false;
async function run(id: number, name: string, data: Uint8Array) {
  if (busy) return;
  busy = true;
  try {
    const document = await readDocumentBytes(data, name, {
      ocrAssetBase: scope.CampusDocumentOcrBase,
    });
    send({ channel: 'campus-document', id, ok: true, document });
  } catch (error) {
    send({
      channel: 'campus-document',
      id,
      ok: false,
      code: error instanceof PersonalImportDocumentError ? error.code : 'unreadable',
      error:
        error instanceof PersonalImportDocumentError
          ? error.message
          : '檔案讀取失敗，請重新匯出 PDF／XLSX。',
    });
  } finally {
    busy = false;
  }
}
scope.readCampusDocument = (id, name, base64) => {
  try {
    void run(
      id,
      name,
      Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
    );
  } catch {
    send({ channel: 'campus-document', id, ok: false, error: '檔案內容不完整，請重新選擇。' });
  }
};
addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.origin !== location.origin ||
    event.data?.channel !== 'campus-document'
  )
    return;
  const { id, name, bytes } = event.data;
  if (!Number.isSafeInteger(id) || typeof name !== 'string' || !(bytes instanceof ArrayBuffer))
    return;
  void run(id, name, new Uint8Array(bytes));
});
send({ channel: 'campus-document', ready: true });
