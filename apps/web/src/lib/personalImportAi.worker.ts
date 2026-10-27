import type { PreTrainedModel, RawImage } from '@huggingface/transformers';
import {
  IMPORT_AI_CACHE_NAME,
  IMPORT_AI_MAX_IMAGE_BYTES,
  IMPORT_AI_MAX_INPUT_TOKENS,
  IMPORT_AI_MAX_OUTPUT_TOKENS,
  IMPORT_AI_MODEL_ID,
  IMPORT_AI_MODEL_REVISION,
  IMPORT_AI_WASM_ROOT,
  fitImportAiImage,
  isImportAiAssetUrl,
  type PersonalImportAiWorkerRequest,
  type PersonalImportAiWorkerResponse,
} from './personalImportAiConfig';

type WorkerScope = {
  location: { origin: string };
  navigator: {
    gpu?: {
      requestAdapter: (options?: { powerPreference: string }) => Promise<{
        features: { has: (feature: string) => boolean };
        limits: { maxBufferSize: number; maxStorageBufferBindingSize: number };
      } | null>;
    };
  };
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: PersonalImportAiWorkerResponse) => void;
};

const scope = self as unknown as WorkerScope;
let busy = false;

class ImportRecognitionError extends Error {}

function tokenId(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'bigint') return -1;
  const token = Number(value);
  return Number.isSafeInteger(token) && token >= 0 ? token : -1;
}

function progress(id: number, message: string): void {
  scope.postMessage({ type: 'progress', id, message });
}

function userMessage(error: unknown): string {
  if (error instanceof ImportRecognitionError) return error.message;
  const message = error instanceof Error ? error.message : '';
  if (
    /out of memory|memory allocation|allocation failed|buffer.*size|device.*lost/i.test(message)
  ) {
    return '這台裝置目前沒有足夠的記憶體完成 AI 辨識。請關閉其他分頁後重試，或改用電腦開啟。';
  }
  if (/fetch|network|download|failed to load|connection|load failed/i.test(message)) {
    return '辨識模型尚未下載完成。請確認網路連線後重試，已快取的模型檔會保留。';
  }
  return '這次 AI 辨識未完成。請重試，或先用文字／檔案匯入後檢查內容。';
}

async function ensureDeviceSupport(): Promise<void> {
  const adapter = await scope.navigator.gpu?.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter?.features.has('shader-f16')) {
    throw new ImportRecognitionError(
      '目前瀏覽器無法執行這個 AI 辨識模型。請改用支援 WebGPU 的較新瀏覽器或電腦。',
    );
  }
  if (
    adapter.limits.maxBufferSize < 256 * 1024 * 1024 ||
    adapter.limits.maxStorageBufferBindingSize < 128 * 1024 * 1024
  ) {
    throw new ImportRecognitionError(
      '這台裝置的圖形記憶體限制不足以執行 AI 辨識，請改用電腦開啟。',
    );
  }
}

