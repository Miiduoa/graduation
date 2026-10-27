// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMPORT_AI_MAX_INPUT_TOKENS,
  IMPORT_AI_MAX_OUTPUT_TOKENS,
  type PersonalImportAiWorkerResponse,
} from './personalImportAiConfig';

const sdk = vi.hoisted(() => {
  class Tensor {
    dims: number[];
    constructor(public data: bigint[], dims?: number[]) {
      this.dims = dims ?? [1, data.length];
    }
    slice(_rows: null, [start, end]: [number, number]) {
      return new Tensor(this.data.slice(start, end));
    }
  }
  return {
    Tensor,
    env: { fetch: vi.fn(), backends: { onnx: { wasm: {} } } },
    processor: Object.assign(vi.fn(), {
      apply_chat_template: vi.fn(),
      batch_decode: vi.fn(),
    }),
    model: {
      generate: vi.fn(),
      dispose: vi.fn(),
      generation_config: { eos_token_id: [151645] },
    },
    AutoProcessor: { from_pretrained: vi.fn() },
    Qwen3VLForConditionalGeneration: { from_pretrained: vi.fn() },
    RawImage: { fromCanvas: vi.fn() },
  };
});
vi.mock('@huggingface/transformers', () => sdk);

let messages: PersonalImportAiWorkerResponse[];
let stages: string[];
let pixels: Uint8ClampedArray;
let close: ReturnType<typeof vi.fn>;
let worker: { onmessage: ((event: { data: unknown }) => void) | null };

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  messages = [];
  stages = [];
  pixels = new Uint8ClampedArray([70, 80, 90]);
  close = vi.fn();
  sdk.env.fetch = vi.fn(async () => {
    stages.push('runtime');
    return new Response(new Uint8Array([0, 97, 115, 109]), {
      headers: { 'content-type': 'application/wasm' },
    });
  });
  sdk.env.backends = { onnx: { wasm: {} } };
  sdk.AutoProcessor.from_pretrained.mockImplementation(async () => {
    stages.push('processor');
    return sdk.processor;
  });
  sdk.processor.apply_chat_template.mockReturnValue('local prompt');
  sdk.processor.mockImplementation(async () => {
    stages.push('preprocess');
    return { input_ids: new sdk.Tensor([11n, 12n]) };
  });
  sdk.processor.batch_decode.mockReturnValue(['{"complete":true,"rows":[]}']);
  sdk.Qwen3VLForConditionalGeneration.from_pretrained.mockImplementation(async () => {
    stages.push('weights');
    return sdk.model;
  });
  sdk.model.generate.mockImplementation(async ({ input_ids }) => {
    stages.push('generate');
    return new sdk.Tensor([...input_ids.data, 99n, 151645n]);
  });
  sdk.model.dispose.mockImplementation(async () => { stages.push('dispose'); });
  sdk.RawImage.fromCanvas.mockReturnValue({ rgb: () => ({ data: pixels }) });
  worker = { onmessage: null };
  vi.stubGlobal('self', {
    ...worker,
    location: { origin: 'https://campus.test' },
    navigator: {
      gpu: {
        requestAdapter: async () => ({
          features: new Set(['shader-f16']),
          limits: { maxBufferSize: 1024 ** 3, maxStorageBufferBindingSize: 512 * 1024 ** 2 },
        }),
      },
    },
    postMessage: (message: PersonalImportAiWorkerResponse) => messages.push(message),
  });
  worker = self as unknown as typeof worker;
  vi.stubGlobal('caches', {});
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600, close })));
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }; }
  });
  await import('./personalImportAi.worker');
});
afterEach(() => vi.unstubAllGlobals());

async function recognize(image?: File) {
  worker.onmessage?.({ data: { type: 'recognize', id: 19, prompt: '私人來源內容', image } });
  await vi.waitFor(() => expect(messages.some((message) => message.type !== 'progress')).toBe(true));
  return messages.find((message) => message.type !== 'progress');
}
function png() {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], '來源.png');
}
function noWeights() {
  expect(sdk.Qwen3VLForConditionalGeneration.from_pretrained).not.toHaveBeenCalled();
  expect(sdk.model.generate).not.toHaveBeenCalled();
  expect(sdk.model.dispose).not.toHaveBeenCalled();
}

