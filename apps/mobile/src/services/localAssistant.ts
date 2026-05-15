/**
 * 本地全能助理 — Unified Local AI Assistant
 * ═══════════════════════════════════════════════════════════════
 * 整合所有本地 AI 能力的統一入口：
 *
 *  1. On-device LLM (llama.rn) — 深度理解 + 生成
 *  2. Agent Reasoning — Plan → Execute → Verify
 *  3. Local NLP Engine — 輕量分類 + 快速回答（無需 LLM）
 *  4. Tool Use — 校園查詢 + 網路搜尋 + 計算 + 行事曆
 *
 * 智慧路由策略：
 *  - 簡單問題（問候、校園基本資訊）→ Local NLP Engine（即時回答）
 *  - 中等問題（需要資料查詢）→ Agent + Tools（幾秒）
 *  - 複雜問題（需要推理 + 多步驟）→ Full LLM + Agent Loop（較慢但深度）
 *
 * 完全不依賴外部 API。LLM 模型下載後永久存在裝置上。
 */

import {
  localLLM,
  type LLMState,
  type ModelDownloadProgress,
  MODEL_REGISTRY,
  getDefaultLocalLlmModelId,
} from './localLLMInference';
import {
  agentReason,
  saveToMemory,
  findRelevantMemory,
  type AgentResponse,
  type ReasoningStep,
} from './agentReasoningEngine';
import './agentToolkit'; // 自動註冊工具
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { formatLocalDocRagAppendix } from './localDocRAG';

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  reasoning?: ReasoningStep[];
  toolsUsed?: string[];
  confidence?: number;
  tokensPerSecond?: number;
  totalTimeMs?: number;
  source?: 'llm' | 'local-nlp' | 'agent' | 'cached';
}

export interface AssistantConfig {
  /** 使用的模型 ID */
  modelId: string;
  /** 是否啟用 Agent 推理 */
  enableAgent: boolean;
  /** 是否啟用網路搜尋 */
  enableWebSearch: boolean;
  /** 是否顯示思考過程 */
  showThinking: boolean;
  /** 自動降級：LLM 不可用時使用 Local NLP */
  autoFallback: boolean;
  /** 回答語言 */
  language: 'zh-TW' | 'en';
}

export interface AssistantStatus {
  llmState: LLMState;
  modelDownloaded: boolean;
  modelReady: boolean;
  totalConversations: number;
  averageTps: number;
}

export type OnTokenCallback = (token: string) => void;
export type OnStepCallback = (step: ReasoningStep) => void;
export type OnStatusCallback = (status: AssistantStatus) => void;

// ═══════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════

