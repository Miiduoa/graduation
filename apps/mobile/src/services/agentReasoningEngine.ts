/**
 * Agent Reasoning Engine — 全本地 Plan → Execute → Verify 推理迴圈
 * ═══════════════════════════════════════════════════════════════════════
 * 在裝置端實現完整的 Agent 思考迴圈，無外部 API 依賴。
 *
 * 核心架構：
 *  1. Planner — 分析使用者意圖，拆解為步驟計畫
 *  2. Executor — 逐步執行工具呼叫，收集結果
 *  3. Verifier — 驗證結果品質，決定是否需要重試
 *  4. Synthesizer — 整合所有結果，生成最終回答
 *
 * 工具系統（Tool-Use Framework）：
 *  - campus_query: 查詢校園資料（課表、成績、出席、公告）
 *  - web_search: 搜尋網路資訊
 *  - calculate: 數學計算
 *  - schedule_manage: 行事曆管理
 *  - knowledge_base: 校園知識庫查詢
 *  - task_execute: 執行特定任務（訂餐、請假、查天氣等）
 */

import { localLLM, type LLMMessage, type LLMGenerateResult } from './localLLMInference';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

/** 工具定義 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: string;
    description: string;
    required: boolean;
  }[];
  execute: (params: Record<string, any>) => Promise<ToolResult>;
}

/** 工具執行結果 */
export interface ToolResult {
  success: boolean;
  data: any;
  error?: string;
  metadata?: Record<string, any>;
}

/** 推理步驟 */
export interface ReasoningStep {
  id: string;
  type: 'plan' | 'tool_call' | 'verify' | 'synthesize' | 'thought';
  content: string;
  toolName?: string;
  toolParams?: Record<string, any>;
  toolResult?: ToolResult;
  timestamp: number;
  durationMs?: number;
}

/** 推理計畫 */
export interface ReasoningPlan {
  goal: string;
  steps: PlannedStep[];
  confidence: number;
  requiresTools: boolean;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface PlannedStep {
  id: string;
  action: string;
  tool?: string;
  params?: Record<string, any>;
  dependsOn?: string[];
  optional?: boolean;
}

/** Agent 回答 */
export interface AgentResponse {
  content: string;
  reasoning: ReasoningStep[];
  plan?: ReasoningPlan;
  toolsUsed: string[];
  totalTimeMs: number;
  tokensUsed: number;
  confidence: number;
}

/** Agent 配置 */
export interface AgentConfig {
  maxSteps: number;
  maxRetries: number;
  verifyThreshold: number; // 0-1, below this triggers retry
  enableWebSearch: boolean;
  enableCampusQuery: boolean;
  enableTaskExecution: boolean;
  streamThinking: boolean;
  systemPrompt: string;
}

// ═══════════════════════════════════════════════════
// System Prompt — Agent 系統提示詞
// ═══════════════════════════════════════════════════

const AGENT_SYSTEM_PROMPT = `你是靜宜大學的 AI 全能助理「靜宜小幫手」，完全在使用者的手機上運行。
你具備以下能力：
1. 思考推理：可以一步一步分析問題，制定計畫
2. 使用工具：可以查詢校園資料、搜尋網路、計算數學、管理行事曆
3. 任務執行：可以幫助完成各種校園相關任務
4. 驗證結果：會檢查自己的回答是否正確

你的思考過程：
- 先理解使用者的問題
- 判斷是否需要使用工具
- 如果需要，制定步驟計畫
- 執行每個步驟
- 驗證結果
- 給出最終回答

回答風格：
- 親切友善，像學長姐一樣
- 簡潔扼要，重點明確
- 如果不確定，會誠實告知
- 使用繁體中文

可用工具：
- campus_query: 查詢校園資料（課表、成績、出席、公告、餐廳菜單）
- web_search: 搜尋網路資訊（新聞、天氣、知識）
- calculate: 數學計算和資料分析
- schedule_manage: 查看/新增行事曆事件
- knowledge_base: 查詢校園知識庫（位置、規定、常見問題）
- task_execute: 執行任務（設提醒、查公車、查圖書館）

當你需要使用工具時，請用以下 JSON 格式回覆：
{"tool": "工具名稱", "params": {"參數名": "值"}}

當你完成思考要給最終回答時，直接用自然語言回答。`;

// ═══════════════════════════════════════════════════
// Default Agent Config
// ═══════════════════════════════════════════════════

const DEFAULT_CONFIG: AgentConfig = {
  maxSteps: 8,
  maxRetries: 2,
  verifyThreshold: 0.6,
  enableWebSearch: true,
  enableCampusQuery: true,
  enableTaskExecution: true,
  streamThinking: true,
  systemPrompt: AGENT_SYSTEM_PROMPT,
};

// ═══════════════════════════════════════════════════
// Tool Registry
// ═══════════════════════════════════════════════════

const toolRegistry: Map<string, AgentTool> = new Map();

/**
 * 註冊工具
 */
export function registerTool(tool: AgentTool): void {
  toolRegistry.set(tool.name, tool);
}

/**
 * 取得所有已註冊工具
 */
export function getRegisteredTools(): AgentTool[] {
  return Array.from(toolRegistry.values());
}

// ═══════════════════════════════════════════════════
// Core Agent Logic
// ═══════════════════════════════════════════════════

/**
 * Agent 推理主迴圈 — Plan → Execute → Verify
 */
export async function agentReason(
  userMessage: string,
  config: Partial<AgentConfig> = {},
  onStep?: (step: ReasoningStep) => void,
  onToken?: (token: string) => void,
  signal?: AbortSignal,
): Promise<AgentResponse> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  const reasoning: ReasoningStep[] = [];
  const toolsUsed: string[] = [];
  let totalTokens = 0;

