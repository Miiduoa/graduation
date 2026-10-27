export const IMPORT_AI_MODEL_ID = 'onnx-community/Qwen3-VL-2B-Instruct-ONNX';
// Pin the processor, tokenizer and weights to one reviewed snapshot.
export const IMPORT_AI_MODEL_REVISION = '5dc9194ba42fa62c2f1440d98a71f7cd5280afe2';
export const IMPORT_AI_DOWNLOAD_LABEL = '約 1.9 GB，建議使用 Wi-Fi';
export const IMPORT_AI_ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';
export const IMPORT_AI_CACHE_NAME = 'campus-personal-import-ai-v1';
export const IMPORT_AI_WASM_ROOT = `/ai/onnxruntime/${IMPORT_AI_ORT_VERSION}/`;
export const IMPORT_AI_MAX_OUTPUT_TOKENS = 4096;
export const IMPORT_AI_MAX_INPUT_TOKENS = 8192;
export const IMPORT_AI_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type PersonalImportAiWorkerRequest = {
  type: 'recognize';
  id: number;
  prompt: string;
  image?: File;
};

export type PersonalImportAiWorkerResponse =
  | { type: 'progress'; id: number; message: string }
  | { type: 'result'; id: number; raw: string }
  | { type: 'error'; id: number; message: string };

const modelAssetNames = new Set([
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'preprocessor_config.json',
  'processor_config.json',
  'chat_template.jinja',
  'chat_template.json',
  'onnx/embed_tokens_q4f16.onnx',
  'onnx/embed_tokens_q4f16.onnx_data',
  'onnx/vision_encoder_fp16.onnx',
  'onnx/vision_encoder_fp16.onnx_data',
  'onnx/decoder_model_merged_q4f16.onnx',
  'onnx/decoder_model_merged_q4f16.onnx_data',
]);

const wasmAssetNames = new Set([
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
]);

/** Only fixed model assets and the matching, self-hosted runtime may be requested. */
export function isImportAiAssetUrl(input: string | URL, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash || url.search) return false;
  if (url.origin === origin && url.pathname.startsWith(IMPORT_AI_WASM_ROOT)) {
    return wasmAssetNames.has(url.pathname.slice(IMPORT_AI_WASM_ROOT.length));
  }
  const modelRoot = `/${IMPORT_AI_MODEL_ID}/resolve/${IMPORT_AI_MODEL_REVISION}/`;
  return (
    url.origin === 'https://huggingface.co' &&
    url.pathname.startsWith(modelRoot) &&
    modelAssetNames.has(url.pathname.slice(modelRoot.length))
  );
}

/** Keep the complete page, retaining its proportions, within the vision budget. */
export function fitImportAiImage(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('圖片尺寸無效，請重新選擇圖片。');
  }
  const scale = Math.min(
    1,
    1600 / Math.max(width, height),
    Math.sqrt(1_000_000 / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
