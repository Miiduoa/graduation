import {
  AGENT_MODEL_DELETED_TEXT,
  AGENT_MODEL_DELETE_INCOMPLETE_TEXT,
  AGENT_MODEL_DTYPE,
  AGENT_MODEL_ID,
  AGENT_TRANSFORMERS_CACHE,
  AGENT_TRANSFORMERS_HASH_CACHE,
  buildOrderPrompt,
  validateJudgement,
  type AgentJudgement,
} from '@campus/shared/src/todaySenseAgent';
import type { SenseCard } from '@campus/shared/src/todaySense';

export type AgentInfer = (cards: SenseCard[], now: Date) => Promise<AgentJudgement | null>;

export type AgentDownloadProgress = {
  loaded: number;
  total: number;
  progress: number;
};

export type AgentDownload = (options?: {
  signal?: AbortSignal;
  onProgress?: (info: AgentDownloadProgress) => void;
}) => Promise<boolean>;

type Generator = (
  prompt: string,
  options: { max_new_tokens: number; temperature: number; do_sample: boolean },
) => Promise<Array<{ generated_text?: string | Array<{ role?: string; content?: string }> }>>;

type TransformersModule = {
  env: {
    fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
    cacheKey: string;
  };
  pipeline: (
    task: string,
    model: string,
    options: {
      device: string;
      dtype: string;
      progress_callback?: (info: {
        status?: string;
        progress?: number;
        loaded?: number;
        total?: number;
      }) => void;
    },
  ) => Promise<Generator>;
};

let generatorPromise: Promise<Generator> | null = null;

export function hasWebGpu(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
}

async function loadTransformers(): Promise<TransformersModule> {
  const specifier = '@huggingface/transformers';
  return (await import(/* @vite-ignore */ specifier)) as TransformersModule;
}

async function loadGenerator(options?: {
  signal?: AbortSignal;
  onProgress?: (info: AgentDownloadProgress) => void;
}): Promise<Generator> {
  const transformers = await loadTransformers();
  const previousFetch = transformers.env.fetch;
  transformers.env.fetch = (input, init) => {
    if (options?.signal?.aborted) {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    }
    return previousFetch(input, options?.signal ? { ...init, signal: options.signal } : init);
  };
  try {
    return await transformers.pipeline('text-generation', AGENT_MODEL_ID, {
      device: 'webgpu',
      dtype: AGENT_MODEL_DTYPE,
      progress_callback: (info) => {
        if (info.status !== 'progress' && info.status !== 'progress_total') return;
        options?.onProgress?.({
          loaded: Number(info.loaded) || 0,
          total: Number(info.total) || 0,
          progress: Number(info.progress) || 0,
        });
      },
    });
  } finally {
    transformers.env.fetch = previousFetch;
  }
}

export const downloadTodaySenseModel: AgentDownload = async (options) => {
  if (options?.signal?.aborted) return false;
  try {
    generatorPromise = generatorPromise ?? loadGenerator(options);
    await generatorPromise;
    if (options?.signal?.aborted) {
      generatorPromise = null;
      return false;
    }
    return true;
  } catch {
    generatorPromise = null;
    return false;
  }
};

export async function deleteTodaySenseModelCache(): Promise<{
  released: boolean;
  message: string;
}> {
  generatorPromise = null;
  let released = true;
  const names = new Set([AGENT_TRANSFORMERS_CACHE, AGENT_TRANSFORMERS_HASH_CACHE]);
  try {
    const transformers = await loadTransformers();
    if (transformers.env.cacheKey) names.add(transformers.env.cacheKey);
  } catch {
    // Known cache names still cover the browser store used by Transformers.js.
  }
  if (typeof caches === 'undefined') {
    return { released: false, message: AGENT_MODEL_DELETE_INCOMPLETE_TEXT };
  }
  for (const name of names) {
    try {
      const existed = await caches.has(name);
      if (!existed) continue;
      const deleted = await caches.delete(name);
      if (!deleted) released = false;
    } catch {
      released = false;
    }
  }
  return {
    released,
    message: released ? AGENT_MODEL_DELETED_TEXT : AGENT_MODEL_DELETE_INCOMPLETE_TEXT,
  };
}

export const inferTodaySenseOrder: AgentInfer = async (cards, now) => {
  if (cards.length < 2 || !hasWebGpu()) return null;
  try {
    generatorPromise = generatorPromise ?? loadGenerator();
    const generator = await generatorPromise;
    const prompt = `<|im_start|>user\n${buildOrderPrompt(cards)}<|im_end|>\n<|im_start|>assistant\n`;
    const output = await generator(prompt, {
      max_new_tokens: 180,
      temperature: 0.2,
      do_sample: false,
    });
    const first = output[0]?.generated_text;
    const raw =
      typeof first === 'string' ? first.slice(prompt.length) : first?.at(-1)?.content || '';
    const judged = validateJudgement(raw, cards, now);
    return judged.ok ? judged.value : null;
  } catch {
    generatorPromise = null;
    return null;
  }
};