  // ── Step 1: Planning ──
  const planStep: ReasoningStep = {
    id: `step_${Date.now()}_plan`,
    type: 'plan',
    content: '分析問題，制定計畫...',
    timestamp: Date.now(),
  };
  onStep?.(planStep);

  const plan = await generatePlan(userMessage, cfg, signal);
  planStep.content = `目標：${plan.goal}\n步驟數：${plan.steps.length}\n複雜度：${plan.complexity}`;
  planStep.durationMs = Date.now() - planStep.timestamp;
  reasoning.push(planStep);

  // ── Step 2: Simple path (no tools needed) ──
  if (!plan.requiresTools || plan.complexity === 'simple') {
    const directResult = await generateDirectAnswer(userMessage, cfg, onToken, signal);
    totalTokens += directResult.tokensGenerated;

    const synthStep: ReasoningStep = {
      id: `step_${Date.now()}_synth`,
      type: 'synthesize',
      content: directResult.content,
      timestamp: Date.now(),
    };
    reasoning.push(synthStep);

    return {
      content: directResult.content,
      reasoning,
      plan,
      toolsUsed,
      totalTimeMs: Date.now() - startTime,
      tokensUsed: totalTokens,
      confidence: plan.confidence,
    };
  }

  // ── Step 3: Execute plan steps ──
  const stepResults: Map<string, any> = new Map();

  for (let i = 0; i < plan.steps.length && i < cfg.maxSteps; i++) {
    if (signal?.aborted) break;

    const plannedStep = plan.steps[i];

    // Check dependencies
    if (plannedStep.dependsOn?.length) {
      const allDepsReady = plannedStep.dependsOn.every((dep) => stepResults.has(dep));
      if (!allDepsReady && plannedStep.optional) continue;
    }

    // Execute tool
    if (plannedStep.tool && toolRegistry.has(plannedStep.tool)) {
      const tool = toolRegistry.get(plannedStep.tool)!;
      const execStep: ReasoningStep = {
        id: plannedStep.id,
        type: 'tool_call',
        content: `執行工具: ${tool.name}`,
        toolName: tool.name,
        toolParams: plannedStep.params,
        timestamp: Date.now(),
      };
      onStep?.(execStep);

      try {
        const result = await executeToolWithRetry(tool, plannedStep.params ?? {}, cfg.maxRetries);
        execStep.toolResult = result;
        execStep.durationMs = Date.now() - execStep.timestamp;
        stepResults.set(plannedStep.id, result.data);
        toolsUsed.push(tool.name);

        if (!result.success && !plannedStep.optional) {
          execStep.content = `工具執行失敗: ${result.error}`;
        }
      } catch (e: any) {
        execStep.toolResult = {
          success: false,
          data: null,
          error: e.message,
        };
        execStep.durationMs = Date.now() - execStep.timestamp;
      }

      reasoning.push(execStep);
    } else {
      // Thought step (no tool)
      const thoughtStep: ReasoningStep = {
        id: plannedStep.id,
        type: 'thought',
        content: plannedStep.action,
        timestamp: Date.now(),
      };
      reasoning.push(thoughtStep);
      onStep?.(thoughtStep);
    }
  }

