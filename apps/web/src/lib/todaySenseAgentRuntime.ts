import {
  AGENT_MODEL_DTYPE,
  AGENT_MODEL_ID,
  buildOrderPrompt,
  validateJudgement,
  type AgentJudgement,
} from '@campus/shared/src/todaySenseAgent';
import type { SenseCard } from '@campus/shared/src/todaySense';

export type AgentInfer = (cards: SenseCard[], now: Date) => Promise<AgentJudgement | null>;

type Generator = (
  prompt: string,
  options: { max_new_tokens: number; temperature: number; do_sample: boolean },
) => Promise<Array<{ generated_text?: string | Array<{ role?: string; content?: string }> }>>;

let generatorPromise: Promise<Generator> | null = null;

export function hasWebGpu(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
}

async function loadGenerator(): Promise<Generator> {
  const specifier = '@huggingface/transformers';
  const transformers = (await import(/* @vite-ignore */ specifier)) as {
    pipeline: (
      task: string,
      model: string,
      options: { device: string; dtype: string },
    ) => Promise<Generator>;
  };
  return transformers.pipeline('text-generation', AGENT_MODEL_ID, {
    device: 'webgpu',
    dtype: AGENT_MODEL_DTYPE,
  });
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
      typeof first === 'string'
        ? first.slice(prompt.length)
        : first?.at(-1)?.content || '';
    const judged = validateJudgement(raw, cards, now);
    return judged.ok ? judged.value : null;
  } catch {
    generatorPromise = null;
    return null;
  }
};
