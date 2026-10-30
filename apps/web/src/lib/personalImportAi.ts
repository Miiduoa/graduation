'use client';

import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import {
  parsePersonalImportAiResponse,
  type PersonalImportAiResult,
} from '@campus/shared/src/imports/aiRecognition';
import {
  requestPersonalImportCloud,
  maskPersonalImportCloudBatch,
  isPersonalImportCloudMaskSafe,
} from '@campus/shared/src/imports/aiCloud';
import {
  planResilientPersonalImportBatches,
  splitPersonalImportAiTextBatch,
  type PersonalImportAiTextBatch,
} from '@campus/shared/src/imports/aiTextBatches';
import {
  auditPersonalImportAiTable,
  personalImportAiTableAuditMessage,
} from '@campus/shared/src/imports/aiTableAudit';
import type { PersonalImportOptions } from '@campus/shared/src/imports/types';
import { recognizePersonalImportImage } from './personalImportOcr';
import {
  deletePersonalImportAiModelCache as deleteLocalCache,
  getPersonalImportAiAvailability as localAvailability,
  runLocalPersonalImportAi,
} from './personalImportAiLocal';

export type ImportRecognitionBatch = PersonalImportAiTextBatch & { rulesOnly?: boolean };
export type PersonalImportAiRetry = {
  batches: ImportRecognitionBatch[];
  completed: PersonalImportAiResult;
  replaceRowIds?: string[];
  cloudSafe?: boolean;
  sourceText?: string;
};
export type PersonalImportAiRunResult = PersonalImportAiResult & { retry?: PersonalImportAiRetry; sourceText?: string };
export type PersonalImportAiRequest = {
  input: { text?: string; image?: File };
  options: PersonalImportOptions;
  signal: AbortSignal;
  onProgress: (message: string) => void;
  onPartial?: (result: PersonalImportAiRunResult) => void;
  cloudHeaders?: Record<string, string>;
  knownNames?: readonly string[];
  retry?: PersonalImportAiRetry;
};

let running = false;
const cancelled = () => new DOMException('已停止整理，已完成的草稿仍保留。', 'AbortError');
const clone = (result: PersonalImportAiResult): PersonalImportAiResult => ({
  rows: [...result.rows],
  issues: [...result.issues],
});
const append = (target: PersonalImportAiResult, result: PersonalImportAiResult) => {
  target.rows.push(...result.rows);
  target.issues.push(...result.issues);
};

export function getPersonalImportAiAvailability(): {
  available: boolean;
  reason?: string;
  downloadLabel: string;
  localAvailable?: boolean;
} {
  const local = localAvailability();
  return { ...local, available: typeof window !== 'undefined', localAvailable: local.available };
}
export async function deletePersonalImportAiModelCache() {
  if (running) throw new Error('AI 正在辨識，請先停止或等辨識完成後再移除模型。');
  await deleteLocalCache();
}

function rules(
  batch: ImportRecognitionBatch,
  options: PersonalImportOptions,
): PersonalImportAiResult {
  const prefix = batch.columnContext ? `${batch.columnContext}\n` : '';
  const prefixLines = prefix.split('\n').length - 1;
  const result = parsePersonalImport(prefix + batch.text, options);
  return {
    ...result,
    rows: result.rows
      .filter((row) => row.source.line > prefixLines)
      .map((row) => ({
        ...row,
        source: { ...row.source, line: row.source.line - prefixLines + batch.startLine - 1 },
      })),
  };
}

