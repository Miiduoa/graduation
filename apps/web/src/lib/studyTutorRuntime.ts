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

// An exact substring can be just a period or operator: matching the source is
// necessary, but punctuation alone does not identify what the lesson explains.
function generatedEvidenceQuotes(explanation: TutorExplanation): string[] {
  return [explanation.sourceQuote, ...(explanation.steps?.map((step) => step.sourceQuote) ?? [])];
}
// Enforce this only for NEW worker results. Saved v1/v2 explanations continue
// to use their original schema so old offline study backups remain readable.
function hasSubstantiveGeneratedEvidence(explanation: TutorExplanation): boolean {
  return generatedEvidenceQuotes(explanation).every((quote) => /[\p{L}\p{N}]/u.test(quote));
}

// The prompt asks for at most 60 Unicode characters per quote; the generic
// parser keeps its older 400-code-unit allowance for saved v1/v2 backups.
// Enforce the tighter bound only when accepting new worker-generated lessons.
function hasBoundedGeneratedEvidence(explanation: TutorExplanation): boolean {
  return generatedEvidenceQuotes(explanation).every((quote) => Array.from(quote).length <= 60);
}

// Normalize only a temporary comparison copy: never rewrite source quotes,
// displayed explanations or existing offline backups. Keep ZWJ/ZWNJ because
// they can carry meaning in other scripts and emoji.
function comparableGeneratedTeaching(text: string): string {
  return text.normalize('NFC')
    .replace(/[\u00ad\u034f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu, '')
    .replace(/\s+/gu, ' ').trim();
}

// A valid source quote is not enough if the model leaves the explanation itself
// as punctuation or mathematical operators. Require visible letters or digits
// in the NEW generated summary and each instructional step, not in saved data.
function hasSubstantiveGeneratedTeaching(explanation: TutorExplanation): boolean {
  return [explanation.explanation, ...(explanation.steps?.map((step) => step.explanation) ?? [])]
    .every((text) => /[\p{L}\p{N}]/u.test(comparableGeneratedTeaching(text)));
}

// A valid quote and visible explanation do not make a punctuation-only
// self-check usable. Keep the legacy parser unchanged for saved lessons.
function hasSubstantiveGeneratedReview(explanation: TutorExplanation): boolean {
  return [explanation.question, explanation.answer]
    .every((text) => /[\p{L}\p{N}]/u.test(comparableGeneratedTeaching(text)));
}

// Distinct titles, source lines or whitespace cannot turn the SAME explanation
// into two instructional steps. Keep citations and displayed text untouched.
function hasDistinctGeneratedSteps(explanation: TutorExplanation): boolean {
  if (!explanation.steps) return false;
  const seen = new Set<string>();
  for (const step of explanation.steps) {
    const content = comparableGeneratedTeaching(step.explanation);
    if (!content || seen.has(content)) return false;
    seen.add(content);
  }
  return true;
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
          // Older numeric requests can finish late. An id from the future
          // cannot belong to this dedicated worker, so fail fast instead of
          // leaving the learner waiting for the preparation timeout.
          if (typeof data.id !== 'number' || !Number.isSafeInteger(data.id) ||
            data.id <= 0 || data.id > id)
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
            const explanation = parseTutorExplanation(data.raw, source);
            // Saved older lessons may omit steps, but every NEW local lesson
            // promises a usable 2–4-step explanation, not just a generic summary.
            if (!explanation.steps)
              throw new Error('這次講解缺少分步步驟，無法完成逐步學習。請重新講解。');
            if (!hasDistinctGeneratedSteps(explanation))
              throw new Error('這次講解有空白或重複相同的教學步驟，請重新講解。');
            if (!hasSubstantiveGeneratedTeaching(explanation))
              throw new Error('這次講解的說明只有標點或符號，無法作為教學內容。請重新講解。');
            if (!hasSubstantiveGeneratedReview(explanation))
              throw new Error('這次講解的複習題或參考回答只有標點或符號，無法用來練習。請重新講解。');
            if (!hasSubstantiveGeneratedEvidence(explanation))
              throw new Error('這次講解的原文引句只有標點或符號，無法核對教材依據。請重新講解。');
            if (!hasBoundedGeneratedEvidence(explanation))
              throw new Error('這次講解的原文引句超過 60 字，無法精準核對教材重點。請重新講解。');
            finish(undefined, explanation);
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
