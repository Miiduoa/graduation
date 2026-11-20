import {
  PERSONAL_IMPORT_DOCUMENT_LIMITS,
  PersonalImportDocumentError,
  validatePersonalImportDocumentFile,
  validatePersonalImportDocument,
  type PersonalImportDocument,
  type PersonalImportDocumentReadOptions,
} from '@campus/shared';

/** File bytes stay in a disposable, same-origin reader. No document is uploaded. */
export async function readPersonalImportDocumentFile(
  file: File,
  signal?: AbortSignal,
  options: PersonalImportDocumentReadOptions = {},
): Promise<PersonalImportDocument> {
  validatePersonalImportDocumentFile(file.name, file.size);
  if (signal?.aborted) throw new PersonalImportDocumentError('已取消讀取。', 'cancelled');
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    iframe.title = '本機文件讀取';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = '/documents/reader.html';
    const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    let settled = false;
    let started = false;
    const finish = (error?: unknown, value?: PersonalImportDocument) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', message);
      signal?.removeEventListener('abort', abort);
      iframe.remove();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(new PersonalImportDocumentError('已取消讀取。', 'cancelled'));
    const message = (event: MessageEvent) => {
      if (
        event.source !== iframe.contentWindow ||
        event.origin !== window.location.origin ||
        event.data?.channel !== 'campus-document'
      )
        return;
      const data = event.data;
      if (data.ready && !started) {
        started = true;
        void file
          .arrayBuffer()
          .then((bytes) => {
            if (!settled)
              iframe.contentWindow?.postMessage(
                {
                  channel: 'campus-document',
                  id,
                  name: file.name,
                  bytes,
                  pdfMode: options.pdfMode,
                },
                window.location.origin,
                [bytes],
              );
          })
          .catch(() => finish(new PersonalImportDocumentError('檔案無法讀取，請重新選擇。')));
      } else if (data.id === id) {
        try {
          if (!data.ok)
            throw new PersonalImportDocumentError(
              typeof data.error === 'string' && data.error.length <= 300
                ? data.error
                : '檔案讀取失敗，請重新匯出。',
              typeof data.code === 'string' ? data.code : 'unreadable',
            );
          const document = validatePersonalImportDocument(data.document);
          if (document.name !== file.name)
            throw new PersonalImportDocumentError('檔案讀取結果不符，請重新選擇。');
          finish(undefined, document);
        } catch (error) {
          finish(error);
        }
      }
    };
    const timer = setTimeout(
      () =>
        finish(
          new PersonalImportDocumentError(
            '讀取逾時，請拆成較小的檔案或單頁截圖後再試。',
            'timeout',
          ),
        ),
      PERSONAL_IMPORT_DOCUMENT_LIMITS.timeoutMs,
    );
    window.addEventListener('message', message);
    signal?.addEventListener('abort', abort, { once: true });
    iframe.onerror = () =>
      finish(
        new PersonalImportDocumentError('文件讀取程式未能載入，請重新整理後再試。', 'unavailable'),
      );
    document.body.appendChild(iframe);
  });
}
