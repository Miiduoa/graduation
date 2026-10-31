/**
 * 本地 LLM 推理引擎 — On-Device Large Language Model Inference
 * ═══════════════════════════════════════════════════════════════
 * 使用 llama.rn (llama.cpp React Native binding) 在裝置端運行 GGUF 模型
 * 完全不依賴任何外部 API，所有推理在本地完成。
 *
 * 支援模型：
 *  - Qwen2.5-7B-Instruct (Q4_K_M) — 進階模型，中英文最強 (~4.7GB)
 *  - Mistral-7B-Instruct-v0.3 (Q4_K_M) — 進階備選，推理能力頂尖 (~4.4GB)
 *  - Qwen2.5-3B-Instruct (Q4_K_M) — 主力模型，中英文優秀
 *  - Phi-3.5-mini-instruct (Q4_K_M) — 備用，推理能力強
 *  - SmolLM2-1.7B-Instruct (Q4_K_M) — 輕量備用
 *
 * 核心功能：
 *  1. 模型下載 + 快取管理
 *  2. Context window 管理（滑動窗口 + 壓縮）
 *  3. Token streaming 逐字輸出
 *  4. 多輪對話支援
 *  5. 系統提示詞注入
 *  6. 結構化輸出解析（JSON / Tool Call）
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import type { LlamaContext, TokenData } from 'llama.rn';
import { formatLocalModelChat, defaultLocalStopSequences } from './localLLMChatPrompt';

// Expo FileSystem compat
const getDocDir = () => FileSystem.documentDirectory ?? 'file:///data/user/0/app/';

// ═══════════════════════════════════════════════════
// Types & Configuration
// ═══════════════════════════════════════════════════

export interface LLMConfig {
  modelId: string;
  modelUrl: string;
  modelFileName: string;
  modelSize: number; // bytes
  contextLength: number;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  threads: number; // CPU threads for inference
  gpuLayers: number; // Metal/GPU layers (iOS)
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string; // tool name for tool messages
}

export interface LLMGenerateOptions {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  jsonMode?: boolean;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

export interface LLMGenerateResult {
  content: string;
  tokensGenerated: number;
  tokensPerSecond: number;
  finishReason: 'stop' | 'length' | 'error';
  totalTimeMs: number;
}

export interface ModelDownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
}

export type LLMStatus =
  | 'uninitialized'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'error';

export interface LLMState {
  status: LLMStatus;
  error?: string;
  modelId?: string;
  downloadProgress?: ModelDownloadProgress;
  tokensPerSecond?: number;
}

export interface LLMRuntimeAvailability {
  available: boolean;
  reason?: string;
}

// ═══════════════════════════════════════════════════
// Model Registry — 支援的本地模型
// ═══════════════════════════════════════════════════

export const MODEL_REGISTRY: Record<string, LLMConfig> = {
  // 低門檻、可在一般手機上試用的免費 GGUF（下載後只在裝置端推論）
  'qwen2.5-0.5b': {
    modelId: 'qwen2.5-0.5b',
    modelUrl:
      'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    modelFileName: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    modelSize: 398_000_000,
    contextLength: 2048,
    maxTokens: 512,
    temperature: 0.45,
    topP: 0.9,
    topK: 30,
    repeatPenalty: 1.12,
    threads: 4,
    gpuLayers: 99,
  },
  // Optional 1.7B on-device model; native compatibility must be checked on
  // a real iOS/Android build before changing the default model.
  'qwen3-1.7b': {
    modelId: 'qwen3-1.7b',
    modelUrl:
      'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    modelFileName: 'Qwen3-1.7B-Q4_K_M.gguf',
    modelSize: 1_280_000_000,
    contextLength: 4096,
    maxTokens: 1024,
    temperature: 0.5,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.08,
    threads: 4,
    gpuLayers: 99,
  },
  // ── 進階模型 (~4-5GB) — 7B 參數級 ──
  'qwen2.5-7b': {
    modelId: 'qwen2.5-7b',
    modelUrl:
      'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    modelFileName: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    modelSize: 4_680_000_000, // ~4.68GB
    contextLength: 4096,
    maxTokens: 2048,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1,
    threads: 4,
    gpuLayers: 99,
  },
  'mistral-7b-v0.3': {
    modelId: 'mistral-7b-v0.3',
    modelUrl:
      'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    modelFileName: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    modelSize: 4_370_000_000, // ~4.37GB
    contextLength: 4096,
    maxTokens: 2048,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1,
    threads: 4,
    gpuLayers: 99,
  },
  // ── 標準模型 (~1-2.5GB) — 3B 參數級 ──
  'qwen2.5-3b': {
    modelId: 'qwen2.5-3b',
    modelUrl:
      'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    modelFileName: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    modelSize: 2_100_000_000, // ~2.1GB
    contextLength: 4096,
    maxTokens: 2048,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1,
    threads: 4,
    gpuLayers: 99, // offload all to Metal on iOS
  },
  'phi-3.5-mini': {
    modelId: 'phi-3.5-mini',
    modelUrl:
      'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
    modelFileName: 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
    modelSize: 2_400_000_000, // ~2.4GB
    contextLength: 4096,
    maxTokens: 2048,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1,
    threads: 4,
    gpuLayers: 99,
  },
  'smollm2-1.7b': {
    modelId: 'smollm2-1.7b',
    modelUrl:
      'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf',
    modelFileName: 'smollm2-1.7b-instruct-q4_k_m.gguf',
    modelSize: 1_100_000_000, // ~1.1GB
    contextLength: 2048,
    maxTokens: 1024,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1,
    threads: 4,
    gpuLayers: 99,
  },
};

function readExpoExtra(): Record<string, unknown> {
  const ex =
    (Constants.expoConfig as { extra?: Record<string, unknown> } | undefined)?.extra ??
    (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra;
  return ex ?? {};
}

/** 預設輕量免費模型；進階裝置可在模型管理頁選擇大模型。 */
export function getDefaultLocalLlmModelId(): string {
  const extra = readExpoExtra();
  const fromExtra = String(extra.localLlmDefaultModelId ?? '').trim();
  if (fromExtra && MODEL_REGISTRY[fromExtra]) return fromExtra;
  const fromEnv = String(process.env.EXPO_PUBLIC_LOCAL_LLM_MODEL ?? '').trim();
  if (fromEnv && MODEL_REGISTRY[fromEnv]) return fromEnv;
  return 'qwen2.5-0.5b';
}