  // ── Step 4: Verify ──
  const verifyStep: ReasoningStep = {
    id: `step_${Date.now()}_verify`,
    type: 'verify',
    content: '驗證結果...',
    timestamp: Date.now(),
  };
  onStep?.(verifyStep);

  const verification = await verifyResults(userMessage, reasoning, stepResults, cfg, signal);
  verifyStep.content = `驗證結果：${verification.passed ? '通過' : '需改善'} (信心度: ${verification.confidence})`;
  verifyStep.durationMs = Date.now() - verifyStep.timestamp;
  reasoning.push(verifyStep);

  // ── Step 5: Synthesize final answer ──
  const synthStep: ReasoningStep = {
    id: `step_${Date.now()}_final`,
    type: 'synthesize',
    content: '整合結果...',
    timestamp: Date.now(),
  };
  onStep?.(synthStep);

  const finalAnswer = await synthesizeAnswer(
    userMessage,
    reasoning,
    stepResults,
    verification,
    cfg,
    onToken,
    signal,
  );
  totalTokens += finalAnswer.tokensGenerated;
  synthStep.content = finalAnswer.content;
  synthStep.durationMs = Date.now() - synthStep.timestamp;
  reasoning.push(synthStep);

  return {
    content: finalAnswer.content,
    reasoning,
    plan,
    toolsUsed: Array.from(new Set(toolsUsed)),
    totalTimeMs: Date.now() - startTime,
    tokensUsed: totalTokens,
    confidence: verification.confidence,
  };
}

// ═══════════════════════════════════════════════════
// Planning Phase
// ═══════════════════════════════════════════════════

async function generatePlan(
  userMessage: string,
  config: AgentConfig,
  signal?: AbortSignal,
): Promise<ReasoningPlan> {
  const toolDescriptions = Array.from(toolRegistry.values())
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  const planPrompt: LLMMessage[] = [
    {
      role: 'system',
      content: `你是一個任務規劃器。分析使用者的問題，決定是否需要使用工具，並制定執行計畫。

可用工具：
${toolDescriptions}

以 JSON 格式回覆計畫：
{
  "goal": "任務目標摘要",
  "requiresTools": true/false,
  "complexity": "simple|moderate|complex",
  "confidence": 0.0-1.0,
  "steps": [
    {"id": "s1", "action": "描述", "tool": "工具名(可選)", "params": {}}
  ]
}`,
    },
    { role: 'user', content: userMessage },
  ];

  try {
    const result = await localLLM.generateJSON<ReasoningPlan>(planPrompt, undefined, signal);

    if (result.data) {
      return {
        goal: result.data.goal ?? userMessage,
        steps: (result.data.steps ?? []).map((s, i) => ({
          id: s.id ?? `s${i + 1}`,
          action: s.action ?? '',
          tool: s.tool,
          params: s.params,
          dependsOn: s.dependsOn,
          optional: s.optional,
        })),
        confidence: Math.min(1, Math.max(0, result.data.confidence ?? 0.5)),
        requiresTools: result.data.requiresTools ?? false,
        complexity: result.data.complexity ?? 'simple',
      };
    }
  } catch (e) {
    console.warn('[AgentReasoning] Plan generation failed:', e);
  }

  // Fallback: 用規則判斷
  return generateFallbackPlan(userMessage);
}

/**
 * 規則式備用規劃器（LLM 失敗時使用）
 */
