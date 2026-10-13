import { File } from 'expo-file-system';

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
<body><script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script><script>
let current = null;
function send(payload) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload)); }
window.cancelTimetable = function(id) {
  if (!current || current.id !== id) return;
  current.cancelled = true;
  if (current.worker) current.worker.terminate();
  current = null;
};
window.recognizeTimetable = async function(id, base64, mime) {
  if (current) window.cancelTimetable(current.id);
  const job = { id: id, worker: null, cancelled: false }; current = job;
  try {
    if (!window.Tesseract) throw new Error('辨識程式未能載入');
    const worker = await window.Tesseract.createWorker('chi_tra+eng');
    job.worker = worker;
    if (job.cancelled) { await worker.terminate(); return; }
    await worker.setParameters({ preserve_interword_spaces: '1' });
    if (job.cancelled) return;
    const result = await worker.recognize('data:' + mime + ';base64,' + base64);
    if (!job.cancelled) send({ id: id, ok: true, text: result.data.text || '' });
  } catch (error) {
    if (!job.cancelled) send({ id: id, ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    if (job.worker && !job.cancelled) await job.worker.terminate();
    if (current === job) current = null;
  }
};
send({ ready: true });
</script></body></html>`;
