import {
  PERSONAL_IMPORT_DOCUMENT_LIMITS,
  PersonalImportDocumentError,
  validatePersonalImportDocument,
  validatePersonalImportDocumentFile,
  type PersonalImportDocument,
} from '@campus/shared';
type Job = {
  id: number;
  name: string;
  base64: string;
  resolve: (document: PersonalImportDocument) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
};
/** Job identity and host reset prevent a cancelled document from replacing a newer draft. */
export class DocumentCoordinator {
  private sequence = 0;
  private ready = false;
  private pending: Job | null = null;
  constructor(
    private inject: (script: string) => void,
    private restart: () => void,
  ) {}
  read(name: string, base64: string, signal?: AbortSignal): Promise<PersonalImportDocument> {
    this.cancel();
    if (signal?.aborted)
      return Promise.reject(new PersonalImportDocumentError('已取消讀取。', 'cancelled'));
    try {
      validatePersonalImportDocumentFile(
        name,
        Math.floor(base64.length * 0.75) -
          (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0),
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const abort = () => {
        if (this.pending?.id === id) this.cancel();
      };
      const timer = setTimeout(
        () =>
          this.fail(
            new PersonalImportDocumentError(
              '讀取逾時，請拆成較小的檔案或單頁截圖後再試。',
              'timeout',
            ),
          ),
        PERSONAL_IMPORT_DOCUMENT_LIMITS.timeoutMs,
      );
      this.pending = {
        id,
        name,
        base64,
        resolve,
        reject,
        timer,
        cleanup: () => signal?.removeEventListener('abort', abort),
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (this.ready) this.start();
    });
  }
  private start() {
    const job = this.pending;
    if (job)
      this.inject(
        `window.readCampusDocument(${job.id},${JSON.stringify(job.name)},${JSON.stringify(job.base64)}); true;`,
      );
  }
  message(raw: string) {
    if (raw.length > 4_000_000)
      return this.fail(new PersonalImportDocumentError('檔案內容太多，請拆分後再試。', 'limit'));
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    if (!value || value.channel !== 'campus-document') return;
    if (value.ready) {
      if (!this.ready) {
        this.ready = true;
        this.start();
      }
      return;
    }
    const job = this.pending;
    if (!job || value.id !== job.id) return;
    try {
      if (!value.ok)
        throw new PersonalImportDocumentError(
          typeof value.error === 'string' && value.error.length <= 300
            ? value.error
            : '檔案讀取失敗，請重新匯出。',
          typeof value.code === 'string' ? value.code : 'unreadable',
        );
      const document = validatePersonalImportDocument(value.document);
      if (document.name !== job.name)
        throw new PersonalImportDocumentError('檔案讀取結果不符，請重新選擇。');
      this.clear();
      job.resolve(document);
    } catch (error) {
      this.fail(error);
    }
  }
  private clear() {
    const job = this.pending;
    this.pending = null;
    if (!job) return;
    clearTimeout(job.timer);
    job.cleanup();
    this.ready = false;
    this.restart();
  }
  fail(error: unknown) {
    const job = this.pending;
    this.clear();
    job?.reject(error);
  }
  cancel() {
    this.fail(new PersonalImportDocumentError('已取消讀取。', 'cancelled'));
  }
  reset() {
    this.cancel();
    this.ready = false;
  }
}