// Storage keys
const STORAGE_KEYS = {
  activeModel: '@local_llm:active_model',
  modelReady: '@local_llm:model_ready',
  inferenceStats: '@local_llm:stats',
};

// ═══════════════════════════════════════════════════
// LLM Runtime — llama.rn 封裝層
// ═══════════════════════════════════════════════════

type LlamaRNExports = typeof import('llama.rn');

const RUNTIME_UNAVAILABLE_MESSAGE =
  '本地 AI 原生模組尚未載入。請重新安裝或重建包含 llama.rn 的開發版 App 後再啟用模型。';
const DOWNLOAD_UNAVAILABLE_MESSAGE =
  '目前環境無法使用本地 AI 模型下載。請改用已安裝 llama.rn 的開發版 App，不要使用 Expo Go。';
const HF_DOWNLOAD_HEADERS = {
  Accept: 'application/octet-stream',
  'User-Agent': 'CampusAI-App/1.0',
};

let cachedLlamaModule: Partial<LlamaRNExports> | null | undefined;

function getNativeRNLlamaModule(): unknown {
  try {
    const turboModule = (TurboModuleRegistry as any)?.get?.('RNLlama');
    return turboModule ?? NativeModules.RNLlama ?? null;
  } catch {
    return NativeModules.RNLlama ?? null;
  }
}

function loadLlamaModule(): Partial<LlamaRNExports> | null {
  if (cachedLlamaModule !== undefined) return cachedLlamaModule;

  try {
    cachedLlamaModule = require('llama.rn') as Partial<LlamaRNExports>;
  } catch (e) {
    console.warn('[LocalLLM] Failed to load llama.rn JS module:', e);
    cachedLlamaModule = null;
  }

  return cachedLlamaModule;
}

function getRuntimeAvailability(): LLMRuntimeAvailability {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return {
      available: false,
      reason: '本地 AI 只支援 iOS / Android 原生 App。',
    };
  }

  if (!getNativeRNLlamaModule()) {
    return {
      available: false,
      reason: RUNTIME_UNAVAILABLE_MESSAGE,
    };
  }

  const llamaModule = loadLlamaModule();
  if (typeof llamaModule?.initLlama !== 'function') {
    return {
      available: false,
      reason: '本地 AI JavaScript 模組尚未正確載入，請重新啟動 App 後再試。',
    };
  }

  return { available: true };
}