function readExpoExtra(): Record<string, unknown> {
  const ex =
    (Constants.expoConfig as { extra?: Record<string, unknown> } | undefined)?.extra ??
    (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra;
  return ex ?? {};
}

function buildDefaultAssistantConfig(): AssistantConfig {
  const extra = readExpoExtra();
  const offlineFirst =
    extra.aiOfflineFirst === true ||
    String(extra.aiOfflineFirst ?? '').toLowerCase() === 'true' ||
    String(process.env.EXPO_PUBLIC_AI_OFFLINE_FIRST ?? '').toLowerCase() === 'true';

  return {
    modelId: getDefaultLocalLlmModelId(),
    enableAgent: true,
    enableWebSearch: !offlineFirst,
    showThinking: true,
    autoFallback: true,
    language: 'zh-TW',
  };
}

const CONFIG_KEY = '@assistant:config';
const HISTORY_KEY = '@assistant:history';

// ═══════════════════════════════════════════════════
// Smart Router — 決定使用哪個引擎
// ═══════════════════════════════════════════════════

type RoutingDecision = 'local-nlp' | 'agent' | 'full-llm';

/**
 * 智慧路由：根據問題複雜度決定處理方式
 */
function routeQuery(message: string): RoutingDecision {
  const msg = message.trim().toLowerCase();
  const len = msg.length;

  // 極短問題或問候 → Local NLP
  if (len < 5) return 'local-nlp';
  if (/^(嗨|你好|哈囉|hi|hello|hey|早安|晚安|掰掰|謝謝|好的|了解)/.test(msg)) {
    return 'local-nlp';
  }

  // 需要工具的查詢 → Agent
  if (/課表|成績|出席|公告|天氣|搜尋|計算|算|行事曆|提醒|公車|圖書館|菜單/.test(msg)) {
    return 'agent';
  }

  // 需要資料查詢
  if (/查|找|搜|哪|誰|何時|幾|多少/.test(msg)) {
    return 'agent';
  }

  // 需要深度推理
  if (/為什麼|如何|怎樣|分析|比較|建議|規劃|幫我想|解釋/.test(msg)) {
    return 'full-llm';
  }

  // 長文本 → LLM
  if (len > 50) return 'full-llm';

  // 預設 Agent（中等複雜度）
  return 'agent';
}

// ═══════════════════════════════════════════════════
// Local NLP Fallback — 無需 LLM 的快速回答
// ═══════════════════════════════════════════════════

/**
 * 本地 NLP 快速回答（用於 LLM 未載入或簡單問題）
 */
async function localNLPResponse(message: string): Promise<string> {
  const msg = message.trim().toLowerCase();

  // 問候
  if (/^(嗨|你好|哈囉|hi|hello|hey)/.test(msg)) {
    const greetings = [
      '嗨！我是靜宜小幫手，有什麼我可以幫你的嗎？',
      '你好！需要我幫你查什麼嗎？課表、成績、校園資訊都可以問我喔！',
      '哈囉！今天想了解什麼呢？',
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  // 自我介紹
  if (/你是誰|你叫什麼|介紹一下/.test(msg)) {
    return '我是靜宜小幫手，一個完全在你手機上運行的 AI 助理。我可以幫你查課表、看成績、搜尋資訊、管理行事曆等等。所有功能都不需要網路也能使用（除了搜尋功能）。有什麼需要幫忙的嗎？';
  }

  // 能力查詢
  if (/你能做什麼|功能|你會什麼/.test(msg)) {
    return '我可以幫你：\n1. 查詢課表、成績、出席紀錄\n2. 搜尋網路資訊\n3. 查天氣\n4. 管理行事曆和提醒\n5. 數學計算\n6. 查校園資訊（圖書館、餐廳、公車等）\n7. 回答各種問題\n\n直接問我就好，我會盡力幫你！';
  }

  // 時間
  if (/現在幾點|什麼時間|今天幾號/.test(msg)) {
    const now = new Date();
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    return `現在是 ${now.toLocaleDateString('zh-TW')} 星期${weekday} ${now.toLocaleTimeString('zh-TW')}`;
  }

  // 道別
  if (/掰掰|再見|bye|晚安/.test(msg)) {
    return '掰掰！有需要隨時找我 👋';
  }

  // 感謝
  if (/謝謝|感謝|thank/.test(msg)) {
    return '不客氣！還有什麼需要幫忙的嗎？';
  }

  // 預設
  return '我了解你的問題，讓我想想怎麼回答比較好。你可以試著問得更具體一點，例如「明天有什麼課」「幫我查天氣」「圖書館幾點開」之類的！';
}

// ═══════════════════════════════════════════════════
// Main Assistant Class
// ════════��══════════════════════════════════════════

class LocalAssistant {
  private config: AssistantConfig = buildDefaultAssistantConfig();
  private history: AssistantMessage[] = [];
  private statusListeners: Set<OnStatusCallback> = new Set();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // ── Initialization ──

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadPersistedState();
    return this.initPromise;
  }

  private async loadPersistedState(): Promise<void> {
    // 載入配置
    try {
      const raw = await AsyncStorage.getItem(CONFIG_KEY);
      if (raw) this.config = { ...buildDefaultAssistantConfig(), ...JSON.parse(raw) };
      else this.config = buildDefaultAssistantConfig();
    } catch {}

    // 如果 LLM 引擎已有啟用模型紀錄，以 LLM 的選用模型為準。
    try {
      const savedModelId = await localLLM.getSavedModelId();
      if (savedModelId) {
        this.config = { ...this.config, modelId: savedModelId };
        await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
      }
    } catch {}

    // 載入歷史
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      if (raw) this.history = JSON.parse(raw);
    } catch {}

    this.initialized = true;
    this.initPromise = null;
  }

  // ── Configuration ──

  getConfig(): AssistantConfig {
    return { ...this.config };
  }

  async setConfig(patch: Partial<AssistantConfig>): Promise<void> {
    await this.initialize();
    this.config = { ...this.config, ...patch };
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
  }

  // ── Status ──

  async getStatus(): Promise<AssistantStatus> {
    await this.initialize();
    const llmState = localLLM.getState();
    const downloaded = await localLLM.isModelDownloaded(this.config.modelId);
    const stats = await localLLM.getStats();

    return {
      llmState,
      modelDownloaded: downloaded,
      modelReady: llmState.status === 'ready',
      totalConversations: stats.totalInferences,
      averageTps: stats.avgTps,
    };
  }

  subscribeStatus(listener: OnStatusCallback): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // ── Model Management ──

  async downloadModel(onProgress?: (p: ModelDownloadProgress) => void): Promise<boolean> {
    await this.initialize();
    return localLLM.downloadModel(this.config.modelId, onProgress);
  }

  async loadModel(): Promise<boolean> {
    await this.initialize();
    return localLLM.loadModel(this.config.modelId);
  }

  async ensureModelReady(onProgress?: (p: ModelDownloadProgress) => void): Promise<boolean> {
    await this.initialize();
    return localLLM.ensureReady(this.config.modelId, onProgress);
  }

  isModelReady(): boolean {
    return localLLM.getState().status === 'ready';
  }

  async restoreDownloadedModel(): Promise<boolean> {
    await this.initialize();

    if (localLLM.getState().status === 'ready') {
      return true;
    }

    const savedModelId = await localLLM.getSavedModelId();
    const downloadedModels = await localLLM.getDownloadedModels();
    const candidates = Array.from(
      new Set([savedModelId, this.config.modelId, ...downloadedModels].filter(Boolean) as string[]),
    );

    for (const modelId of candidates) {
      const downloaded = await localLLM.isModelDownloaded(modelId);
      if (!downloaded) continue;

      this.config = { ...this.config, modelId };
      await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
      const loaded = await localLLM.loadModel(modelId);
      if (loaded) return true;
    }

    return false;
  }

  // ── Chat (Main Entry Point) ──

  /**
   * 發送訊息並取得回答 — 統一入口
   */
  async chat(
    message: string,
    options?: {
      onToken?: OnTokenCallback;
      onStep?: OnStepCallback;
      signal?: AbortSignal;
      forceMode?: RoutingDecision;
    },
  ): Promise<AssistantMessage> {
    await this.initialize();

    const { onToken, onStep, signal, forceMode } = options ?? {};
    const startTime = Date.now();
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 記錄使用者訊息
    const userMsg: AssistantMessage = {
      id: `user_${msgId}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };
    this.history.push(userMsg);

    // 決定路由
    const route = forceMode ?? routeQuery(message);
    const llmReady =
      localLLM.getState().status === 'ready' ||
      (route !== 'local-nlp' ? await this.restoreDownloadedModel() : false);

    try {
      let response: AssistantMessage;

      // 路由決策
      if (route === 'local-nlp' || (!llmReady && this.config.autoFallback)) {
        // 快速本地回答
        const content = await localNLPResponse(message);
        response = {
          id: msgId,
          role: 'assistant',
          content,
          timestamp: Date.now(),
          source: 'local-nlp',
          totalTimeMs: Date.now() - startTime,
        };
      } else if (route === 'agent' && this.config.enableAgent) {
        // Agent 推理 + 工具使用
        const agentResult = await agentReason(
          message,
          {
            enableWebSearch: this.config.enableWebSearch,
            enableCampusQuery: true,
            enableTaskExecution: true,
            streamThinking: this.config.showThinking,
          },
          onStep,
          onToken,
          signal,
        );

        response = {
          id: msgId,
          role: 'assistant',
          content: agentResult.content,
          timestamp: Date.now(),
          reasoning: agentResult.reasoning,
          toolsUsed: agentResult.toolsUsed,
          confidence: agentResult.confidence,
          totalTimeMs: agentResult.totalTimeMs,
          source: 'agent',
        };

        // 存入記憶
        await saveToMemory(agentResult, message);
      } else {
        // Full LLM 直接推理
        const relevantMemory = await findRelevantMemory(message);
        let systemPrompt = `你是靜宜大學的 AI 助理「靜宜小幫手」。用親切、簡潔的繁體中文回答。`;

        if (relevantMemory.length > 0) {
          systemPrompt += `\n\n你之前回答過類似的問題：\n${relevantMemory.map((m) => `Q: ${m.question}\nA: ${m.answer}`).join('\n')}`;
        }

        const ragAppendix = await formatLocalDocRagAppendix(message);
        if (ragAppendix) {
          systemPrompt += `\n\n${ragAppendix}`;
        }

        const result = await localLLM.chat(message, systemPrompt, onToken, signal);

        response = {
          id: msgId,
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
          tokensPerSecond: result.tokensPerSecond,
          totalTimeMs: result.totalTimeMs,
          source: 'llm',
        };
      }

      // 記錄回答
      this.history.push(response);
      this.persistHistory();

      return response;
    } catch (e: any) {
      // 錯誤降級
      if (this.config.autoFallback) {
        const fallbackContent = await localNLPResponse(message);
        const fallbackMsg: AssistantMessage = {
          id: msgId,
          role: 'assistant',
          content: fallbackContent + '\n\n（AI 模型暫時不可用，使用基本回答）',
          timestamp: Date.now(),
          source: 'local-nlp',
          totalTimeMs: Date.now() - startTime,
        };
        this.history.push(fallbackMsg);
        this.persistHistory();
        return fallbackMsg;
      }

      throw e;
    }
  }

  // ── History Management ──

  getHistory(): AssistantMessage[] {
    return [...this.history];
  }

  async clearHistory(): Promise<void> {
    this.history = [];
    localLLM.clearHistory();
    await AsyncStorage.removeItem(HISTORY_KEY);
  }

  private async persistHistory(): Promise<void> {
    try {
      // 只保留最近 100 筆
      const toSave = this.history.slice(-100);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(toSave));
    } catch {}
  }

  // ── Abort ──

  abort(): void {
    localLLM.abort();
  }

  // ── Cleanup ──

  async release(): Promise<void> {
    await localLLM.release();
  }

  // ── Model Info ──

  getAvailableModels() {
    return Object.entries(MODEL_REGISTRY).map(([id, cfg]) => ({
      id,
      name: id,
      size: cfg.modelSize,
      sizeLabel: `${(cfg.modelSize / 1e9).toFixed(1)} GB`,
      contextLength: cfg.contextLength,
    }));
  }
}

// ═══════════════════════════════════════════════════
// Singleton Export
// ═══════════════════════════════════════════════════

export const localAssistant = new LocalAssistant();
export default localAssistant;