/** 每段完成就交付草稿；失敗範圍可以重試，不重跑已完成的段落。 */
export async function runPersonalImportAi(
  request: PersonalImportAiRequest,
): Promise<PersonalImportAiRunResult> {
  const { signal } = request;
  if (signal.aborted) throw cancelled();
  if (running) throw new Error('另一份資料正在整理，請稍候再試。');
  running = true;
  const workerSession: { worker?: Worker } = {};
  const options = {
    ...request.options,
    source: request.options.source ? { ...request.options.source } : undefined,
  };
  const progress = (message: string) => {
    if (signal.aborted) return;
    try {
      request.onProgress(message);
    } catch {
      /* 畫面更新失敗不能中斷辨識。 */
    }
  };
  const successful = clone(request.retry?.completed ?? { rows: [], issues: [] });
  const failed: Array<{ batch: ImportRecognitionBatch; result: PersonalImportAiResult }> = [];
  let work: ImportRecognitionBatch[] = [];
  let index = 0;
  let splits = 0;
  let cloudEnabled = true;
  let sourceMaskSafe = request.retry?.cloudSafe !== false;
  let cloudFallbackMessage = '';
  let originalSource = request.retry?.sourceText ?? request.input.text ?? '';
  let localEnabled = localAvailability().available;
  let provider = '';
  const snapshot = (): PersonalImportAiRunResult => {
    const result = clone(successful);
    for (const item of failed) append(result, item.result);
    result.rows.sort((left, right) => left.source.line - right.source.line);
    if (provider)
      result.issues.push({ code: 'import-provider', severity: 'warning', message: provider });
    const remaining = [...failed.map((item) => item.batch), ...work.slice(index + 1)];
    return {
      ...result,
      sourceText: originalSource,
      ...(remaining.length
        ? {
            retry: {
              batches: remaining,
              completed: clone(successful),
              replaceRowIds: failed.flatMap((item) => item.result.rows.map((row) => row.id)),
              cloudSafe: sourceMaskSafe,
              sourceText: originalSource,
            },
          }
        : {}),
    };
  };
  const publish = () => {
    if (signal.aborted) return;
    try {
      request.onPartial?.(snapshot());
    } catch {
      /* 完成結果仍由此次工作保留。 */
    }
  };
  try {
    let source = request.input.text ?? '';
    if (!request.retry && request.input.image) {
      progress('正在這台裝置讀取圖片文字，原圖不會上傳。');
      try {
        source = await recognizePersonalImportImage(request.input.image, signal, progress);
        if (!source.trim()) throw new Error('圖片文字辨識未取得文字。');
      } catch (error) {
        if (signal.aborted) throw cancelled();
        if (!localEnabled) throw error;
        provider = '圖片文字辨識未完成，目前改用本機視覺模型；原圖不會上傳。';
        progress(provider);
        const visual = await runLocalPersonalImportAi({
          input: { image: request.input.image },
          options,
          signal,
          workerSession,
          onProgress: (message) => progress(`${provider}${message}`),
        });
        if (signal.aborted) throw cancelled();
        append(successful, visual);
        publish();
        return snapshot();
      }
    }
    if (signal.aborted) throw cancelled();
    if (!request.retry) originalSource = source;
    if (request.retry) {
      work = [...request.retry.batches];
      cloudEnabled = sourceMaskSafe;
    } else {
      sourceMaskSafe = cloudEnabled = isPersonalImportCloudMaskSafe(source);
      if (!cloudEnabled)
        cloudFallbackMessage = '這份資料無法可靠遮罩姓名欄位，已保留在裝置上整理。';
      const planned = planResilientPersonalImportBatches(
        source,
        {
          maxBatchCharacters: 1_000,
          maxTotalCharacters: 40_000,
          maxBatches: 80,
        },
      );
      work = planned.batches;
      successful.issues.push(
        ...planned.issues.map((message) => ({
          code: 'import-batch-plan',
          severity: 'warning' as const,
          message,
        })),
      );
    }
    for (index = 0; index < work.length; index++) {
      if (signal.aborted) throw cancelled();
      const batch = work[index];
      let result: PersonalImportAiResult | undefined;
      let failure = batch.rulesOnly ? '這一段無法安全拆分，已改用規則解析。' : cloudFallbackMessage;
      const label = `第 ${index + 1}／${work.length} 段（原文第 ${batch.startLine} 行起）`;
      const cloudInput = cloudEnabled && !batch.rulesOnly
        ? maskPersonalImportCloudBatch(originalSource, batch, request.knownNames) : null;
      if (cloudEnabled && !batch.rulesOnly && !cloudInput) {
        cloudEnabled = false;
        failure = cloudFallbackMessage = '這一段無法可靠對照原文並遮罩個資，已保留在裝置上整理。';
      }
      if (cloudEnabled && cloudInput && !batch.rulesOnly) {
        provider = '目前使用雲端整理，送出前已遮罩可辨識的姓名、學號與證號。';
        progress(`${provider}正在整理${label}。`);
        const response = await requestPersonalImportCloud({
          text: cloudInput.sourceText,
          columnContext: cloudInput.columnContext,
          kind: options.kind,
          headers: request.cloudHeaders,
          signal,
        });
        if (response.ok) {
          try {
            result = parsePersonalImportAiResponse(response.output, response.sourceText, options);
            const audit = auditPersonalImportAiTable(
              response.sourceText,
              result.rows,
              options.kind,
              response.columnContext,
              options.periodProfile,
            );
            if (audit.status === 'mismatch')
              throw new Error(personalImportAiTableAuditMessage(audit));
            if (audit.status === 'matched')
              result.rows = result.rows.map((row) => ({
                ...row,
                source: { ...row.source, line: audit.sourceLines[row.id] ?? row.source.line },
              }));
          } catch {
            result = undefined;
            failure = '雲端回傳內容不完整或無法對照來源。';
            const smaller = splits < 8 ? splitPersonalImportAiTextBatch(batch) : null;
            if (smaller) {
              splits++;
              work.splice(index, 1, ...smaller);
              index--;
              progress('這段內容尚未完整整理，已縮小範圍重試；完成的草稿仍保留。');
              continue;
            }
          }
        } else {
          cloudEnabled = false;
          failure = response.message;
          cloudFallbackMessage = response.message;
          progress(response.message);
        }
      }
      if (!result && localEnabled && !batch.rulesOnly) {
        provider = '目前使用本機模型整理，這一段資料不會送到雲端。';
        progress(`${failure}${provider}正在整理${label}。`);
        try {
          result = await runLocalPersonalImportAi({
            input: { text: batch.text },
            options,
            columnContext: batch.columnContext,
            signal,
            workerSession,
            onProgress: (message) => progress(`${provider}${label}：${message}`),
          });
        } catch (error) {
          if (signal.aborted) throw cancelled();
          failure = error instanceof Error ? error.message : '本機模型未能完成這一段。';
          const smaller =
            workerSession.worker && splits < 8 ? splitPersonalImportAiTextBatch(batch) : null;
          if (smaller) {
            splits++;
            work.splice(index, 1, ...smaller);
            index--;
            continue;
          }
          if (!workerSession.worker) localEnabled = false;
        }
      }
      if (signal.aborted) throw cancelled();
      if (result) {
        result.rows = result.rows.map((row) => ({
          ...row,
          source: { ...row.source, line: row.source.line + batch.startLine - 1 },
        }));
        append(successful, result);
      } else {
        provider = localEnabled
          ? '目前使用規則解析，已完成的草稿仍保留。'
          : '本機模型無法使用，目前使用規則解析；已完成的草稿仍保留。';
        progress(`${failure}${provider}`);
        const fallback = rules(batch, options);
        fallback.issues.push({
          code: 'import-batch-failed',
          severity: 'warning',
          message: `${label}未完成模型整理。${failure}${fallback.rows.length ? '已保留規則解析草稿，請逐筆核對。' : '此段已略過，原文仍保留。'}可重試未完成段落。`,
        });
        failed.push({ batch, result: fallback });
      }
      publish();
    }
    return snapshot();
  } finally {
    workerSession.worker?.terminate();
    running = false;
  }
}
