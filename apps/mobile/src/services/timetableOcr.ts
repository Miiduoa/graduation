import { File } from 'expo-file-system';
import {
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  PERSONAL_IMPORT_OCR_LANGUAGES,
  isUnreadablePersonalImportImage,
  personalImportErrorMessage,
} from '@campus/shared';

export const IMPORT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMPORT_IMAGE_MAX_PIXELS = 20_000_000;
export class TimetableOcrError extends Error {
  constructor(
    message: string,
    readonly kind: 'unavailable' | 'empty' | 'network' | 'cancelled' = 'unavailable',
  ) {
    super(message);
  }
}
export async function readImageBase64(uri: string): Promise<string> {
  const file = new File(uri);
  if (file.size > IMPORT_IMAGE_MAX_BYTES)
    throw new TimetableOcrError('圖片超過 8 MB，請裁切後再試。');
  return file.base64();
}

export const TIMETABLE_OCR_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body><script src="tesseract.min.js"></script><script src="ruled-timetable-grid.js"></script><script>
let current = null;
function send(payload) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload)); }
function imageError(error) {
  var message = String(error && error.message ? error.message : error || '');
  if (/decod|encodingerror|invalidstateerror|corrupt|unrecognized image|imagebitmap|failed to load image|source image|could not be read|invalid image|image format|unsupported image/i.test(message))
    return ${JSON.stringify(PERSONAL_IMPORT_IMAGE_UNREADABLE)};
  if (/[\\u4e00-\\u9fff]/.test(message)) return message;
  return ${JSON.stringify(PERSONAL_IMPORT_IMAGE_UNREADABLE)};
}
window.cancelTimetable = function(id) {
  if (!current || current.id !== id) return;
  current.cancelled = true;
  if (current.worker) current.worker.terminate();
  current = null;
};
async function readRuledGrid(uri, tsv, job) {
  if (!window.TimetableGrid || !tsv || tsv.length > 256000) return null;
  const canvas = document.createElement('canvas');
  try {
    const image = new Image();
    image.src = uri;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (job.cancelled || width < 48 || height < 48 || width > 4096 || height > 4096 || width * height > 4000000) return null;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    return window.TimetableGrid.recognizeRuledTimetableGrid(ctx.getImageData(0, 0, width, height), tsv);
  } catch {
    return null;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
window.recognizeTimetable = async function(id, base64, mime, readGrid) {
  if (current) window.cancelTimetable(current.id);
  const job = { id: id, worker: null, cancelled: false }; current = job;
  try {
    if (!window.Tesseract) throw new Error('辨識程式未能載入');
    const worker = await window.Tesseract.createWorker(${JSON.stringify(PERSONAL_IMPORT_OCR_LANGUAGES)}, 1, {
      workerPath: 'worker.min.js',
      corePath: 'tesseract-core-simd-lstm.wasm.js',
      langPath: 'lang',
      workerBlobURL: false
    });
    job.worker = worker;
    if (job.cancelled) { await worker.terminate(); return; }
    await worker.setParameters({ preserve_interword_spaces: '1' });
    if (job.cancelled) return;
    const uri = 'data:' + mime + ';base64,' + base64;
    const checkGrid = readGrid && mime === 'image/png';
    const result = checkGrid ? await worker.recognize(uri, {}, { text: true, tsv: true }) : await worker.recognize(uri);
    const text = result.data.text || '';
    const grid = checkGrid && !job.cancelled && text.length <= 40000 && /(?:星期|週|周)[一二三四五六日天]/u.test(text)
      ? await readRuledGrid(uri, result.data.tsv, job) : null;
    if (!job.cancelled) send({ id: id, ok: true, text: text, grid: grid });
  } catch (error) {
    if (!job.cancelled) send({ id: id, ok: false, error: imageError(error) });
  } finally {
    if (job.worker && !job.cancelled) await job.worker.terminate();
    if (current === job) current = null;
  }
};
send({ ready: true });
</script></body></html>`;

export function timetableOcrFailure(error: unknown): TimetableOcrError {
  if (error instanceof TimetableOcrError) return error;
  return new TimetableOcrError(
    personalImportErrorMessage(error, PERSONAL_IMPORT_IMAGE_UNREADABLE),
    isUnreadablePersonalImportImage(error) ? 'unavailable' : 'unavailable',
  );
}
