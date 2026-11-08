'use client';

import { getPersonalImportAiAvailability } from './personalImportAiLocal';
import type { PersonalImportAiWorkerRequest } from './personalImportAiConfig';
import {
  buildStudyTutorPrompt,
  parseTutorExplanation,
  type StudyMode,
  type StudyPassage,
  type StudyTutorHistory,
  type TutorExplanation,
} from './studyTutor';

export const STUDY_TUTOR_TIMEOUT_MS = 10 * 60_000;
export const STUDY_TUTOR_GENERATION_TIMEOUT_MS = 120_000;

export function getStudyTutorAvailability(): {
  available: boolean;
  reason?: string;
  downloadLabel: string;
} {
  const availability = getPersonalImportAiAvailability();
  return availability.available ? availability : {
    ...availability,
    reason: '這個瀏覽器目前無法執行裝置端 AI。仍可閱讀原文與自行複習，或改用支援 WebGPU 的瀏覽器開啟講解。',
  };
}

/** Browser-observed wall time for one local worker run. No cold/warm or quality inference. */
export type StudyTutorTiming = {
  preparationMs: number;
  generationMs: number | null;
  totalMs: number;
  outcome: 'success' | 'failed' | 'cancelled';
};

export type StudyTutorRequest = {
  passage: StudyPassage;
  mode: StudyMode;
  question?: string;
  history?: StudyTutorHistory;
  signal: AbortSignal;
  onProgress?: (message: string) => void;
  onTiming?: (timing: StudyTutorTiming) => void;
};

let sequence = 0;
let running = false;

function aborted() {
  return new DOMException('已停止這次講解，原文仍保留。', 'AbortError');
}

function workerError(code: unknown): Error {
  const messages: Record<string, string> = {
    unsupported: '這台裝置無法執行講解模型，仍可使用白板閱讀原文。',
    input_limit: '原文與追問超過模型能處理的範圍，請縮短提問，或不帶追問紀錄重新講解。',
    output_limit: '這次講解沒有完整產生，請重試或縮小問題範圍。',
    memory: '裝置記憶體不足，講解已停止。請關閉其他分頁後重試，或先閱讀原文。',
    download: '講解模型尚未下載完成，請確認網路後重試。教材內容仍在本機。',
    runtime: '裝置端 AI 暫時無法啟動，請稍後重試；原文仍可閱讀。',
    busy: '上一段講解仍在處理，請等候完成或先停止。',
    invalid_response: '這次講解無法對照原文，請重試。',
  };
  return new Error(typeof code === 'string' && Object.hasOwn(messages, code)
    ? messages[code] : messages.invalid_response);
}

function progressMessage(message: unknown, phase: unknown): string {
  if (phase === 'generating') return '正在依本段原文準備講解與自我檢查題…';
  const download = typeof message === 'string' && message.length <= 300
    ? /已接收 (\d{1,6}) MB/.exec(message) : null;
  return download ? `正在下載講解模型（已接收 ${download[1]} MB）`
    : '正在準備裝置端 AI；已下載的模型會使用本機快取。';
}

