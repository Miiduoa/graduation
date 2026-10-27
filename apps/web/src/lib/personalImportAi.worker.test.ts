// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  IMPORT_AI_CACHE_NAME,
  IMPORT_AI_MAX_OUTPUT_TOKENS,
  IMPORT_AI_MODEL_ID,
  IMPORT_AI_MODEL_REVISION,
  IMPORT_AI_WASM_ROOT,
  fitImportAiImage,
  isImportAiAssetUrl,
  type PersonalImportAiWorkerRequest,
  type PersonalImportAiWorkerResponse,
} from './personalImportAiConfig';

const sdk = vi.hoisted(() => {
  class Tensor {
    dims: number[];
    data: number[];
    constructor(data: number[]) {
      this.data = data;
      this.dims = [1, data.length];
    }
    slice(_rows: null, [start, end]: [number, number]) {
      return new Tensor(this.data.slice(start, end));
    }
  }
  const processor = Object.assign(vi.fn(), {
    apply_chat_template: vi.fn(),
    batch_decode: vi.fn(),
  });
  const model = {
    generate: vi.fn(),
    dispose: vi.fn(),
    generation_config: { eos_token_id: [151645, 151643] },
  };
  return {
    Tensor,
    env: { fetch: vi.fn(), backends: { onnx: { wasm: {} } } } as {
      fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
      backends: { onnx: { wasm: Record<string, unknown> } };
      [key: string]: unknown;
    },
    processor,
    model,
    AutoProcessor: { from_pretrained: vi.fn() },
    Qwen3VLForConditionalGeneration: { from_pretrained: vi.fn() },
    RawImage: { fromCanvas: vi.fn() },
  };
});

vi.mock('@huggingface/transformers', () => sdk);

const origin = 'https://campus.test';
const modelRoot = `https://huggingface.co/${IMPORT_AI_MODEL_ID}/resolve/${IMPORT_AI_MODEL_REVISION}/`;
let messages: PersonalImportAiWorkerResponse[];
let worker: {
  location: { origin: string };
  navigator: { gpu?: { requestAdapter: ReturnType<typeof vi.fn> } };
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
};
let fetchAsset: Mock<(input: string | URL, init?: RequestInit) => Promise<Response>>;
let bitmapClose: ReturnType<typeof vi.fn>;
let pixels: Uint8ClampedArray;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  messages = [];
  worker = {
    location: { origin },
    navigator: {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          features: new Set(['shader-f16']),
          limits: { maxBufferSize: 1024 ** 3, maxStorageBufferBindingSize: 512 * 1024 ** 2 },
        }),
      },
    },
    onmessage: null,
    postMessage: vi.fn((message) => messages.push(message)),
  };
  fetchAsset = vi.fn().mockImplementation(
    async () =>
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { 'content-type': 'application/wasm' },
      }),
  );
  sdk.env.fetch = fetchAsset;
  sdk.env.backends = { onnx: { wasm: {} } };
  sdk.AutoProcessor.from_pretrained.mockResolvedValue(sdk.processor);
  sdk.Qwen3VLForConditionalGeneration.from_pretrained.mockResolvedValue(sdk.model);
  sdk.processor.apply_chat_template.mockReturnValue('formatted local prompt');
  sdk.processor.mockResolvedValue({ input_ids: new sdk.Tensor([11, 12]) });
  sdk.processor.batch_decode.mockReturnValue([' {"complete":true,"rows":[]} ']);
  sdk.model.generate.mockResolvedValue(new sdk.Tensor([11, 12, 99, 151645]));
  sdk.model.dispose.mockResolvedValue(undefined);
  bitmapClose = vi.fn();
  pixels = new Uint8ClampedArray([100, 110, 120]);
  sdk.RawImage.fromCanvas.mockReturnValue({ rgb: () => ({ data: pixels }) });
  vi.stubGlobal('self', worker);
  vi.stubGlobal('caches', {});
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 2000, height: 1200, close: bitmapClose }),
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
      }
    },
  );
  await import('./personalImportAi.worker');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function recognize(extra: Partial<PersonalImportAiWorkerRequest> = {}) {
  const request: PersonalImportAiWorkerRequest = {
    type: 'recognize',
    id: 7,
    prompt: '私人課表內容',
    ...extra,
  };
  worker.onmessage?.({ data: request });
  await vi.waitFor(() =>
    expect(messages.some((message) => message.type === 'result' || message.type === 'error')).toBe(
      true,
    ),
  );
  return messages.find((message) => message.type === 'result' || message.type === 'error');
}