function normalizeLoadModelError(error: any): string {
  const message = String(error?.message ?? error ?? '未知錯誤');
  if (/initLlama|initContext|RNLlama|NativeModule|TurboModule|native module/i.test(message)) {
    return RUNTIME_UNAVAILABLE_MESSAGE;
  }
  return `模型載入失敗：${message}`;
}

function normalizeDownloadModelError(error: any): string {
  const message = String(error?.message ?? error ?? '未知錯誤');
  if (
    /NSURLErrorDomain|Unable to download file|Network request failed|timed out|not connected/i.test(
      message,
    )
  ) {
    return '模型下載失敗：無法連線到 Hugging Face 下載伺服器。請確認 Wi-Fi 穩定，或稍後再重試。';
  }
  if (/space|storage|No space/i.test(message)) {
    return '模型下載失敗：儲存空間不足，請清理裝置空間後重試。';
  }
  return `模型下載失敗：${message}`;
}

async function resolveDownloadUrl(cfg: LLMConfig): Promise<string> {
  const response = await fetch(cfg.modelUrl, {
    method: 'HEAD',
    headers: HF_DOWNLOAD_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`下載伺服器回應 HTTP ${response.status}`);
  }

  return response.url || cfg.modelUrl;
}

// ═══════════════════════════════════════════════════
// Core Engine Class
// ═══════════════════════════════════════════════════

class LocalLLMEngine {
  private context: LlamaContext | null = null;
  private config: LLMConfig | null = null;
  private state: LLMState = { status: 'uninitialized' };
  private listeners: Set<(state: LLMState) => void> = new Set();
  private conversationHistory: LLMMessage[] = [];
  private abortController: AbortController | null = null;
  private activeDownload: {
    modelId: string;
    task: ReturnType<typeof FileSystem.createDownloadResumable> | null;
    cancelled: boolean;
  } | null = null;

  // ── State Management ──

  getState(): LLMState {
    return { ...this.state };
  }

  /** Identity of the context actually in memory, independent of saved preference. */
  getLoadedModelId(): string | null {
    return this.context && this.config ? this.config.modelId : null;
  }

  getRuntimeAvailability(): LLMRuntimeAvailability {
    return getRuntimeAvailability();
  }

  subscribe(listener: (state: LLMState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<LLMState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => {
      try {
        l(this.state);
      } catch {}
    });
  }

  // 輕量 GGUF 需要較嚴格的檔案長度驗證，避免下載錯誤頁或截斷檔被標成完成。
  private isCompleteModelFile(config: LLMConfig, size: unknown): boolean {
    if (typeof size !== 'number' || !Number.isFinite(size)) return false;
    const tolerance = config.modelId === 'qwen2.5-0.5b' ? 0.97 : 0.9;
    return size >= config.modelSize * tolerance;
  }

  // ── Model Management ──

  /**
   * 取得使用者最後啟用或下載成功的模型。
   */
  async getSavedModelId(): Promise<string | null> {
    try {
      const activeModelId = await AsyncStorage.getItem(STORAGE_KEYS.activeModel);
      if (activeModelId && MODEL_REGISTRY[activeModelId]) {
        return activeModelId;
      }

      const readyRaw = await AsyncStorage.getItem(STORAGE_KEYS.modelReady);
      if (readyRaw) {
        const ready = JSON.parse(readyRaw);
        if (ready?.modelId && MODEL_REGISTRY[ready.modelId]) {
          return ready.modelId;
        }
      }
    } catch {}

    return null;
  }

  /**
   * 記錄使用者選用的模型，不強制立即載入到記憶體。
   */
  async setActiveModel(modelId: string): Promise<boolean> {
    const cfg = MODEL_REGISTRY[modelId];
    if (!cfg) {
      this.setState({ status: 'error', error: `Unknown model: ${modelId}` });
      return false;
    }

    await AsyncStorage.setItem(STORAGE_KEYS.activeModel, cfg.modelId);
    // Selecting a preference does not hot-swap an already loaded native model.
    // Keep state.modelId tied to the actual llama context until loadModel succeeds.
    this.setState({ error: undefined });
    return true;
  }

