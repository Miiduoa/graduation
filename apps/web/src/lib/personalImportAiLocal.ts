'use client';

import {
  buildPersonalImportAiPrompt,
  parsePersonalImportAiResponse,
  type PersonalImportAiResult,
} from '@campus/shared/src/imports/aiRecognition';
import type { PersonalImportOptions } from '@campus/shared/src/imports/types';
import {
  auditPersonalImportAiTable,
  personalImportAiTableAuditMessage,
  personalImportAiTableCoverageNotice,
} from '@campus/shared/src/imports/aiTableAudit';
import { IMPORT_AI_CACHE_NAME, IMPORT_AI_DOWNLOAD_LABEL } from './personalImportAiConfig';

export type PersonalImportAiRequest = {
  input: { text?: string; image?: File };
  options: PersonalImportOptions;
  signal: AbortSignal;
  onProgress: (message: string) => void;
  columnContext?: string;
  workerSession?: { worker?: Worker };
};

export function getPersonalImportAiAvailability(): {
  available: boolean;
  reason?: string;
  downloadLabel: string;
} {
  const downloadLabel = IMPORT_AI_DOWNLOAD_LABEL;
  if (
    typeof window === 'undefined' ||
    typeof Worker === 'undefined' ||
    typeof navigator === 'undefined' ||
    !(navigator as Navigator & { gpu?: unknown }).gpu ||
    window.isSecureContext === false
  ) {
    return {
      available: false,
      downloadLabel,
      reason:
        '這個瀏覽器尚未提供裝置端 AI 所需的圖形加速。可先從學校複製表格、讀取檔案，或使用支援 WebGPU 的瀏覽器。',
    };
  }
  return { available: true, downloadLabel };
}

let sequence = 0;
let running = false;
let deletingCache = false;
const abortError = () => new DOMException('已停止這次 AI 辨識，原有草稿仍保留。', 'AbortError');

export async function deletePersonalImportAiModelCache(): Promise<void> {
  if (running) throw new Error('AI 正在辨識，請先停止或等辨識完成後再移除模型。');
  if (deletingCache) throw new Error('正在移除模型快取，請稍候。');
  if (typeof caches === 'undefined')
    throw new Error('此瀏覽器無法管理模型快取，請從瀏覽器設定清除本站資料。');
  deletingCache = true;
  try {
    await caches.delete(IMPORT_AI_CACHE_NAME);
    if (await caches.has(IMPORT_AI_CACHE_NAME)) throw new Error('cache still exists');
  } catch {
    throw new Error('模型快取尚未完全移除，請重試或從瀏覽器設定清除本站資料。');
  } finally {
    deletingCache = false;
  }
}