function generateFallbackPlan(userMessage: string): ReasoningPlan {
  const msg = userMessage.toLowerCase();
  const steps: PlannedStep[] = [];
  let requiresTools = false;
  let complexity: 'simple' | 'moderate' | 'complex' = 'simple';

  // 課表相關
  if (/課表|課程|上課|老師|教授/.test(msg)) {
    steps.push({
      id: 's1',
      action: '查詢課表資料',
      tool: 'campus_query',
      params: { type: 'courses' },
    });
    requiresTools = true;
  }

  // 成績相關
  if (/成績|分數|及格|學期/.test(msg)) {
    steps.push({
      id: 's2',
      action: '查詢成績資料',
      tool: 'campus_query',
      params: { type: 'grades' },
    });
    requiresTools = true;
  }

  // 出席相關
  if (/出席|點名|缺課|翹課/.test(msg)) {
    steps.push({
      id: 's3',
      action: '查詢出席記錄',
      tool: 'campus_query',
      params: { type: 'attendance' },
    });
    requiresTools = true;
  }

  // 天氣 / 新聞 / 搜尋
  if (/天氣|新聞|搜尋|查一下|幫我找/.test(msg)) {
    steps.push({
      id: 's4',
      action: '搜尋網路資訊',
      tool: 'web_search',
      params: { query: userMessage },
    });
    requiresTools = true;
    complexity = 'moderate';
  }

  // 計算
  if (/計算|算|多少|加|減|乘|除|平均|GPA/.test(msg)) {
    steps.push({
      id: 's5',
      action: '進行計算',
      tool: 'calculate',
      params: { expression: userMessage },
    });
    requiresTools = true;
  }

  // 行事曆
  if (/行事曆|提醒|什麼時候|截止|deadline/.test(msg)) {
    steps.push({
      id: 's6',
      action: '查詢行事曆',
      tool: 'schedule_manage',
      params: { action: 'query', query: userMessage },
    });
    requiresTools = true;
  }

  // 校園知識
  if (/在哪|怎麼走|規定|辦法|電話|位置|開放/.test(msg)) {
    steps.push({
      id: 's7',
      action: '查詢校園知識庫',
      tool: 'knowledge_base',
      params: { query: userMessage },
    });
    requiresTools = true;
  }

  if (steps.length > 2) complexity = 'complex';

  return {
    goal: userMessage.slice(0, 100),
    steps: steps.length > 0 ? steps : [{ id: 's1', action: '直接回答使用者問題' }],
    confidence: steps.length > 0 ? 0.7 : 0.5,
    requiresTools,
    complexity,
  };
}

// ═══════════════════════════════════════════════════
// Execution Phase
// ═══════════════════════════════════════════════════

async function executeToolWithRetry(
  tool: AgentTool,
  params: Record<string, any>,
  maxRetries: number,
): Promise<ToolResult> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await tool.execute(params);
      if (result.success) return result;
      lastError = result.error;
    } catch (e: any) {
      lastError = e.message;
    }

    // 等待後重試
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  return { success: false, data: null, error: lastError ?? 'Unknown error' };
}

// ═══════════════════════════════════════════════════
// Verification Phase
// ═══════════════════════════════════════════════════

interface VerificationResult {
  passed: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
}

async function verifyResults(
  originalQuestion: string,
  reasoning: ReasoningStep[],
  results: Map<string, any>,
  config: AgentConfig,
  signal?: AbortSignal,
): Promise<VerificationResult> {
  // 收集工具結果
  const toolResults = reasoning
    .filter((s) => s.type === 'tool_call' && s.toolResult)
    .map((s) => ({
      tool: s.toolName,
      success: s.toolResult?.success,
      hasData: s.toolResult?.data != null,
    }));

  // 基本驗證規則
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 1.0;

  // 檢查工具是否全部成功
  const failedTools = toolResults.filter((t) => !t.success);
  if (failedTools.length > 0) {
    score -= 0.2 * failedTools.length;
    issues.push(`${failedTools.length} 個工具執行失敗`);
    suggestions.push('可能需要使用替代方式取得資訊');
  }

  // 檢查是否有實質資料
  const hasData = toolResults.some((t) => t.hasData);
  if (toolResults.length > 0 && !hasData) {
    score -= 0.3;
    issues.push('工具未回傳有效資料');
    suggestions.push('嘗試用不同參數重新查詢');
  }

  // 如果 LLM 可用，用它進行語意驗證
  if (localLLM.getState().status === 'ready' && score > 0.3) {
    try {
      const verifyMessages: LLMMessage[] = [
        {
          role: 'system',
          content: `驗證以下回答是否正確回應了使用者的問題。回覆 JSON: {"score": 0.0-1.0, "issues": []}`,
        },
        {
          role: 'user',
          content: `問題：${originalQuestion}\n\n收集到的資料：${JSON.stringify(Array.from(results.entries()).slice(0, 3))}`,
        },
      ];

      const verifyResult = await localLLM.generateJSON<{
        score: number;
        issues: string[];
      }>(verifyMessages, undefined, signal);

      if (verifyResult.data) {
        score = Math.min(score, verifyResult.data.score ?? score);
        if (verifyResult.data.issues) {
          issues.push(...verifyResult.data.issues);
        }
      }
    } catch {
      // LLM 驗證失敗，用基本分數
    }
  }

  const confidence = Math.max(0, Math.min(1, score));

  return {
    passed: confidence >= config.verifyThreshold,
    confidence,
    issues,
    suggestions,
  };
}

