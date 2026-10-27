import type { PersonalImportOptions } from '@campus/shared';
import {
  buildPersonalImportAiPrompt,
  parsePersonalImportAiResponse,
} from '@campus/shared/src/imports/aiRecognition';
import { localLLM } from '../localLLMInference';

export const MOBILE_IMPORT_AI_MAX_CHARACTERS = 1_000;
const GENERATION_TIMEOUT_MS = 120_000;

export type MobileImportAiAvailability = {
  status: 'ready' | 'busy' | 'missing' | 'unavailable';
  title: string;
  detail: string;
};

let pending = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A screen observer must not prevent the native operation from settling.
    }
  }
};

export function getMobileImportAiAvailability(): MobileImportAiAvailability {
  const runtime = localLLM.getRuntimeAvailability();
  if (!runtime.available) {
    return {
      status: 'unavailable',
      title: '這個版本尚未提供裝置端 AI',
      detail: '需要安裝包含本機模型引擎的 iOS／Android App。現在仍可讀取學校表格或使用一般整理。',
    };
  }
  const state = localLLM.getState();
  if (pending || ['generating', 'loading', 'downloading'].includes(state.status)) {
    return {
      status: 'busy',
      title: '本機模型正在忙碌',
      detail: '前一次運算或模型準備完成後，就能再次整理。現在的文字與草稿都會保留。',
    };
  }
  if (state.status !== 'ready') {
    return {
      status: 'missing',
      title: '先啟用一個本機模型',
      detail: '模型免費，首次需自行下載並啟用，會占用手機空間；可在模型管理中查看大小。',
    };
  }
  if (!localLLM.getLoadedModelId()?.startsWith('qwen2.5-')) {
    return {
      status: 'missing',
      title: '請啟用 Qwen2.5 模型',
      detail: '目前的匯入功能使用 Qwen2.5 的中文與對話格式。請在模型管理選擇並啟用它，再回來整理。',
    };
  }
  return {
    status: 'ready',
    title: '本機 AI 已就緒',
    detail: '使用已啟用的模型理解原始文字，資料留在這台手機，不使用付費辨識 API。',
  };
}

export function subscribeMobileImportAi(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribe = localLLM.subscribe(listener);
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

/** Only explicit user requests reach the already-loaded native model. */
export async function runMobilePersonalImportAi(
  text: string,
  options: PersonalImportOptions,
  signal: AbortSignal,
): Promise<ReturnType<typeof parsePersonalImportAiResponse>> {
  if (signal.aborted) throw new Error('已取消整理，原始資料仍保留。');
  if (!text.trim()) throw new Error('請先放入要整理的文字。');
  if (text.length > MOBILE_IMPORT_AI_MAX_CHARACTERS) {
    throw new Error('這次文字超過 1,000 字，請分批整理；不會截掉後面的內容。');
  }
  const availability = getMobileImportAiAvailability();
  if (availability.status !== 'ready') throw new Error(availability.detail);
  const modelId = localLLM.getLoadedModelId();
  if (!modelId?.startsWith('qwen2.5-')) throw new Error('請先啟用 Qwen2.5 模型，再重新整理。');
  const context: PersonalImportOptions = {
    ...options,
    ...(options.source ? { source: { ...options.source } } : {}),
  };
  const prompt = buildPersonalImportAiPrompt(text, context);
  pending = true;

  return new Promise((resolve, reject) => {
    let settled = false;
    let owned = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      // This runtime may finish native work after abort. Keep the lock until it
      // settles; never allow that late output into the import preview.
      if (owned) localLLM.abort();
      reject(new Error('已取消整理，原始資料仍保留。'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      if (owned) localLLM.abort();
      reject(new Error('本機 AI 整理逾時，請縮短文字或使用一般整理；原始資料仍保留。'));
    }, GENERATION_TIMEOUT_MS);

    if (signal.aborted) {
      cancel();
      pending = false;
      emit();
      return;
    }

    // Own the cancellation listener here. Older native wrappers retain their
    // caller's AbortSignal, which could accidentally cancel a later request.
    owned = true;
    void localLLM
      .generate({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1536,
        temperature: 0,
        topP: 1,
      })
      .then((result) => {
        if (settled || signal.aborted) return;
        if (localLLM.getLoadedModelId() !== modelId) {
          throw new Error('本機模型已變更，請重新整理。');
        }
        if (result.finishReason !== 'stop') {
          throw new Error('AI 沒有完成整份資料，請減少這次文字後重試；不會只保留部分結果。');
        }
        const parsed = parsePersonalImportAiResponse(result.content, text, context);
        settled = true;
        resolve(parsed);
      })
      .catch((error: unknown) => {
        if (settled) return;
        settled = true;
        // Native errors may contain prompts; show a fixed, actionable message.
        reject(
          new Error(
            error instanceof Error && error.message.startsWith('AI 沒有完成')
              ? error.message
              : 'AI 未能整理出可核對的資料。請縮短內容再試，或使用一般整理。',
          ),
        );
      })
      .finally(() => {
        owned = false;
        pending = false;
        cleanup();
        emit();
      });
    emit();
  });
}