/** Only an explicit call starts a worker. Closing the session cancels actual GPU work. */
export async function runStudyTutor({
  passage,
  mode,
  question,
  history,
  signal,
  onProgress,
  onTiming,
}: StudyTutorRequest): Promise<TutorExplanation> {
  if (signal.aborted) throw aborted();
  // Snapshot the source before awaiting the worker so a later selection cannot change validation.
  const source = { ...passage };
  const prompt = buildStudyTutorPrompt(source, mode, question, history);
  if (running) throw new Error('另一段講解正在進行，請先停止或等完成後再試。');
  const availability = getStudyTutorAvailability();
  if (!availability.available) throw new Error(availability.reason);
  running = true;
  try {
    const startedAt = performance.now();
    const reportTiming = (generationStartedAt: number | null, outcome: StudyTutorTiming['outcome']) => {
      const endedAt = performance.now();
      try {
        onTiming?.({
          preparationMs: Math.max(0, (generationStartedAt ?? endedAt) - startedAt),
          generationMs: generationStartedAt === null ? null : Math.max(0, endedAt - generationStartedAt),
          totalMs: Math.max(0, endedAt - startedAt),
          outcome,
        });
      } catch {
        // A timing display failure must never replace the worker outcome.
      }
    };
    let worker: Worker;
    try {
      worker = new Worker(new URL('./personalImportAi.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      // A constructor failure occurs before the Promise and would otherwise skip timing.
      reportTiming(null, 'failed');
      throw new Error('無法啟動裝置端 AI，請重新整理後再試；原文仍可閱讀。');
    }
    return await new Promise<TutorExplanation>((resolve, reject) => {
      const id = ++sequence;
      let settled = false;
      let generating = false;
      let generationStartedAt: number | null = null;
      const finish = (error?: Error, explanation?: TutorExplanation) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        try {
          worker.terminate();
        } catch {
          // Some browsers throw after a worker crash. Still release the UI and settle the request.
        }
        reportTiming(generationStartedAt, error?.name === 'AbortError' ? 'cancelled' : error ? 'failed' : 'success');
        if (error) reject(error);
        else resolve(explanation!);
      };
      const abort = () => finish(aborted());
      const report = (message: string) => {
        try {
          onProgress?.(message);
        } catch {
          finish(new Error('白板無法更新講解進度，工作已停止。請重試。'));
        }
      };
      let timer = setTimeout(
        () => finish(new Error('模型準備逾時，下載與講解已停止。請確認網路後重試。')),
        STUDY_TUTOR_TIMEOUT_MS,
      );
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled || signal.aborted) return;
        const value = event.data;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          // This dedicated worker must send an object envelope. Waiting for the
          // preparation timeout would leave the student stuck for ten minutes.
          finish(workerError('invalid_response'));
          return;
        }
        const data = value as Record<string, unknown>;
        if (data.id !== id) {
          // An old numeric request may finish late. Ignore it, but fail fast
          // if the worker omitted or corrupted its request identifier.
          // A request id must be a positive safe integer, never zero or negative.
          if (typeof data.id !== 'number' || !Number.isSafeInteger(data.id) || data.id <= 0)
            finish(workerError('invalid_response'));
          return;
        }
        if (data.type === 'progress') {
          // A corrupted phase or a return to loading after generation indicates
          // a broken worker protocol, not useful progress. Fail immediately so
          // students can retry instead of waiting for the long model timeout.
          if (
            (data.phase !== undefined && data.phase !== 'loading' && data.phase !== 'generating')
            || (generating && data.phase === 'loading')
          ) {
            finish(workerError('invalid_response'));
            return;
          }
          if (data.phase === 'generating' && !generating) {
            generating = true;
            generationStartedAt = performance.now();
            clearTimeout(timer);
            timer = setTimeout(
              () => finish(new Error('這段講解逾時，工作已停止。可縮短問題後重試。')),
              STUDY_TUTOR_GENERATION_TIMEOUT_MS,
            );
          }
          // Legacy unphased progress remains valid. Once generation has started,
          // do not mistake a late unphased download message for a new loading phase.
          report(progressMessage(data.message, generating ? 'generating' : data.phase));
        } else if (data.type === 'result') {
          try {
            if (typeof data.raw !== 'string') throw workerError('invalid_response');
            finish(undefined, parseTutorExplanation(data.raw, source));
          } catch (error) {
            finish(error instanceof Error ? error : workerError('invalid_response'));
          }
        } else {
          finish(workerError(data.type === 'error' ? data.code : 'invalid_response'));
        }
      };
      worker.onerror = () => finish(workerError('runtime'));
      worker.onmessageerror = () => finish(workerError('invalid_response'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      report('正在準備裝置端 AI；首次使用會下載模型，教材不會上傳。');
      if (settled || signal.aborted) return;
      try {
        worker.postMessage({ type: 'recognize', id, prompt } satisfies PersonalImportAiWorkerRequest);
      } catch {
        finish(new Error('無法把本段交給裝置端 AI，工作已停止。請重試。'));
      }
    });
  } finally {
    running = false;
  }
}