function pngFile() {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], '課表.png', {
    type: 'image/png',
  });
}

describe('personal import AI worker', () => {
  it('does not load assets until explicitly asked and rejects unsupported devices before downloads', async () => {
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(sdk.AutoProcessor.from_pretrained).not.toHaveBeenCalled();
    worker.navigator.gpu = undefined;
    expect(await recognize()).toMatchObject({
      type: 'error',
      message: expect.stringContaining('WebGPU'),
    });
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(sdk.Qwen3VLForConditionalGeneration.from_pretrained).not.toHaveBeenCalled();
  });

  it('passes local image pixels directly to the visual model and only decodes generated tokens', async () => {
    const file = pngFile();
    expect(await recognize({ image: file })).toEqual({
      type: 'result',
      id: 7,
      raw: '{"complete":true,"rows":[]}',
    });
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(sdk.processor.apply_chat_template).toHaveBeenCalledWith(
      [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: '私人課表內容' }] }],
      { add_generation_prompt: true, tokenize: false },
    );
    expect(sdk.processor).toHaveBeenCalledWith(
      'formatted local prompt',
      expect.objectContaining({ data: pixels }),
    );
    expect(sdk.processor.batch_decode.mock.calls[0][0].data).toEqual([99, 151645]);
    expect(sdk.Qwen3VLForConditionalGeneration.from_pretrained).toHaveBeenCalledWith(
      IMPORT_AI_MODEL_ID,
      expect.objectContaining({
        revision: IMPORT_AI_MODEL_REVISION,
        device: 'webgpu',
        dtype: {
          embed_tokens: 'q4f16',
          vision_encoder: 'fp16',
          decoder_model_merged: 'q4f16',
        },
      }),
    );
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(fetchAsset).toHaveBeenCalledWith(
      `${origin}${IMPORT_AI_WASM_ROOT}ort-wasm-simd-threaded.asyncify.wasm`,
      {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
    );
    expect(sdk.env.cacheKey).toBe(IMPORT_AI_CACHE_NAME);
    expect(sdk.env.remotePathTemplate).toBe(`{model}/resolve/${IMPORT_AI_MODEL_REVISION}/`);
    expect(sdk.env.experimental_useCrossOriginStorage).toBe(false);
    expect(pixels).toEqual(new Uint8ClampedArray(3));
    expect(bitmapClose).toHaveBeenCalledOnce();
    expect(sdk.model.dispose).toHaveBeenCalledOnce();
  });

  it('rejects uploads and data-bearing URLs even when the requested asset is otherwise valid', async () => {
    await recognize();
    await expect(
      sdk.env.fetch(`${modelRoot}config.json`, { method: 'POST', body: 'private' }),
    ).rejects.toThrow();
    await expect(sdk.env.fetch(`${modelRoot}config.json?prompt=private`)).rejects.toThrow();
    await expect(sdk.env.fetch('https://other.example/model.onnx')).rejects.toThrow();
    expect(fetchAsset).toHaveBeenCalledTimes(1);
  });

  it('does not silently accept a response cut off at the output budget and still disposes the model', async () => {
    sdk.model.generate.mockResolvedValue(
      new sdk.Tensor([11, 12, ...Array<number>(IMPORT_AI_MAX_OUTPUT_TOKENS).fill(99)]),
    );
    expect(await recognize()).toMatchObject({
      type: 'error',
      message: expect.stringContaining('尚未辨識完整'),
    });
    expect(sdk.processor.batch_decode).not.toHaveBeenCalled();
    expect(sdk.model.dispose).toHaveBeenCalledOnce();
  });

  it('accepts a complete response whose end token is exactly at the output budget', async () => {
    sdk.model.generate.mockResolvedValue(
      new sdk.Tensor([11, 12, ...Array<number>(IMPORT_AI_MAX_OUTPUT_TOKENS - 1).fill(99), 151645]),
    );
    expect(await recognize()).toMatchObject({ type: 'result' });
  });

  it('rejects an unsupported file before downloading the runtime or model', async () => {
    expect(
      await recognize({ image: new File(['<svg/>'], '課表.png', { type: 'image/png' }) }),
    ).toMatchObject({ type: 'error', message: expect.stringContaining('JPG、PNG 或 WebP') });
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(sdk.AutoProcessor.from_pretrained).not.toHaveBeenCalled();
  });

  it('releases oversized decoded images without loading model weights', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue({
      width: 6000,
      height: 5000,
      close: bitmapClose,
    } as unknown as ImageBitmap);
    expect(await recognize({ image: pngFile() })).toMatchObject({
      type: 'error',
      message: expect.stringContaining('解析度過大'),
    });
    expect(bitmapClose).toHaveBeenCalledOnce();
    expect(sdk.AutoProcessor.from_pretrained).not.toHaveBeenCalled();
  });

  it('reports an unavailable self-hosted runtime before model download', async () => {
    fetchAsset.mockResolvedValue(
      new Response('<html>missing</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    );
    expect(await recognize()).toMatchObject({
      type: 'error',
      message: expect.stringContaining('尚未備妥'),
    });
    expect(sdk.AutoProcessor.from_pretrained).not.toHaveBeenCalled();
  });

  it('keeps download failures actionable without exposing the original error or prompt', async () => {
    sdk.AutoProcessor.from_pretrained.mockRejectedValueOnce(
      new Error('fetch failed: private token and personal timetable'),
    );
    expect(await recognize({ image: pngFile() })).toMatchObject({
      type: 'error',
      message: '辨識模型尚未下載完成。請確認網路連線後重試，已快取的模型檔會保留。',
    });
    expect(pixels).toEqual(new Uint8ClampedArray(3));
  });

  it.each(['progress', 'progress_total'])(
    'shows download activity for SDK %s events',
    async (status) => {
      sdk.AutoProcessor.from_pretrained.mockImplementationOnce(async (_model, options) => {
        options.progress_callback({
          status,
          file: 'tokenizer.json',
          loaded: 2_000_000,
          total: 9_000_000,
        });
        return sdk.processor;
      });
      await recognize();
      expect(messages).toContainEqual({
        type: 'progress',
        id: 7,
        message: '正在下載辨識模型（已接收 2 MB）',
      });
    },
  );
});