async function validateImage(file: File): Promise<void> {
  if (!(file instanceof Blob) || !file.size || file.size > IMPORT_AI_MAX_IMAGE_BYTES) {
    throw new ImportRecognitionError('請選擇 10 MB 以內的 JPG、PNG 或 WebP 圖片。');
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png =
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes[0] === 82 &&
    bytes[1] === 73 &&
    bytes[2] === 70 &&
    bytes[3] === 70 &&
    bytes[8] === 87 &&
    bytes[9] === 69 &&
    bytes[10] === 66 &&
    bytes[11] === 80;
  if (!png && !jpeg && !webp) {
    throw new ImportRecognitionError('請使用 JPG、PNG 或 WebP 圖片；其他格式可先轉成截圖再匯入。');
  }
}

async function decodeImage(file: File, RawImageClass: typeof RawImage): Promise<RawImage> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new ImportRecognitionError('這個瀏覽器目前無法在背景讀取圖片，請更新瀏覽器或改用電腦。');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImportRecognitionError('圖片無法開啟，請重新截圖或轉成 JPG／PNG 後再試。');
  }
  try {
    if (bitmap.width * bitmap.height > 24_000_000) {
      throw new ImportRecognitionError('圖片解析度過大，請截取要匯入的表格後再試。');
    }
    const size = fitImportAiImage(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new ImportRecognitionError('無法讀取圖片，請重新開啟頁面後再試。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const image = RawImageClass.fromCanvas(canvas).rgb();
    canvas.width = 1;
    canvas.height = 1;
    return image;
  } finally {
    bitmap.close();
  }
}

async function recognize(request: PersonalImportAiWorkerRequest): Promise<string> {
  await ensureDeviceSupport();
  if (!request.prompt.trim() || request.prompt.length > 32_000) {
    throw new ImportRecognitionError('這次的資料過長或沒有可辨識內容，請分批匯入。');
  }
  if (request.image) await validateImage(request.image);

  progress(request.id, '正在準備這台裝置的 AI 辨識');
  const {
    env,
    AutoProcessor,
    Qwen3VLForConditionalGeneration,
    RawImage: RawImageClass,
    Tensor,
  } = await import('@huggingface/transformers');

  // This worker owns its environment; no main-thread model settings are changed.
  const fetchAsset = env.fetch;
  env.fetch = (input: string | URL, init?: RequestInit) => {
    if (
      (init?.method ?? 'GET').toUpperCase() !== 'GET' ||
      init?.body != null ||
      !isImportAiAssetUrl(input, scope.location.origin)
    ) {
      return Promise.reject(
        new ImportRecognitionError('AI 辨識資源設定不正確，請重新整理頁面後再試。'),
      );
    }
    return fetchAsset(input, {
      ...init,
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  };
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = 'https://huggingface.co/';
  // The SDK's tokenizer metadata probe does not forward the revision option.
  // Pin the path template too so every probe and download uses the same snapshot.
  env.remotePathTemplate = `{model}/resolve/${IMPORT_AI_MODEL_REVISION}/`;
  env.useFS = false;
  env.useFSCache = false;
  env.useCustomCache = false;
  env.experimental_useCrossOriginStorage = false;
  env.cacheKey = IMPORT_AI_CACHE_NAME;
  env.useBrowserCache = typeof caches !== 'undefined';
  // A self-hosted module keeps script-src limited to this origin. The default
  // WASM cache loads a blob script and the default runtime URL is a third-party CDN.
  env.useWasmCache = false;
  const wasm = env.backends.onnx.wasm;
  if (!wasm) throw new ImportRecognitionError('AI 辨識引擎無法啟動，請重新開啟頁面後再試。');
  wasm.numThreads = 1;
  wasm.proxy = false;
  const wasmUrl = new URL(
    `${IMPORT_AI_WASM_ROOT}ort-wasm-simd-threaded.asyncify.wasm`,
    scope.location.origin,
  ).href;
  const moduleUrl = new URL(
    `${IMPORT_AI_WASM_ROOT}ort-wasm-simd-threaded.asyncify.mjs`,
    scope.location.origin,
  ).href;
  wasm.wasmPaths = { wasm: wasmUrl, mjs: moduleUrl };

  // Check the small runtime before starting a large model download. File bytes and
  // prompt text never enter a network request; only fixed model assets are fetched.
  const runtimeResponse = await env.fetch(wasmUrl);
  if (
    !runtimeResponse.ok ||
    !runtimeResponse.headers.get('content-type')?.includes('application/wasm')
  ) {
    throw new ImportRecognitionError('網站尚未備妥 AI 辨識引擎，請稍後重試。');
  }
  wasm.wasmBinary = await runtimeResponse.arrayBuffer();

  let model: PreTrainedModel | undefined;
  let image: RawImage | undefined;
  try {
    if (request.image) image = await decodeImage(request.image, RawImageClass);
    progress(request.id, '正在檢查資料範圍；這一步只需要前處理資源，尚未載入完整模型');
    let lastProgressAt = 0;
    let downloaded = 0;
    const fileProgress = new Map<string, number>();
    const onProgress = (info: {
      status?: string;
      file?: string;
      loaded?: number;
      total?: number;
      progress?: number;
    }) => {
      if (info.status !== 'progress' && info.status !== 'progress_total') return;
      if (info.file && Number.isFinite(info.loaded)) fileProgress.set(info.file, info.loaded ?? 0);
      downloaded = Math.max(
        downloaded,
        info.loaded ?? 0,
        [...fileProgress.values()].reduce((sum, value) => sum + value, 0),
      );
      if (Date.now() - lastProgressAt < 300) return;
      lastProgressAt = Date.now();
      progress(request.id, `正在下載辨識模型（已接收 ${Math.round(downloaded / 1_000_000)} MB）`);
    };
    const processor = await AutoProcessor.from_pretrained(IMPORT_AI_MODEL_ID, {
      revision: IMPORT_AI_MODEL_REVISION,
      progress_callback: onProgress,
    });
    const content = image
      ? [{ type: 'image' }, { type: 'text', text: request.prompt }]
      : [{ type: 'text', text: request.prompt }];
    const text = processor.apply_chat_template([{ role: 'user', content }], {
      add_generation_prompt: true,
      tokenize: false,
    });
    const inputs = await processor(text, image);
    const inputIds: unknown = inputs.input_ids;
    if (
      !(inputIds instanceof Tensor) ||
      inputIds.dims.length !== 2 ||
      inputIds.dims[0] !== 1 ||
      !Number.isSafeInteger(inputIds.dims[1]) ||
      inputIds.dims[1] < 1 ||
      inputIds.dims[1] > IMPORT_AI_MAX_INPUT_TOKENS ||
      inputIds.data.length !== inputIds.dims[1]
    ) {
      throw new ImportRecognitionError('這次的資料超出單次辨識範圍，請分成較小的圖片或文字段落。');
    }
    // Snapshot before awaiting model code: a runtime may reuse or mutate the
    // input tensor during generation. Never read its live length to slice output.
    const inputLength = inputIds.dims[1];
    const inputPrefix = Array.from({ length: inputLength }, (_, index) =>
      tokenId(inputIds.data[index]),
    );
    if (inputPrefix.some((token) => token < 0))
      throw new ImportRecognitionError('AI 輸入格式不完整，請重新選擇來源後再試。');
    // Tokenization includes the image tokens. Reject an oversized or malformed
    // request before allocating GPU sessions or downloading the model weights.
    progress(request.id, '資料範圍檢查完成，正在載入辨識模型；已下載的檔案會使用裝置快取');
    model = await Qwen3VLForConditionalGeneration.from_pretrained(IMPORT_AI_MODEL_ID, {
      revision: IMPORT_AI_MODEL_REVISION,
      device: 'webgpu',
      dtype: {
        embed_tokens: 'q4f16',
        vision_encoder: 'fp16',
        decoder_model_merged: 'q4f16',
      },
      progress_callback: onProgress,
    });
    progress(
      request.id,
      image ? 'AI 正在對照圖片中的欄位、日期與內容' : 'AI 正在整理欄位、日期與內容',
    );
    const output: unknown = await model.generate({
      ...inputs,
      max_new_tokens: IMPORT_AI_MAX_OUTPUT_TOKENS,
      do_sample: false,
      return_dict_in_generate: false,
    });
    if (
      !(output instanceof Tensor) ||
      output.dims.length !== 2 ||
      output.dims[0] !== 1 ||
      !Number.isSafeInteger(output.dims[1]) ||
      output.dims[1] <= inputLength ||
      output.dims[1] > inputLength + IMPORT_AI_MAX_OUTPUT_TOKENS ||
      output.data.length !== output.dims[1]
    )
      throw new ImportRecognitionError('AI 沒有傳回完整且可讀取的辨識結果，草稿仍保留，請重試。');
    // Decoder-only generation must return this request's input prefix. A shape
    // mismatch or another sequence must never be decoded into a plausible draft.
    for (let index = 0; index < output.dims[1]; index++) {
      const token = tokenId(output.data[index]);
      if (token < 0)
        throw new ImportRecognitionError('AI 回傳的序列格式不完整，草稿仍保留，請重試。');
      if (index < inputLength && token !== inputPrefix[index])
        throw new ImportRecognitionError('AI 回傳結果與這次來源不一致，草稿仍保留，請重試。');
    }
    const generated = output.slice(null, [inputLength, output.dims[1]]);
    const eosConfig = model.generation_config?.eos_token_id ?? [151645, 151643];
    const eos = Array.isArray(eosConfig) ? eosConfig : [eosConfig];
    const lastToken = Number(generated.data[generated.data.length - 1]);
    if (generated.dims[1] >= IMPORT_AI_MAX_OUTPUT_TOKENS && !eos.includes(lastToken)) {
      throw new ImportRecognitionError(
        '資料太多，AI 尚未辨識完整。請把圖片分成兩張或分批匯入；這次沒有儲存任何資料。',
      );
    }
    const raw = processor.batch_decode(generated, { skip_special_tokens: true })[0]?.trim();
    if (!raw)
      throw new ImportRecognitionError('AI 沒有讀到可辨識的資料，請換一張清晰圖片或貼上原始文字。');
    return raw;
  } finally {
    image?.data.fill(0);
    await model?.dispose().catch(() => undefined);
  }
}

scope.onmessage = (event) => {
  const request = event.data as Partial<PersonalImportAiWorkerRequest> | null;
  if (!request || request.type !== 'recognize' || !Number.isSafeInteger(request.id)) return;
  const id = request.id as number;
  if (busy || typeof request.prompt !== 'string') {
    scope.postMessage({
      type: 'error',
      id,
      message: busy ? 'AI 正在處理上一份資料，請稍候。' : '匯入內容不完整，請重新選擇資料。',
    });
    return;
  }
  busy = true;
  void recognize(request as PersonalImportAiWorkerRequest)
    .then((raw) => scope.postMessage({ type: 'result', id, raw }))
    .catch((error: unknown) =>
      scope.postMessage({ type: 'error', id, message: userMessage(error) }),
    )
    .finally(() => {
      busy = false;
    });
};
