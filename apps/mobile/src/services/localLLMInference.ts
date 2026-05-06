/**
 * 本地 LLM 推理引擎 — On-Device Large Language Model Inference
 * ═══════════════════════════════════════════════════════════════
 * 使用 llama.rn (llama.cpp React Native binding) 在裝置端運行 GGUF 模型
 * 完全不依賴任何外部 API，所有推理在本地完成。
 *
 * 支援模型：
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

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { NativeModules, Platform, TurboModuleRegistry } from "react-native";
import type { LlamaContext, TokenData } from "llama.rn";

// Expo FileSystem compat
const getDocDir = () => FileSystem.documentDirectory ?? "file:///data/user/0/app/";

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
  role: "system" | "user" | "assistant" | "tool";
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
  finishReason: "stop" | "length" | "error";
  totalTimeMs: number;
}

export interface ModelDownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
}

export type LLMStatus =
  | "uninitialized"
  | "downloading"
  | "loading"
  | "ready"
  | "generating"
  | "error";

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
  "qwen2.5-3b": {
    modelId: "qwen2.5-3b",
    modelUrl:
      "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
    modelFileName: "qwen2.5-3b-instruct-q4_k_m.gguf",
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
  "phi-3.5-mini": {
    modelId: "phi-3.5-mini",
    modelUrl:
      "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
    modelFileName: "Phi-3.5-mini-instruct-Q4_K_M.gguf",
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
  "smollm2-1.7b": {
    modelId: "smollm2-1.7b",
    modelUrl:
      "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf",
    modelFileName: "smollm2-1.7b-instruct-q4_k_m.gguf",
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

// 預設模型
const DEFAULT_MODEL_ID = "qwen2.5-3b";

// Storage keys
const STORAGE_KEYS = {
  activeModel: "@local_llm:active_model",
  modelReady: "@local_llm:model_ready",
  inferenceStats: "@local_llm:stats",
};

// ═══════════════════════════════════════════════════
// LLM Runtime — llama.rn 封裝層
// ═══════════════════════════════════════════════════

type LlamaRNExports = typeof import("llama.rn");

const RUNTIME_UNAVAILABLE_MESSAGE =
  "本地 AI 原生模組尚未載入。請重新安裝或重建包含 llama.rn 的開發版 App 後再啟用模型。";

let cachedLlamaModule: Partial<LlamaRNExports> | null | undefined;

function getNativeRNLlamaModule(): unknown {
  try {
    const turboModule = (TurboModuleRegistry as any)?.get?.("RNLlama");
    return turboModule ?? NativeModules.RNLlama ?? null;
  } catch {
    return NativeModules.RNLlama ?? null;
  }
}

function loadLlamaModule(): Partial<LlamaRNExports> | null {
  if (cachedLlamaModule !== undefined) return cachedLlamaModule;

  try {
    cachedLlamaModule = require("llama.rn") as Partial<LlamaRNExports>;
  } catch (e) {
    console.warn("[LocalLLM] Failed to load llama.rn JS module:", e);
    cachedLlamaModule = null;
  }

  return cachedLlamaModule;
}

function getRuntimeAvailability(): LLMRuntimeAvailability {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return {
      available: false,
      reason: "本地 AI 只支援 iOS / Android 原生 App。",
    };
  }

  if (!getNativeRNLlamaModule()) {
    return {
      available: false,
      reason: RUNTIME_UNAVAILABLE_MESSAGE,
    };
  }

  const llamaModule = loadLlamaModule();
  if (typeof llamaModule?.initLlama !== "function") {
    return {
      available: false,
      reason: "本地 AI JavaScript 模組尚未正確載入，請重新啟動 App 後再試。",
    };
  }

  return { available: true };
}

function normalizeLoadModelError(error: any): string {
  const message = String(error?.message ?? error ?? "未知錯誤");
  if (
    /initLlama|initContext|RNLlama|NativeModule|TurboModule|native module/i.test(
      message,
    )
  ) {
    return RUNTIME_UNAVAILABLE_MESSAGE;
  }
  return `模型載入失敗：${message}`;
}

// ═══════════════════════════════════════════════════
// Core Engine Class
// ═══════════════════════════════════════════════════

class LocalLLMEngine {
  private context: LlamaContext | null = null;
  private config: LLMConfig | null = null;
  private state: LLMState = { status: "uninitialized" };
  private listeners: Set<(state: LLMState) => void> = new Set();
  private conversationHistory: LLMMessage[] = [];
  private abortController: AbortController | null = null;

  // ── State Management ──

  getState(): LLMState {
    return { ...this.state };
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

  // ── Model Management ──

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
    const cfg = MODEL_REGISTRY[modelId ?? DEFAULT_MODEL_ID];
    if (!cfg) return false;
    const path = this.getModelPath(cfg);
    try {
      const info = await FileSystem.getInfoAsync(path);
      return info.exists && (info as any).size > cfg.modelSize * 0.9;
    } catch {
      return false;
    }
  }

  /**
   * 下載模型到本地（支援斷點續傳）
   */
  async downloadModel(
    modelId?: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ): Promise<boolean> {
    const cfg = MODEL_REGISTRY[modelId ?? DEFAULT_MODEL_ID];
    if (!cfg) {
      this.setState({ status: "error", error: `Unknown model: ${modelId}` });
      return false;
    }

    const modelDir = `${getDocDir()}models/`;
    const dirInfo = await FileSystem.getInfoAsync(modelDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
    }

    const modelPath = this.getModelPath(cfg);
    this.setState({ status: "downloading", modelId: cfg.modelId });

    try {
      // HuggingFace URL 需要 redirect 追蹤 + User-Agent
      const downloadResumable = FileSystem.createDownloadResumable(
        cfg.modelUrl,
        modelPath,
        {
          headers: {
            "User-Agent": "CampusAI-App/1.0",
          },
        },
        (downloadProgress) => {
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

      console.log(`[LocalLLM] Starting download: ${cfg.modelUrl}`);
      console.log(`[LocalLLM] Saving to: ${modelPath}`);

      const result = await downloadResumable.downloadAsync();
      if (!result) {
        throw new Error("下載回傳 null — 可能是網路連線中斷或 URL 無效");
      }

      console.log(`[LocalLLM] Download complete: status=${result.status}, uri=${result.uri}`);

      await AsyncStorage.setItem(
        STORAGE_KEYS.modelReady,
        JSON.stringify({ modelId: cfg.modelId, downloadedAt: Date.now() }),
      );

      this.setState({ status: "uninitialized", downloadProgress: undefined });
      return true;
    } catch (e: any) {
      console.error(`[LocalLLM] Download error:`, e);
      const userMsg = e.message?.includes("Network")
        ? "網路連線失敗，請確認 Wi-Fi 已連線後重試"
        : e.message?.includes("space")
          ? "儲存空間不足，請清理裝置空間後重試"
          : `下載失敗：${e.message ?? "未知錯誤"}`;
      this.setState({
        status: "error",
        error: userMsg,
        downloadProgress: undefined,
      });
      return false;
    }
  }

  /**
   * 載入模型到記憶體（初始化 llama context）
   */
  async loadModel(modelId?: string): Promise<boolean> {
    const cfg = MODEL_REGISTRY[modelId ?? DEFAULT_MODEL_ID];
    if (!cfg) {
      this.setState({ status: "error", error: `Unknown model: ${modelId}` });
      return false;
    }

    // 檢查模型檔案
    const modelPath = this.getModelPath(cfg);
    const fileInfo = await FileSystem.getInfoAsync(modelPath);
    if (!fileInfo.exists) {
      this.setState({
        status: "error",
        error: "Model not downloaded. Call downloadModel() first.",
      });
      return false;
    }

    this.setState({ status: "loading", modelId: cfg.modelId });

    try {
      const runtimeAvailability = getRuntimeAvailability();
      if (!runtimeAvailability.available) {
        throw new Error(runtimeAvailability.reason ?? RUNTIME_UNAVAILABLE_MESSAGE);
      }

      const initLlama = loadLlamaModule()?.initLlama;
      if (typeof initLlama !== "function") {
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
        n_gpu_layers: cfg.gpuLayers,
        use_mlock: true,
        use_mmap: true,
      });

      this.config = cfg;
      this.setState({ status: "ready" });

      await AsyncStorage.setItem(STORAGE_KEYS.activeModel, cfg.modelId);
      return true;
    } catch (e: any) {
      this.setState({
        status: "error",
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
    const mid = modelId ?? DEFAULT_MODEL_ID;

    if (this.state.status === "ready" && this.config?.modelId === mid) {
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
    let prompt = "";

    for (const msg of messages) {
      switch (msg.role) {
        case "system":
          prompt += `<|im_start|>system\n${msg.content}<|im_end|>\n`;
          break;
        case "user":
          prompt += `<|im_start|>user\n${msg.content}<|im_end|>\n`;
          break;
        case "assistant":
          prompt += `<|im_start|>assistant\n${msg.content}<|im_end|>\n`;
          break;
        case "tool":
          prompt += `<|im_start|>tool\nName: ${msg.name ?? "unknown"}\nResult: ${msg.content}<|im_end|>\n`;
          break;
      }
    }

    // 開始 assistant 回答
    prompt += "<|im_start|>assistant\n";
    return prompt;
  }

  /**
   * 生成回答（核心推理函式）
   */
  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResult> {
    if (!this.context || !this.config) {
      throw new Error("Model not loaded. Call loadModel() or ensureReady() first.");
    }

    if (this.state.status === "generating") {
      throw new Error("Already generating. Abort the current generation first.");
    }

    this.setState({ status: "generating" });
    this.abortController = new AbortController();

    const {
      messages,
      maxTokens = this.config.maxTokens,
      temperature = this.config.temperature,
      topP = this.config.topP,
      stopSequences = ["<|im_end|>", "<|im_start|>"],
      onToken,
      signal,
    } = options;

    // 連接外部 signal
    if (signal) {
      signal.addEventListener("abort", () => this.abortController?.abort());
    }

    const prompt = this.formatPrompt(messages);

    try {
      const startTime = Date.now();
      let generated = "";

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
      const tps = result.timings?.predicted_per_second ?? 0;

      this.setState({ status: "ready", tokensPerSecond: tps });

      // 儲存統計
      this.saveStats(tps, result.tokens_predicted, totalTimeMs);

      return {
        content: result.text.trim(),
        tokensGenerated: result.tokens_predicted,
        tokensPerSecond: tps,
        finishReason:
          result.tokens_predicted >= maxTokens ? "length" : "stop",
        totalTimeMs,
      };
    } catch (e: any) {
      if (e.name === "AbortError" || this.abortController?.signal.aborted) {
        this.setState({ status: "ready" });
        return {
          content: "",
          tokensGenerated: 0,
          tokensPerSecond: 0,
          finishReason: "error",
          totalTimeMs: 0,
        };
      }
      this.setState({ status: "error", error: e.message });
      throw e;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 中斷目前生成
   */
  abort() {
    this.abortController?.abort();
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
        role: "system",
        content: systemPrompt,
      });
    }

    // 添加使用者訊息
    this.conversationHistory.push({ role: "user", content: userMessage });

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
        role: "assistant",
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
    const systemMsgs = this.conversationHistory.filter(
      (m) => m.role === "system",
    );
    const nonSystemMsgs = this.conversationHistory.filter(
      (m) => m.role !== "system",
    );

    if (nonSystemMsgs.length > maxTurns * 2) {
      // 保留最近的對話
      const recent = nonSystemMsgs.slice(-maxTurns * 2);

      // 壓縮較早的對話為摘要
      const older = nonSystemMsgs.slice(0, -maxTurns * 2);
      const summary = this.summarizeMessages(older);

      this.conversationHistory = [
        ...systemMsgs,
        { role: "system", content: `[對話摘要] ${summary}` },
        ...recent,
      ];
    }
  }

  /**
   * 簡單摘要（提取關鍵資訊）
   */
  private summarizeMessages(messages: LLMMessage[]): string {
    const userMsgs = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content.slice(0, 50));
    const topics = userMsgs.join("；");
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
      if (jsonMessages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx >= 0) {
      jsonMessages[lastUserIdx] = {
        ...jsonMessages[lastUserIdx],
        content:
          jsonMessages[lastUserIdx].content +
          `\n\n請以 JSON 格式回覆${schema ? `，格式如下：${schema}` : ""}。只輸出 JSON，不要其他文字。`,
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
    if (this.context) {
      await this.context.release();
      this.context = null;
    }
    this.config = null;
    this.setState({ status: "uninitialized" });
  }

  /**
   * 刪除已下載的模型檔案
   */
  async deleteModel(modelId?: string): Promise<void> {
    const cfg = MODEL_REGISTRY[modelId ?? DEFAULT_MODEL_ID];
    if (!cfg) return;

    if (this.config?.modelId === cfg.modelId) {
      await this.release();
    }

    const path = this.getModelPath(cfg);
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {}

    await AsyncStorage.removeItem(STORAGE_KEYS.modelReady);
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

  private async saveStats(
    tps: number,
    tokensGenerated: number,
    timeMs: number,
  ) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.inferenceStats);
      const stats = raw ? JSON.parse(raw) : { totalInferences: 0, avgTps: 0, totalTokens: 0 };
      stats.totalInferences++;
      stats.totalTokens += tokensGenerated;
      stats.avgTps =
        (stats.avgTps * (stats.totalInferences - 1) + tps) /
        stats.totalInferences;
      stats.lastInference = Date.now();
      stats.lastTimeMs = timeMs;
      await AsyncStorage.setItem(
        STORAGE_KEYS.inferenceStats,
        JSON.stringify(stats),
      );
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
      return raw
        ? JSON.parse(raw)
        : { totalInferences: 0, avgTps: 0, totalTokens: 0 };
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
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // 找到最外層的 {}  或 []
    let depth = 0;
    let start = -1;
    const opener = trimmed[0];
    const closer = opener === "{" ? "}" : "]";

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