  /**
   * 取得模型檔案在裝置上的路徑
   */
  private getModelPath(config: LLMConfig): string {
    return `${getDocDir()}models/${config.modelFileName}`;
  }

  /**
   * 檢查模型是否已下載
   */
  async isModelDownloaded(modelId?: string): Promise<boolean> {
    const cfg = MODEL_REGISTRY[modelId ?? getDefaultLocalLlmModelId()];
    if (!cfg) return false;
    const path = this.getModelPath(cfg);
    try {
      const info = await FileSystem.getInfoAsync(path);
      return info.exists && this.isCompleteModelFile(cfg, (info as { size?: number }).size);
    } catch {
      return false;
    }
  }

  /**
   * 下載模型到本地（可取消；重新下載會重新開始）
   */
  async downloadModel(
    modelId?: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ): Promise<boolean> {
    const cfg = MODEL_REGISTRY[modelId ?? getDefaultLocalLlmModelId()];
    if (!cfg) {
      this.setState({ status: 'error', error: `Unknown model: ${modelId}` });
      return false;
    }

    // Claim a single download before any awaits. Other screens share this engine.
    if (this.activeDownload || ['generating', 'loading', 'downloading'].includes(this.state.status)) {
      return false;
    }
    const runtimeAvailability = getRuntimeAvailability();
    if (!runtimeAvailability.available) {
      this.setState({
        status: 'error',
        modelId: cfg.modelId,
        error: runtimeAvailability.reason ?? DOWNLOAD_UNAVAILABLE_MESSAGE,
        downloadProgress: undefined,
      });
      return false;
    }
    const operation = {
      modelId: cfg.modelId,
      task: null as ReturnType<typeof FileSystem.createDownloadResumable> | null,
      cancelled: false,
    };
    this.activeDownload = operation;
    const modelDir = `${getDocDir()}models/`;
    const modelPath = this.getModelPath(cfg);
    this.setState({ status: 'downloading', modelId: cfg.modelId, error: undefined, downloadProgress: undefined });

    try {
      const dirInfo = await FileSystem.getInfoAsync(modelDir);
      if (operation.cancelled) throw new Error('model-download-cancelled');
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
      }
      if (operation.cancelled) throw new Error('model-download-cancelled');
      const existingInfo = await FileSystem.getInfoAsync(modelPath);
      if (operation.cancelled) throw new Error('model-download-cancelled');
      if (existingInfo.exists) {
        if (this.isCompleteModelFile(cfg, (existingInfo as { size?: number }).size)) {
          await AsyncStorage.setItem(
            STORAGE_KEYS.modelReady,
            JSON.stringify({ modelId: cfg.modelId, downloadedAt: Date.now() }),
          );
          if (operation.cancelled) throw new Error('model-download-cancelled');
          this.setState({ status: 'uninitialized', downloadProgress: undefined });
          return true;
        }
        await FileSystem.deleteAsync(modelPath, { idempotent: true });
        if (operation.cancelled) throw new Error('model-download-cancelled');
      }

      // 先 resolve Hugging Face/Xet 的 signed URL，避免 iOS FileSystem 在大檔 redirect 時回傳 NSURLErrorDomain -1。
      const downloadUrl = await resolveDownloadUrl(cfg);
      if (operation.cancelled) throw new Error('model-download-cancelled');

      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        modelPath,
        {
          headers: HF_DOWNLOAD_HEADERS,
        },
        (downloadProgress) => {
          if (operation.cancelled) return;
          const progress: ModelDownloadProgress = {
            bytesDownloaded: downloadProgress.totalBytesWritten,
            totalBytes: downloadProgress.totalBytesExpectedToWrite,
            percent:
              downloadProgress.totalBytesExpectedToWrite > 0
                ? Math.round(
                    (downloadProgress.totalBytesWritten /
                      downloadProgress.totalBytesExpectedToWrite) *
                      100,
                  )
                : 0,
          };
          this.setState({ downloadProgress: progress });
          onProgress?.(progress);
        },
      );

      operation.task = downloadResumable;
      if (operation.cancelled) throw new Error('model-download-cancelled');
      console.log(`[LocalLLM] Starting download: ${cfg.modelUrl}`);
      console.log(`[LocalLLM] Saving to: ${modelPath}`);