describe('import preflight before model allocation', () => {
  it('checks the complete processor input before downloading weights or allocating a model', async () => {
    expect(await recognize()).toMatchObject({ type: 'result', id: 19 });
    expect(stages).toEqual(['runtime', 'processor', 'preprocess', 'weights', 'generate', 'dispose']);
    expect(sdk.processor.batch_decode.mock.calls[0][0].data).toEqual([99n, 151645n]);
  });
  it.each([false, true])('rejects an over-budget input before model download (image=%s)', async (image) => {
    sdk.processor.mockResolvedValue({
      input_ids: new sdk.Tensor(Array<bigint>(IMPORT_AI_MAX_INPUT_TOKENS + 1).fill(11n)),
    });
    expect(await recognize(image ? png() : undefined)).toMatchObject({
      type: 'error', message: expect.stringContaining('單次辨識範圍'),
    });
    noWeights();
    if (image) {
      expect(pixels).toEqual(new Uint8ClampedArray(3));
      expect(close).toHaveBeenCalledOnce();
    }
  });
  it('accepts the exact input budget without silently dropping source tokens', async () => {
    const input = new sdk.Tensor(Array<bigint>(IMPORT_AI_MAX_INPUT_TOKENS).fill(11n));
    sdk.processor.mockResolvedValue({ input_ids: input });
    expect(await recognize()).toMatchObject({ type: 'result' });
    expect(sdk.model.generate.mock.calls[0][0].input_ids).toBe(input);
    expect(input.data).toHaveLength(IMPORT_AI_MAX_INPUT_TOKENS);
  });
  it.each([
    [], [1], [2, 1], [1, 0], [1, -1], [1, 2.5], [1, NaN], [1, Infinity], [1, 2, 1], [1, 3],
  ].map((dims) => [dims]))('rejects malformed input dimensions %j without loading weights', async (dims) => {
    sdk.processor.mockResolvedValue({ input_ids: new sdk.Tensor([11n, 12n], dims) });
    expect(await recognize()).toMatchObject({ type: 'error' });
    noWeights();
  });
  it('rejects an input_ids-shaped object that is not an SDK Tensor', async () => {
    sdk.processor.mockResolvedValue({ input_ids: { dims: [1, 2], data: [11n, 12n] } });
    expect(await recognize()).toMatchObject({ type: 'error' });
    noWeights();
  });
  it('keeps a processor failure private and releases the image without loading weights', async () => {
    sdk.processor.mockRejectedValue(new Error('private timetable and student ID'));
    const result = await recognize(png());
    expect(result).toMatchObject({ type: 'error' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('私人來源內容');
    noWeights();
    expect(pixels).toEqual(new Uint8ClampedArray(3));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('import generation sequence integrity', () => {
  it.each([
    [], [4], [2, 2], [1, 0], [1, 2], [1, 4.5], [1, NaN], [1, Infinity], [1, 4, 1], [1, 5],
  ].map((dims) => [dims]))('does not decode malformed output dimensions %j', async (dims) => {
    sdk.model.generate.mockResolvedValue(new sdk.Tensor([11n, 12n, 99n, 151645n], dims));
    expect(await recognize()).toMatchObject({ type: 'error' });
    expect(sdk.processor.batch_decode).not.toHaveBeenCalled();
    expect(sdk.model.dispose).toHaveBeenCalledOnce();
  });
  it('does not decode output belonging to a different input sequence', async () => {
    sdk.model.generate.mockResolvedValue(new sdk.Tensor([21n, 22n, 99n, 151645n]));
    expect(await recognize(png())).toMatchObject({
      type: 'error', message: expect.stringContaining('來源不一致'),
    });
    expect(sdk.processor.batch_decode).not.toHaveBeenCalled();
    expect(sdk.model.dispose).toHaveBeenCalledOnce();
    expect(pixels).toEqual(new Uint8ClampedArray(3));
  });
  it('rejects output exceeding the configured generation budget, even with an end token', async () => {
    sdk.model.generate.mockResolvedValue(new sdk.Tensor([
      11n, 12n, ...Array<bigint>(IMPORT_AI_MAX_OUTPUT_TOKENS).fill(99n), 151645n,
    ]));
    expect(await recognize()).toMatchObject({ type: 'error' });
    expect(sdk.processor.batch_decode).not.toHaveBeenCalled();
    expect(sdk.model.dispose).toHaveBeenCalledOnce();
  });
  it('does not treat the unchanged input prefix as a generated response', async () => {
    sdk.model.generate.mockResolvedValue(new sdk.Tensor([11n, 12n]));
    expect(await recognize()).toMatchObject({ type: 'error' });
    expect(sdk.processor.batch_decode).not.toHaveBeenCalled();
    expect(sdk.model.dispose).toHaveBeenCalledOnce();
  });
});
