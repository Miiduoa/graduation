// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IMPORT_AI_MAX_INPUT_TOKENS, IMPORT_AI_MAX_OUTPUT_TOKENS } from './personalImportAiConfig';

const sdk = vi.hoisted(() => {
  class Tensor {
    dims: number[];
    constructor(public data: unknown[], dims?: number[]) {
      this.dims = dims ?? [1, data.length];
    }
    slice(_rows: null, [start, end]: [number, number]) {
      return new Tensor(this.data.slice(start, end));
    }
  }
  return {
    Tensor,
    env: { fetch: vi.fn(), backends: { onnx: { wasm: {} } } },
    processor: Object.assign(vi.fn(), { apply_chat_template: vi.fn(), batch_decode: vi.fn() }),
    model: { generate: vi.fn(), dispose: vi.fn(), generation_config: { eos_token_id: [151645] } },
    AutoProcessor: { from_pretrained: vi.fn() },
    Qwen3VLForConditionalGeneration: { from_pretrained: vi.fn() },
    RawImage: { fromCanvas: vi.fn() },
  };
});
vi.mock('@huggingface/transformers', () => sdk);

let input: InstanceType<typeof sdk.Tensor>;
let messages: Array<{ type: string; raw?: string; message?: string }>;
let worker: { onmessage?: (event: { data: unknown }) => void };

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  input = new sdk.Tensor([BigInt(11), BigInt(12)]);
  messages = [];
  sdk.env.fetch = vi.fn(async () => new Response(new Uint8Array([0, 97, 115, 109]), {
    headers: { 'content-type': 'application/wasm' },
  }));
  sdk.env.backends = { onnx: { wasm: {} } };
  sdk.processor.mockImplementation(async () => ({ input_ids: input }));
  sdk.processor.apply_chat_template.mockReturnValue('local prompt');
  sdk.processor.batch_decode.mockReturnValue(['{"complete":true,"rows":[]}']);
  sdk.AutoProcessor.from_pretrained.mockResolvedValue(sdk.processor);
  sdk.Qwen3VLForConditionalGeneration.from_pretrained.mockResolvedValue(sdk.model);
  sdk.model.generate.mockImplementation(async () => new sdk.Tensor([...input.data, BigInt(99), BigInt(151645)]));
  sdk.model.dispose.mockResolvedValue(undefined);
  worker = {};
  vi.stubGlobal('self', Object.assign(worker, {
    location: { origin: 'https://campus.test' },
    navigator: { gpu: { requestAdapter: async () => ({
      features: new Set(['shader-f16']),
      limits: { maxBufferSize: 1024 ** 3, maxStorageBufferBindingSize: 1024 ** 3 },
    }) } },
    postMessage: (message: (typeof messages)[number]) => messages.push(message),
  }));
  vi.stubGlobal('caches', {});
  await import('./personalImportAi.worker');
});
afterEach(() => vi.unstubAllGlobals());

async function recognize() {
  worker.onmessage?.({ data: { type: 'recognize', id: 8, prompt: '私人課表' } });
  await vi.waitFor(() => expect(messages.some(({ type }) => type !== 'progress')).toBe(true));
  return messages.find(({ type }) => type !== 'progress');
}

it.each(['shrink', 'expand', 'replace'])('uses the original prefix when native generation can %s its input', async (change) => {
  sdk.model.generate.mockImplementationOnce(async () => {
    const result = new sdk.Tensor([...input.data, BigInt(99), BigInt(151645)]);
    if (change === 'shrink') { input.dims[1] = 1; input.data.splice(0, 1); }
    else if (change === 'expand') { input.data.push(BigInt(77)); input.dims[1] = 3; }
    else { input.data = [BigInt(91), BigInt(92)]; }
    return result;
  });
  expect(await recognize()).toMatchObject({ type: 'result' });
  expect(sdk.processor.batch_decode.mock.calls[0][0].data).toEqual([BigInt(99), BigInt(151645)]);
  expect(sdk.model.dispose).toHaveBeenCalledOnce();
});

it('does not accept a wrong prefix even when the runtime overwrites the input to match it', async () => {
  sdk.model.generate.mockImplementationOnce(async () => {
    input.data = [BigInt(21), BigInt(22)];
    return new sdk.Tensor([BigInt(21), BigInt(22), BigInt(99), BigInt(151645)]);
  });
  expect(await recognize()).toMatchObject({ type: 'error', message: expect.stringContaining('來源不一致') });
  expect(sdk.processor.batch_decode).not.toHaveBeenCalled();
});

it.each([false, true])('compares equivalent integer representations without coercing arbitrary values (%s)', async (bigintInput) => {
  input = new sdk.Tensor(bigintInput ? [BigInt(11), BigInt(12)] : [11, 12]);
  sdk.model.generate.mockResolvedValue(new sdk.Tensor(bigintInput ? [11, 12, 99, 151645] : [BigInt(11), BigInt(12), BigInt(99), BigInt(151645)]));
  expect(await recognize()).toMatchObject({ type: 'result' });
});

it.each([NaN, Infinity, -1, 0.5, '11', null, Number.MAX_SAFE_INTEGER + 1, BigInt('9007199254740992')])(
  'rejects an invalid input token before loading weights (%s)', async (badToken) => {
    input.data[0] = badToken;
    expect(await recognize()).toMatchObject({
      type: 'error', message: expect.stringContaining('輸入格式不完整'),
    });
    expect(sdk.processor).toHaveBeenCalledOnce();
    expect(sdk.Qwen3VLForConditionalGeneration.from_pretrained).not.toHaveBeenCalled();
    expect(sdk.model.generate).not.toHaveBeenCalled();
  },
);

it.each([NaN, Infinity, -1, 0.5, '99', null, Number.MAX_SAFE_INTEGER + 1, BigInt('9007199254740992')])(
  'rejects an invalid generated token without decoding it (%s)', async (badToken) => {
    sdk.model.generate.mockResolvedValue(new sdk.Tensor([BigInt(11), BigInt(12), badToken, BigInt(151645)]));
    expect(await recognize()).toMatchObject({
      type: 'error', message: expect.stringContaining('序列格式不完整'),
    });
    expect(sdk.processor.batch_decode).not.toHaveBeenCalled();
    expect(sdk.model.dispose).toHaveBeenCalledOnce();
  },
);

it('keeps both configured budget boundaries inclusive', async () => {
  input = new sdk.Tensor(Array<bigint>(IMPORT_AI_MAX_INPUT_TOKENS).fill(BigInt(11)));
  sdk.model.generate.mockImplementationOnce(async () => new sdk.Tensor([
    ...input.data, ...Array<bigint>(IMPORT_AI_MAX_OUTPUT_TOKENS - 1).fill(BigInt(99)), BigInt(151645),
  ]));
  expect(await recognize()).toMatchObject({ type: 'result' });
  expect(sdk.processor.batch_decode.mock.calls[0][0].data).toHaveLength(IMPORT_AI_MAX_OUTPUT_TOKENS);
});