describe('fixed import model assets and image budget', () => {
  it('allows only the pinned asset set and self-hosted runtime', () => {
    expect(isImportAiAssetUrl(`${modelRoot}onnx/vision_encoder_fp16.onnx_data`, origin)).toBe(true);
    expect(
      isImportAiAssetUrl(
        `${origin}${IMPORT_AI_WASM_ROOT}ort-wasm-simd-threaded.asyncify.mjs`,
        origin,
      ),
    ).toBe(true);
    for (const invalid of [
      `${modelRoot}config.json?text=private`,
      `${modelRoot}config.json#private`,
      modelRoot.replace(IMPORT_AI_MODEL_REVISION, 'main') + 'config.json',
      modelRoot.replace('huggingface.co', 'huggingface.co.other.example') + 'config.json',
      `${modelRoot}onnx/decoder_model_merged.onnx`,
      `${origin}${IMPORT_AI_WASM_ROOT}../private`,
      `https://user:password@huggingface.co/${IMPORT_AI_MODEL_ID}/resolve/${IMPORT_AI_MODEL_REVISION}/config.json`,
    ])
      expect(isImportAiAssetUrl(invalid, origin)).toBe(false);
  });

  it('bounds both pixels and longest edge without enlarging small images or cropping the page', () => {
    for (const [width, height] of [
      [6000, 4000],
      [500, 8000],
      [4000, 300],
      [800, 600],
    ]) {
      const result = fitImportAiImage(width, height);
      expect(result.width * result.height).toBeLessThanOrEqual(1_000_000);
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1600);
      expect(result.width).toBeLessThanOrEqual(width);
      expect(result.height).toBeLessThanOrEqual(height);
      expect(Math.abs(result.width / result.height - width / height)).toBeLessThan(0.1);
    }
    expect(fitImportAiImage(800, 600)).toEqual({ width: 800, height: 600 });
    expect(() => fitImportAiImage(0, 100)).toThrow();
  });
});
