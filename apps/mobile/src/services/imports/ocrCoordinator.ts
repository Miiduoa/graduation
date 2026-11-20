import { isPersonalImportCloudMaskSafe } from '@campus/shared/src/imports/aiCloud';
import { TimetableOcrError, IMPORT_IMAGE_MAX_BYTES } from '../timetableOcr';

type Job = {
  id: number;
  base64: string;
  mime: string;
  readGrid: boolean;
  resolve: (value: string) => void;
  reject: (error: TimetableOcrError) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
};

/** One mounted host owns one queue; a stale WebView message can never complete a newer request. */
export class OcrCoordinator {
  private sequence = 0;
  private ready = false;
  private pending: Job | null = null;
  constructor(private inject: (script: string) => void) {}
  recognize(
    base64: string,
    mime: 'image/png' | 'image/jpeg',
    signal?: AbortSignal,
    readGrid = false,
  ): Promise<string> {
    this.cancel();
    if (signal?.aborted) return Promise.reject(new TimetableOcrError('已取消辨識。', 'cancelled'));
    if (base64.length * 0.75 > IMPORT_IMAGE_MAX_BYTES + 2)
      return Promise.reject(new TimetableOcrError('圖片超過 8 MB，請裁切後再試。'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const abort = () => {
        if (this.pending?.id === id) this.cancel();
      };
      const timer = setTimeout(() => {
        if (this.pending?.id === id)
          this.fail(new TimetableOcrError('辨識逾時，請裁切圖片或改貼文字。', 'network'));
      }, 90_000);
      this.pending = {
        id,
        base64,
        mime,
        readGrid: readGrid && mime === 'image/png',
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
        `window.recognizeTimetable(${job.id},${JSON.stringify(job.base64)},${JSON.stringify(job.mime)},${job.readGrid}); true;`,
      );
  }
  message(raw: string) {
    let value: { ready?: boolean; id?: number; ok?: boolean; text?: unknown; grid?: unknown; error?: unknown };
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    if (value.ready) {
      if (!this.ready) {
        this.ready = true;
        this.start();
      }
      return;
    }
    const job = this.pending;
    if (!job || value.id !== job.id) return;
    this.pending = null;
    clearTimeout(job.timer);
    job.cleanup();
    if (value.ok && typeof value.text === 'string') {
      // Keep the masking decision attached to the complete original, before selecting cells.
      const grid = value.grid;
      job.resolve(
        job.readGrid && typeof grid === 'string' && grid.length > 0 && grid.length <= 40_000 &&
        value.text.length <= 40_000 && value.text.trim().length > 0 && isPersonalImportCloudMaskSafe(value.text)
          ? grid
          : value.text,
      );
    } else {
      const message =
        typeof value.error === 'string' && /[\u4e00-\u9fff]/.test(value.error)
          ? value.error
          : '這次辨識失敗，請改貼文字。';
      job.reject(new TimetableOcrError(message, 'unavailable'));
    }
  }
  fail(error: TimetableOcrError) {
    const job = this.pending;
    this.pending = null;
    if (!job) return;
    this.inject(`window.cancelTimetable && window.cancelTimetable(${job.id}); true;`);
    clearTimeout(job.timer);
    job.cleanup();
    job.reject(error);
  }
  cancel() {
    this.fail(new TimetableOcrError('已取消辨識。', 'cancelled'));
  }
  reset() {
    this.cancel();
    this.ready = false;
  }
}