// ═══════════════════════════════════════════════════
// Synthesis Phase
// ═══════════════════════════════════════════════════

async function synthesizeAnswer(
  userMessage: string,
  reasoning: ReasoningStep[],
  results: Map<string, any>,
  verification: VerificationResult,
  config: AgentConfig,
  onToken?: (token: string) => void,
  signal?: AbortSignal,
): Promise<LLMGenerateResult> {
  // 收集所有工具結果
  const toolData = reasoning
    .filter((s) => s.type === 'tool_call' && s.toolResult?.success)
    .map((s) => `[${s.toolName}] ${JSON.stringify(s.toolResult?.data).slice(0, 500)}`)
    .join('\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: config.systemPrompt },
    {
      role: 'user',
      content: userMessage,
    },
  ];

  if (toolData) {
    messages.push({
      role: 'tool',
      name: 'aggregated_results',
      content: toolData,
    });
    messages.push({
      role: 'system',
      content: `上面是你收集到的資料。現在請根據這些資料，用親切的語氣回答使用者的問題。如果資料不足，誠實告知。`,
    });
  }

  return localLLM.generate({
    messages,
    onToken,
    signal,
    temperature: 0.7,
  });
}

async function generateDirectAnswer(
  userMessage: string,
  config: AgentConfig,
  onToken?: (token: string) => void,
  signal?: AbortSignal,
): Promise<LLMGenerateResult> {
  return localLLM.generate({
    messages: [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: userMessage },
    ],
    onToken,
    signal,
  });
}

// ═══════════════════════════════════════════════════
// Conversation Memory — 長期記憶
// ═══════════════════════════════════════════════════

const MEMORY_KEY = '@agent:conversation_memory';
const MAX_MEMORY_ITEMS = 50;

interface MemoryItem {
  question: string;
  answer: string;
  tools: string[];
  confidence: number;
  timestamp: number;
}

export async function saveToMemory(response: AgentResponse, question: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(MEMORY_KEY);
    const memory: MemoryItem[] = raw ? JSON.parse(raw) : [];

    memory.push({
      question,
      answer: response.content.slice(0, 200),
      tools: response.toolsUsed,
      confidence: response.confidence,
      timestamp: Date.now(),
    });

    // 保留最近 N 筆
    while (memory.length > MAX_MEMORY_ITEMS) memory.shift();

    await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {}
}

export async function getMemory(): Promise<MemoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(MEMORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 從記憶中找相關的歷史問答（用於上下文增強）
 */
export async function findRelevantMemory(query: string, limit = 3): Promise<MemoryItem[]> {
  const memory = await getMemory();
  if (memory.length === 0) return [];

  // 簡單關鍵字匹配（LLM 載入後可升級為語意搜尋）
  const queryWords = query.split(/[\s，。？！,.\?!]+/).filter((w) => w.length > 1);

  const scored = memory.map((item) => {
    let score = 0;
    for (const word of queryWords) {
      if (item.question.includes(word)) score += 2;
      if (item.answer.includes(word)) score += 1;
    }
    // 時間衰減
    const ageHours = (Date.now() - item.timestamp) / (1000 * 60 * 60);
    score *= Math.exp(-ageHours / 168); // 一週半衰期
    return { item, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}

// ═══════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════

export { AGENT_SYSTEM_PROMPT, DEFAULT_CONFIG };
export type { AgentConfig as AgentReasoningConfig };