/** An isolated worker owns every download and inference; terminating it cancels actual work. */
export async function runLocalPersonalImportAi({
  input,
  options,
  signal,
  onProgress,
  columnContext,
  workerSession,
}: PersonalImportAiRequest): Promise<PersonalImportAiResult> {
  if (signal.aborted) throw abortError();
  if (deletingCache) throw new Error('正在移除模型快取，請完成後再辨識。');
  if (running) throw new Error('另一份資料正在使用裝置端 AI，請等完成後再試。');
  const availability = getPersonalImportAiAvailability();
  if (!availability.available) throw new Error(availability.reason);
  if (input.image && !['image/png', 'image/jpeg', 'image/webp'].includes(input.image.type))
    throw new Error('AI 圖片辨識支援 PNG、JPEG 或 WebP，請先將其他格式轉成圖片。');
  if (input.image && input.image.size > 10 * 1024 * 1024)
    throw new Error('圖片超過 10 MB，請裁切到需要的課表或表格後再試。');
  const mode = input.image ? 'image' : 'text';
  const source = mode === 'image' ? '' : (input.text ?? '');
  const prompt = [
    buildPersonalImportAiPrompt(source, options, mode),
    ...(columnContext
      ? [
          '下方只是欄位解讀參考，不是待匯入紀錄。只輸出 SOURCE_DATA 中的資料。',
          `COLUMN_CONTEXT_DATA=${JSON.stringify(columnContext)}`,
        ]
      : []),
  ].join('\n');
  const snapshot: PersonalImportOptions = {
    ...options,
    source: options.source ? { ...options.source } : undefined,
  };
  running = true;
  let worker: Worker | undefined;
  try {
    worker =
      workerSession?.worker ??
      new Worker(new URL('./personalImportAi.worker.ts', import.meta.url), {
        type: 'module',
      });
    if (workerSession) workerSession.worker = worker;
    const currentWorker = worker;
    const id = ++sequence;
    const raw = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: string, reusable = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        currentWorker.onmessage = null;
        currentWorker.onerror = null;
        currentWorker.onmessageerror = null;
        if (!workerSession || (error && !reusable)) {
          currentWorker.terminate();
          if (workerSession) workerSession.worker = undefined;
        }
        if (error) reject(error);
        else resolve(value!);
      };
      const abort = () => finish(abortError());
      let timer = setTimeout(
        () => finish(new Error('AI 準備或辨識逾時，已停止工作。請確認網路、縮小來源後重試。')),
        workerSession ? 180_000 : 10 * 60_000,
      );
      currentWorker.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data;
        if (
          !message ||
          typeof message !== 'object' ||
          !('id' in message) ||
          message.id !== id ||
          signal.aborted
        )
          return;
        const data = message as {
          type?: string;
          message?: unknown;
          raw?: unknown;
          code?: string;
          phase?: string;
        };
        if (data.type === 'progress' && typeof data.message === 'string') {
          if (workerSession && data.phase === 'generating') {
            clearTimeout(timer);
            timer = setTimeout(
              () => finish(new Error('這一段本機整理逾時，已停止並保留其他段落。')),
              120_000,
            );
          }
          onProgress(data.message);
        } else if (data.type === 'result' && typeof data.raw === 'string')
          finish(undefined, data.raw);
        else if (data.type === 'error')
          finish(
            new Error(
              typeof data.message === 'string'
                ? data.message
                : '裝置端 AI 無法完成辨識，請縮小來源後重試。',
            ),
            undefined,
            data.code === 'output_limit' || data.code === 'input_limit',
          );
      };
      currentWorker.onerror = () =>
        finish(
          new Error(
            '裝置端 AI 啟動失敗，可能是圖形加速或記憶體不足。請關閉其他分頁後重試，或改用表格匯入。',
          ),
        );
      currentWorker.onmessageerror = () =>
        finish(new Error('AI 辨識結果無法讀取，原有草稿仍保留。'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      onProgress('正在準備裝置端 AI；首次使用會下載模型，資料不會上傳。');
      try {
        currentWorker.postMessage({
          type: 'recognize',
          id,
          prompt,
          ...(workerSession ? { keepAlive: true } : {}),
          ...(input.image ? { image: input.image } : {}),
        });
      } catch {
        finish(new Error('無法交付這份資料給裝置端 AI，請重新選擇檔案。'));
      }
    });
    if (signal.aborted) throw abortError();
    const parsed = parsePersonalImportAiResponse(raw, source, snapshot, mode);
    if (mode === 'image') return parsed; // Generated transcription is not an independent source.
    onProgress('正在逐列對照原始表格，檢查漏列與欄位配對。');
    if (signal.aborted) throw abortError();
    const audit = auditPersonalImportAiTable(
      source,
      parsed.rows,
      snapshot.kind,
      columnContext ?? '',
      snapshot.periodProfile,
    );
    if (audit.status === 'mismatch') throw new Error(personalImportAiTableAuditMessage(audit));
    if (audit.status === 'matched') {
      return {
        ...parsed,
        issues: [...parsed.issues, personalImportAiTableCoverageNotice(audit.expectedRecords)],
        rows: parsed.rows.map((row) => ({
          ...row,
          source: { ...row.source, line: audit.sourceLines[row.id] ?? row.source.line },
        })),
      };
    }
    return parsed;
  } finally {
    if (!workerSession) worker?.terminate();
    running = false;
  }
}