      const result = await downloadResumable.downloadAsync();
      if (operation.cancelled) throw new Error('model-download-cancelled');
      if (!result) {
        throw new Error('下載回傳 null — 可能是網路連線中斷或 URL 無效');
      }

      console.log(`[LocalLLM] Download complete: status=${result.status}, uri=${result.uri}`);
      if (result.status < 200 || result.status >= 300) {
        await FileSystem.deleteAsync(modelPath, { idempotent: true });
        throw new Error(`下載伺服器回應 HTTP ${result.status}`);
      }
      const downloaded = await FileSystem.getInfoAsync(modelPath);
      if (!downloaded.exists || !this.isCompleteModelFile(cfg, (downloaded as { size?: number }).size)) {
        await FileSystem.deleteAsync(modelPath, { idempotent: true });
        throw new Error('下載檔案不完整或大小異常，未安裝模型');
      }


      if (operation.cancelled) throw new Error('model-download-cancelled');
      await AsyncStorage.setItem(
        STORAGE_KEYS.modelReady,
        JSON.stringify({ modelId: cfg.modelId, downloadedAt: Date.now() }),
      );
      if (operation.cancelled) throw new Error('model-download-cancelled');
      this.setState({ status: 'uninitialized', downloadProgress: undefined });
      return true;
    } catch (e: any) {
      if (operation.cancelled) {
        // Cancellation is not an error and never marks a partial GGUF as installed.
        if (operation.task) {
          await FileSystem.deleteAsync(modelPath, { idempotent: true }).catch(() => {});
        }
        this.setState({ status: 'uninitialized', modelId: cfg.modelId, error: undefined, downloadProgress: undefined });
        return false;
      }
      console.warn(`[LocalLLM] Download failed (${cfg.modelId}):`, e?.message ?? e);
      const userMsg = normalizeDownloadModelError(e);
      this.setState({
        status: 'error',
        modelId: cfg.modelId,
        error: userMsg,
        downloadProgress: undefined,
      });
      return false;
    } finally {
      if (this.activeDownload === operation) this.activeDownload = null;
    }
  }

  /** Stop the native HTTP transfer, not a text-generation request. */
  async cancelDownload(modelId?: string): Promise<boolean> {
    const operation = this.activeDownload;
    if (!operation || (modelId && operation.modelId !== modelId)) return false;
    operation.cancelled = true;
    if (operation.task) {
      try {
        await operation.task.cancelAsync();
      } catch (error) {
        // downloadAsync will also settle and run cleanup. Do not claim success.
        console.warn('[LocalLLM] Download cancellation request failed:', error);
      }
    }
    return true;
  }

  /**
   * 載入模型到記憶體（初始化 llama context）
   */
  async loadModel(modelId?: string): Promise<boolean> {
    const cfg = MODEL_REGISTRY[modelId ?? getDefaultLocalLlmModelId()];
    if (!cfg) {
      this.setState({ status: 'error', error: `Unknown model: ${modelId}` });
      return false;
    }
    if (this.activeDownload || ['generating', 'loading', 'downloading'].includes(this.state.status)) {
      return false;
    }
    if (this.state.status === 'ready' && this.config?.modelId === cfg.modelId && this.context) {
      return true;
    }
    // Claim the loading slot before any async filesystem work.
    this.setState({ status: 'loading', modelId: cfg.modelId, error: undefined });

    // 檢查模型檔案；I/O 失敗不能永久卡在 loading。
    const modelPath = this.getModelPath(cfg);
    try {
      const fileInfo = await FileSystem.getInfoAsync(modelPath);
    if (!fileInfo.exists) {
      this.setState({
        status: 'error',
        modelId: cfg.modelId,
        error: '找不到模型檔案。請到「本地 AI 模型」重新下載模型。',
      });
      return false;
    }
    if (!this.isCompleteModelFile(cfg, (fileInfo as { size?: number }).size)) {
      this.setState({
        status: 'error',
        modelId: cfg.modelId,
        error: '模型檔案不完整。請刪除後重新下載模型。',
      });
      return false;
    }

      const runtimeAvailability = getRuntimeAvailability();
      if (!runtimeAvailability.available) {
        throw new Error(runtimeAvailability.reason ?? RUNTIME_UNAVAILABLE_MESSAGE);
      }

      const initLlama = loadLlamaModule()?.initLlama;
      if (typeof initLlama !== 'function') {
        throw new Error(RUNTIME_UNAVAILABLE_MESSAGE);
      }

      // 釋放舊 context
      if (this.context) {
        await this.context.release();
        this.context = null;
      }

      // 使用 llama.rn 初始化 context
      console.log(`[LocalLLM] Loading model: ${modelPath}`);
      this.context = await initLlama({
        model: modelPath,
        n_ctx: cfg.contextLength,
        n_threads: cfg.threads,
        // 此版本在 Android 使用 CPU 路徑，避免把 iOS Metal 設定套到不支援的手機。
        n_gpu_layers: Platform.OS === 'ios' ? cfg.gpuLayers : 0,
        use_mlock: true,
        use_mmap: true,
      });

      this.config = cfg;
      this.setState({ status: 'ready', modelId: cfg.modelId });

      // A preference-write failure does not invalidate a loaded native context.
      await AsyncStorage.setItem(STORAGE_KEYS.activeModel, cfg.modelId).catch(() => {});
      return true;
    } catch (e: any) {
      this.setState({
        status: 'error',
        modelId: cfg.modelId,
        error: normalizeLoadModelError(e),
      });
      return false;
    }
  }

  /**
   * 確保模型已就緒（下載 + 載入）
   */
  async ensureReady(
    modelId?: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ): Promise<boolean> {
    const mid = modelId ?? (await this.getSavedModelId()) ?? getDefaultLocalLlmModelId();

    if (this.state.status === 'ready' && this.config?.modelId === mid) {
      return true;
    }

    const downloaded = await this.isModelDownloaded(mid);
    if (!downloaded) {
      const ok = await this.downloadModel(mid, onProgress);
      if (!ok) return false;
    }

    return this.loadModel(mid);
  }

  // ── Inference ──

  /**
   * 將對話格式化為模型能理解的 prompt
   * 使用 ChatML 格式 (Qwen2.5 / Phi-3.5 / SmolLM2 均支援)
   */
  private formatPrompt(messages: LLMMessage[]): string {
    return formatLocalModelChat(messages, this.config?.modelId);
  }

  /**
   * 生成回答（核心推理函式）
   */
  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResult> {
    if (!this.context || !this.config) {
      throw new Error('Model not loaded. Call loadModel() or ensureReady() first.');
    }

    if (this.state.status !== 'ready') {
      throw new Error('Native model is busy. Complete the current operation first.');
    }

    this.setState({ status: 'generating' });
    this.abortController = new AbortController();

    const {
      messages,
      maxTokens = this.config.maxTokens,
      temperature = this.config.temperature,
      topP = this.config.topP,
      stopSequences = defaultLocalStopSequences(this.config.modelId),
      onToken,
      signal,
    } = options;

    // Forward aborts to the native llama context and remove listeners afterwards.
    const onExternalAbort = () => this.abort();
    if (signal) {
      signal.addEventListener('abort', onExternalAbort);
      if (signal.aborted) this.abort();
    }

    const prompt = this.formatPrompt(messages);

    try {
      const startTime = Date.now();
      let generated = '';
      if (this.abortController?.signal.aborted) throw new Error('Aborted');

      const result = await this.context.completion(
        {
          prompt,
          n_predict: maxTokens,
          temperature,
          top_p: topP,
          top_k: this.config.topK,
          penalty_repeat: this.config.repeatPenalty,
          stop: stopSequences,
        },
        (tokenData: TokenData) => {
          if (this.abortController?.signal.aborted) return;
          generated += tokenData.token;
          onToken?.(tokenData.token);
        },
      );

      const totalTimeMs = Date.now() - startTime;
      if (this.abortController?.signal.aborted) {
        this.setState({ status: 'ready' });
        return { content: '', tokensGenerated: 0, tokensPerSecond: 0, finishReason: 'error', totalTimeMs };
      }
      const tps = result.timings?.predicted_per_second ?? 0;

      this.setState({ status: 'ready', tokensPerSecond: tps });

      // 儲存統計
      this.saveStats(tps, result.tokens_predicted, totalTimeMs);

      return {
        content: result.text.trim(),
        tokensGenerated: result.tokens_predicted,
        tokensPerSecond: tps,
        finishReason: result.tokens_predicted >= maxTokens ? 'length' : 'stop',
        totalTimeMs,
      };
    } catch (e: any) {
      if (e.name === 'AbortError' || this.abortController?.signal.aborted) {
        this.setState({ status: 'ready' });
        return {
          content: '',
          tokensGenerated: 0,
          tokensPerSecond: 0,
          finishReason: 'error',
          totalTimeMs: 0,
        };
      }
      this.setState({ status: 'error', error: e.message });
      throw e;
    } finally {
      signal?.removeEventListener('abort', onExternalAbort);
      this.abortController = null;
    }
  }

  /**
   * 中斷目前生成：直接通知 llama.rn 原生引擎停止推論。
   */
  abort() {
    this.abortController?.abort();
    if (this.state.status === 'generating' && this.context) {
      void this.context.stopCompletion().catch((error) => {
        console.warn('[LocalLLM] Native completion stop failed:', error);
      });
    }
  }

  // ── Conversation Management ──

  /**
   * 對話式生成（自動管理歷史記錄）
   */
  async chat(
    userMessage: string,
    systemPrompt?: string,
    onToken?: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<LLMGenerateResult> {
    // 添加系統提示（如果是新對話或系統提示變更）
    if (systemPrompt && this.conversationHistory.length === 0) {
      this.conversationHistory.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    // 添加使用者訊息
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Context window 管理：如果歷史太長，壓縮
    this.compressHistoryIfNeeded();

    const result = await this.generate({
      messages: this.conversationHistory,
      onToken,
      signal,
    });

    // 保存助理回覆
    if (result.content) {
      this.conversationHistory.push({
        role: 'assistant',
        content: result.content,
      });
    }

    return result;
  }

  /**
   * 壓縮對話歷史（保留系統提示 + 最近 N 輪）
   */
  private compressHistoryIfNeeded() {
    const maxTurns = 10; // 保留最近 10 輪
    const systemMsgs = this.conversationHistory.filter((m) => m.role === 'system');
    const nonSystemMsgs = this.conversationHistory.filter((m) => m.role !== 'system');

    if (nonSystemMsgs.length > maxTurns * 2) {
      // 保留最近的對話
      const recent = nonSystemMsgs.slice(-maxTurns * 2);

      // 壓縮較早的對話為摘要
      const older = nonSystemMsgs.slice(0, -maxTurns * 2);
      const summary = this.summarizeMessages(older);

      this.conversationHistory = [
        ...systemMsgs,
        { role: 'system', content: `[對話摘要] ${summary}` },
        ...recent,
      ];
    }
  }

  /**
   * 簡單摘要（提取關鍵資訊）
   */
  private summarizeMessages(messages: LLMMessage[]): string {
    const userMsgs = messages.filter((m) => m.role === 'user').map((m) => m.content.slice(0, 50));
    const topics = userMsgs.join('；');
    return `使用者先前詢問了：${topics}`;
  }

  /**
   * 清除對話歷史
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * 取得目前對話歷史
   */
  getHistory(): LLMMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * 設定對話歷史（用於恢復對話）
   */
  setHistory(messages: LLMMessage[]) {
    this.conversationHistory = [...messages];
  }

  // ── Structured Output ──

  /**
   * 生成 JSON 結構化輸出
   */
  async generateJSON<T = any>(
    messages: LLMMessage[],
    schema?: string,
    signal?: AbortSignal,
  ): Promise<{ data: T | null; raw: string }> {
    const jsonMessages = [...messages];

    // 注入 JSON 指示
    let lastUserIdx = -1;
    for (let i = jsonMessages.length - 1; i >= 0; i--) {
      if (jsonMessages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx >= 0) {
      jsonMessages[lastUserIdx] = {
        ...jsonMessages[lastUserIdx],
        content:
          jsonMessages[lastUserIdx].content +
          `\n\n請以 JSON 格式回覆${schema ? `，格式如下：${schema}` : ''}。只輸出 JSON，不要其他文字。`,
      };
    }

    const result = await this.generate({
      messages: jsonMessages,
      temperature: 0.3, // lower temp for structured output
      signal,
    });

    // 解析 JSON
    try {
      const jsonStr = extractJSON(result.content);
      const data = JSON.parse(jsonStr) as T;
      return { data, raw: result.content };
    } catch {
      return { data: null, raw: result.content };
    }
  }

  // ── Lifecycle ──

  /**
   * 釋放模型資源
   */
  async release() {
    if (this.activeDownload || ['generating', 'loading', 'downloading'].includes(this.state.status)) {
      throw new Error('本地 AI 正在執行其他工作，請完成後再釋放模型。');
    }
    if (this.context) {
      await this.context.release();
      this.context = null;
    }
    this.config = null;
    this.setState({ status: 'uninitialized', modelId: undefined });
  }

  /**
   * 刪除已下載的模型檔案
   */
  async deleteModel(modelId?: string): Promise<void> {
    const cfg = MODEL_REGISTRY[modelId ?? getDefaultLocalLlmModelId()];
    if (!cfg) return;
    if (this.activeDownload || ['generating', 'loading', 'downloading'].includes(this.state.status)) {
      throw new Error('本地 AI 正在使用中，無法刪除模型；請先完成或取消目前的工作。');
    }

    if (this.config?.modelId === cfg.modelId) {
      await this.release();
    }

    const path = this.getModelPath(cfg);
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {}

    try {
      const [activeModelId, readyRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.activeModel),
        AsyncStorage.getItem(STORAGE_KEYS.modelReady),
      ]);
      if (activeModelId === cfg.modelId) {
        await AsyncStorage.removeItem(STORAGE_KEYS.activeModel);
      }
      const ready = readyRaw ? JSON.parse(readyRaw) : null;
      if (ready?.modelId === cfg.modelId) {
        await AsyncStorage.removeItem(STORAGE_KEYS.modelReady);
      }
    } catch {}
  }

  /**
   * 取得已下載模型列表
   */
  async getDownloadedModels(): Promise<string[]> {
    const results: string[] = [];
    for (const [id, cfg] of Object.entries(MODEL_REGISTRY)) {
      const downloaded = await this.isModelDownloaded(id);
      if (downloaded) results.push(id);
    }
    return results;
  }

  // ── Stats ──

  private async saveStats(tps: number, tokensGenerated: number, timeMs: number) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.inferenceStats);
      const stats = raw ? JSON.parse(raw) : { totalInferences: 0, avgTps: 0, totalTokens: 0 };
      stats.totalInferences++;
      stats.totalTokens += tokensGenerated;
      stats.avgTps = (stats.avgTps * (stats.totalInferences - 1) + tps) / stats.totalInferences;
      stats.lastInference = Date.now();
      stats.lastTimeMs = timeMs;
      await AsyncStorage.setItem(STORAGE_KEYS.inferenceStats, JSON.stringify(stats));
    } catch {}
  }

  async getStats(): Promise<{
    totalInferences: number;
    avgTps: number;
    totalTokens: number;
    lastInference?: number;
  }> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.inferenceStats);
      return raw ? JSON.parse(raw) : { totalInferences: 0, avgTps: 0, totalTokens: 0 };
    } catch {
      return { totalInferences: 0, avgTps: 0, totalTokens: 0 };
    }
  }
}

// ═══════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════

/**
 * 從文字中提取 JSON 字串
 */
function extractJSON(text: string): string {
  // 嘗試直接解析
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // 找到最外層的 {}  或 []
    let depth = 0;
    let start = -1;
    const opener = trimmed[0];
    const closer = opener === '{' ? '}' : ']';

    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === opener) {
        if (start === -1) start = i;
        depth++;
      } else if (trimmed[i] === closer) {
        depth--;
        if (depth === 0) {
          return trimmed.slice(start, i + 1);
        }
      }
    }
  }

  // 嘗試從 markdown code block 提取
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // 最後嘗試找 { ... } 或 [ ... ]
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) return jsonMatch[1];

  return text;
}

/**
 * 估算 token 數量（中文約 1.5 字/token，英文約 4 字母/token）
 */
export function estimateTokens(text: string): number {
  let count = 0;
  for (const char of text) {
    if (/[一-鿿㐀-䶿]/.test(char)) {
      count += 1.5; // CJK characters
    } else if (/[a-zA-Z]/.test(char)) {
      count += 0.25; // English letters
    } else {
      count += 0.5; // punctuation, numbers, etc.
    }
  }
  return Math.ceil(count);
}

// ═══════════════════════════════════════════════════
// Singleton Export
// ═══════════════════════════════════════════════════

/** 全域 LLM 引擎實例 */
export const localLLM = new LocalLLMEngine();

export default localLLM;
