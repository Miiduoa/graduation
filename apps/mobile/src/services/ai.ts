/**
 * AI Service - 校園智慧助理 API 整合層
 *
 * 支援：後端代理 AI、本地模擬（開發用）
 *
 * 使用方式：
 * 1. 在 .env 設定 AI 模式與選用參數
 * 2. 呼叫 chatWithAI() 發送對話
 *
 * 選用環境變數：
 * - EXPO_PUBLIC_AI_PROVIDER = cloud | mock
 * - EXPO_PUBLIC_AI_MAX_TOKENS（預設 1000）
 */

import Constants from "expo-constants";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseApp, hasUsableFirebaseConfig } from "../firebase";
import type { AIActionBrief, CampusSignal, ImportedArtifact, UserRole } from "../data/types";
import {
  createSuggestedActionsFromSignals,
  getFreshnessLabel,
  getTodaySourceLabel,
} from "./studentOs";

export type AIProvider = "cloud" | "mock" | "openai" | "gemini";

// 重試配置
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

// 速率限制狀態追蹤
const rateLimitState = {
  lastRequestTime: 0,
  minRequestIntervalMs: 500, // 最小請求間隔 500ms
  consecutiveRateLimits: 0,
  rateLimitResetTime: 0,
};

/**
 * 計算重試延遲（指數退避 + 抖動）
 */
function getRetryDelay(retryCount: number, retryAfterHeader?: string): number {
  // 如果伺服器提供了 Retry-After header，優先使用
  if (retryAfterHeader) {
    const retryAfterSeconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(retryAfterSeconds)) {
      return retryAfterSeconds * 1000;
    }
  }

  const baseDelay = RETRY_CONFIG.baseDelayMs * Math.pow(2, retryCount);
  const jitter = baseDelay * 0.2 * Math.random();
  return Math.min(baseDelay + jitter, RETRY_CONFIG.maxDelayMs);
}

/**
 * 檢查是否應該重試
 */
function shouldRetry(statusCode: number, retryCount: number): boolean {
  if (retryCount >= RETRY_CONFIG.maxRetries) return false;
  return RETRY_CONFIG.retryableStatusCodes.includes(statusCode);
}

/**
 * 等待速率限制
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  
  // 如果正在被速率限制，等待到重置時間
  if (rateLimitState.rateLimitResetTime > now) {
    const waitTime = rateLimitState.rateLimitResetTime - now;
    console.log(`[AI] Waiting ${waitTime}ms for rate limit reset`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return;
  }
  
  // 確保請求間隔不會太短
  const timeSinceLastRequest = now - rateLimitState.lastRequestTime;
  const effectiveInterval = rateLimitState.minRequestIntervalMs * (1 + rateLimitState.consecutiveRateLimits);
  
  if (timeSinceLastRequest < effectiveInterval) {
    const waitTime = effectiveInterval - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  rateLimitState.lastRequestTime = Date.now();
}

/**
 * 處理速率限制響應
 */
function handleRateLimitResponse(retryAfterHeader?: string): void {
  rateLimitState.consecutiveRateLimits++;
  
  const retryAfterMs = retryAfterHeader 
    ? parseInt(retryAfterHeader, 10) * 1000 
    : 60000 * rateLimitState.consecutiveRateLimits;
    
  rateLimitState.rateLimitResetTime = Date.now() + retryAfterMs;
  console.warn(`[AI] Rate limited, reset in ${retryAfterMs}ms`);
}

/**
 * 重置速率限制狀態（成功請求後）
 */
function resetRateLimitState(): void {
  if (rateLimitState.consecutiveRateLimits > 0) {
    rateLimitState.consecutiveRateLimits = 0;
    rateLimitState.rateLimitResetTime = 0;
  }
}

export type AIMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type AIResponse = {
  content: string;
  suggestions?: string[];
  actions?: Array<{ label: string; action: string; params?: any }>;
  error?: string;
};

type CampusAssistantRequest = {
  messages: AIMessage[];
  context: {
    schoolId?: string;
    userId?: string;
    userName?: string;
  };
};

type CampusAssistantResponse = AIResponse & {
  citations?: Array<{ type: string; id: string; label: string }>;
  debug?: Record<string, unknown>;
};

export type AIContext = {
  schoolId: string;
  userId?: string;
  userName?: string;
  // 公開校園資料
  announcements?: Array<{ id: string; title: string; source?: string }>;
  events?: Array<{ id: string; title: string; location?: string; startsAt?: string }>;
  menus?: Array<{ id: string; name: string; price?: number; cafeteria?: string }>;
  pois?: Array<{ id: string; name: string; category?: string }>;
  // 個人化學習資料（新增）
  courses?: Array<{ id: string; name: string; teacher?: string; dayOfWeek: number; startPeriod: number; credits?: number }>;
  pendingAssignments?: Array<{ id: string; title: string; groupName: string; dueAt?: string; isLate?: boolean }>;
  gradesSummary?: { gpa?: number; courses: Array<{ name: string; grade?: number; credits?: number }> };
  weeklyReport?: { summary: string; stats: { onTimeRate: number; totalSubmissions: number; newAchievements: number } };
};

// 上下文顯示筆數（可透過環境變數覆寫）
const CONTEXT_LIMITS = {
  announcements: 8,
  events: 8,
  menus: 8,
  pois: 15,
};

function getConfig() {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  const rawProvider = String(extra.aiProvider ?? process.env.EXPO_PUBLIC_AI_PROVIDER ?? "cloud").toLowerCase();
  return {
    aiProvider: (rawProvider === "mock" ? "mock" : rawProvider) as AIProvider,
    maxTokens: extra.aiMaxTokens ?? process.env.EXPO_PUBLIC_AI_MAX_TOKENS ?? 1000,
  };
}

function getCloudFunctionRegion(): string {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  return String(extra.cloudFunctionRegion ?? process.env.EXPO_PUBLIC_CLOUD_FUNCTION_REGION ?? "asia-east1");
}

const DAY_NAMES = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

function buildSystemPrompt(context: AIContext): string {
  const limits = CONTEXT_LIMITS;
  const parts = [
    "你是一個校園智慧助理，專門幫助學生查詢校園資訊、管理學業和生活。",
    "你有辦法根據學生的個人資料（課程、作業、成績）給出具體、個人化的建議。",
    "",
    "【回答原則】",
    "- 語氣友善、簡潔、有用，使用繁體中文。",
    "- 列舉項目時請用條列（數字或符號）方便閱讀。",
    "- 若提供的個人資料中有相關內容，請直接引用具體數據（如課程名稱、截止日期）。",
    "- 若某類資料目前為空，請如實告知並建議可改用其他查詢方式。",
    "- 無法回答時請禮貌說明，並建議「查看公告」「近期活動」「推薦餐點」「找地點」等替代方向。",
    "- 若學生提到截止日期、提醒等需求，可告知他們 App 支援設定提醒功能。",
    "",
    "【建議選項】",
    "在回答結尾，若適合引導使用者下一步，請加上一行「建議選項：」後列出 1～3 個簡短選項（用頓號或逗號分隔），例如：建議選項：查看詳情、更多公告、開啟導航。選項請簡短（2～6 字），且與 App 功能對應：查看詳情、更多公告、報名活動、其他選擇、開啟導航、今日公告、近期活動、推薦餐點、找地點 等。",
    "",
    `【目前環境】學校：${context.schoolId}，今天：${DAY_NAMES[new Date().getDay()]} ${new Date().toLocaleDateString("zh-TW")}`,
  ];

  if (context.userName) {
    parts.push(`學生姓名：${context.userName}`);
  }

  // ── 個人化學習資料（最重要，放在最前面）──
  if (context.courses && context.courses.length > 0) {
    parts.push("");
    parts.push("【你的課程列表】");
    context.courses.slice(0, 15).forEach((c, i) => {
      const dayName = DAY_NAMES[c.dayOfWeek] ?? "未知";
      parts.push(`${i + 1}. ${c.name}（${dayName} 第${c.startPeriod}節${c.teacher ? `，授課：${c.teacher}` : ""}${c.credits ? `，${c.credits}學分` : ""}）`);
    });
  }

  if (context.pendingAssignments && context.pendingAssignments.length > 0) {
    parts.push("");
    parts.push("【待繳作業（近期截止）】");
    context.pendingAssignments.slice(0, 8).forEach((a, i) => {
      const dueStr = a.dueAt ? `截止：${a.dueAt}` : "無截止日";
      parts.push(`${i + 1}. ${a.title}（${a.groupName}，${dueStr}${a.isLate ? "，⚠️ 已逾期" : ""}）`);
    });
  } else if (context.courses) {
    parts.push("");
    parts.push("【待繳作業】目前無待繳作業。");
  }

  if (context.gradesSummary) {
    parts.push("");
    parts.push("【成績概況】");
    if (context.gradesSummary.gpa) {
      parts.push(`GPA：${context.gradesSummary.gpa.toFixed(2)}`);
    }
    if (context.gradesSummary.courses.length > 0) {
      context.gradesSummary.courses.slice(0, 8).forEach((c, i) => {
        parts.push(`${i + 1}. ${c.name}${c.grade != null ? `：${c.grade} 分` : "（尚未公布）"}${c.credits ? `（${c.credits}學分）` : ""}`);
      });
    }
  }

  if (context.weeklyReport) {
    parts.push("");
    parts.push(`【本週學習報告】${context.weeklyReport.summary}`);
    const s = context.weeklyReport.stats;
    parts.push(`準時繳交率：${s.onTimeRate}%，本週繳交 ${s.totalSubmissions} 份，新解鎖成就 ${s.newAchievements} 個`);
  }

  // ── 校園公開資料 ──
  const hasAnnouncements = context.announcements && context.announcements.length > 0;
  const hasEvents = context.events && context.events.length > 0;
  const hasMenus = context.menus && context.menus.length > 0;
  const hasPois = context.pois && context.pois.length > 0;

  if (hasAnnouncements) {
    parts.push("");
    parts.push("【最近公告】");
    context.announcements!.slice(0, limits.announcements).forEach((a, i) => {
      parts.push(`${i + 1}. ${a.title}${a.source ? ` (來源：${a.source})` : ""}`);
    });
  } else {
    parts.push("");
    parts.push("【最近公告】目前無資料。");
  }

  if (hasEvents) {
    parts.push("");
    parts.push("【近期活動】");
    context.events!.slice(0, limits.events).forEach((e, i) => {
      parts.push(`${i + 1}. ${e.title}${e.location ? ` (${e.location})` : ""}${e.startsAt ? ` ${e.startsAt}` : ""}`);
    });
  } else {
    parts.push("");
    parts.push("【近期活動】目前無資料。");
  }

  if (hasMenus) {
    parts.push("");
    parts.push("【今日餐點】");
    context.menus!.slice(0, limits.menus).forEach((m, i) => {
      parts.push(`${i + 1}. ${m.name}${m.price != null ? ` - $${m.price}` : ""}${m.cafeteria ? ` (${m.cafeteria})` : ""}`);
    });
  } else {
    parts.push("");
    parts.push("【今日餐點】目前無資料。");
  }

  if (hasPois) {
    parts.push("");
    parts.push("【校園地點】");
    context.pois!.slice(0, limits.pois).forEach((p, i) => {
      parts.push(`${i + 1}. ${p.name}${p.category ? ` (${p.category})` : ""}`);
    });
  } else {
    parts.push("");
    parts.push("【校園地點】目前無資料。");
  }

  return parts.join("\n");
}

async function callManagedAI(
  messages: AIMessage[],
  context: AIContext,
  signal?: AbortSignal
): Promise<AIResponse | null> {
  if (signal?.aborted) {
    return { content: "", error: "請求已取消" };
  }

  try {
    await waitForRateLimit();
    const cloudResponse = await callCampusAssistant(messages, context, signal);
    if (cloudResponse) {
      resetRateLimitState();
      return cloudResponse;
    }
  } catch (error) {
    handleRateLimitResponse();
    console.warn("[AI] managed proxy failed:", error);
  }

  return null;
}

/**
 * 從 AI 回覆內容解析「建議選項」並合併關鍵字備援
 */
function extractSuggestions(content: string): string[] {
  const parsed: string[] = [];
  const normalized = content.trim();

  // 解析「建議選項：選項A、選項B」或「建議：...」格式
  const optionMatch = normalized.match(/(?:建議選項|建議)[：:]\s*([^\n]+)/);
  if (optionMatch) {
    const line = optionMatch[1]
      .replace(/[、,，;；]/g, "、")
      .split("、")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 8);
    parsed.push(...line.slice(0, 3));
  }

  if (parsed.length > 0) return parsed;

  // 關鍵字備援
  if (normalized.includes("公告") || normalized.includes("活動")) parsed.push("查看詳情");
  if (normalized.includes("餐") || normalized.includes("吃") || normalized.includes("菜單")) parsed.push("其他選擇");
  if (normalized.includes("地點") || normalized.includes("位置") || normalized.includes("怎麼走")) parsed.push("開啟導航");

  return parsed.length > 0 ? parsed : [];
}

async function mockAIResponse(
  messages: AIMessage[], 
  context: AIContext,
  signal?: AbortSignal
): Promise<AIResponse> {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, 500 + Math.random() * 500);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

  const lastMessage = messages[messages.length - 1]?.content.toLowerCase() ?? "";

  if (lastMessage.includes("公告") || lastMessage.includes("消息")) {
    const recent = context.announcements?.slice(0, 3) ?? [];
    if (recent.length === 0) {
      return { content: "目前沒有新的公告。" };
    }
    const list = recent.map((a, i) => `${i + 1}. ${a.title}`).join("\n");
    return {
      content: `最近有 ${context.announcements?.length ?? 0} 則公告：\n\n${list}`,
      suggestions: ["查看詳情", "更多公告"],
    };
  }

  if (lastMessage.includes("活動") || lastMessage.includes("報名")) {
    const upcoming = context.events?.slice(0, 3) ?? [];
    if (upcoming.length === 0) {
      return { content: "近期沒有活動。" };
    }
    const list = upcoming.map((e, i) => `${i + 1}. ${e.title}`).join("\n");
    return {
      content: `近期活動：\n\n${list}`,
      suggestions: ["報名活動", "查看所有活動"],
    };
  }

  if (lastMessage.includes("吃") || lastMessage.includes("餐") || lastMessage.includes("推薦")) {
    const menus = context.menus?.slice(0, 3) ?? [];
    if (menus.length === 0) {
      return { content: "目前沒有菜單資料。" };
    }
    const list = menus.map((m, i) => `${i + 1}. ${m.name} - $${m.price ?? "?"}`).join("\n");
    return {
      content: `今日推薦：\n\n${list}`,
      suggestions: ["其他選擇", "查看詳情"],
    };
  }

  if (lastMessage.includes("在哪") || lastMessage.includes("怎麼走") || lastMessage.includes("地點")) {
    return {
      content: "你可以在地圖頁面搜尋校園地點，或告訴我你想找什麼地方？",
      suggestions: ["圖書館", "餐廳", "行政大樓"],
    };
  }

  return {
    content: "我可以幫你查詢公告、活動、餐廳和地點資訊。有什麼需要幫忙的嗎？",
    suggestions: ["今日公告", "近期活動", "推薦餐點"],
  };
}

async function callCampusAssistant(
  messages: AIMessage[],
  context: AIContext,
  signal?: AbortSignal
): Promise<AIResponse | null> {
  if (!hasUsableFirebaseConfig()) {
    return null;
  }

  if (signal?.aborted) {
    return { content: "", error: "請求已取消" };
  }

  try {
    const callable = httpsCallable<CampusAssistantRequest, CampusAssistantResponse>(
      getFunctions(getFirebaseApp(), getCloudFunctionRegion()),
      "askCampusAssistant"
    );

    const result = await callable({
      messages: messages.slice(-12),
      context: {
        schoolId: context.schoolId,
        userId: context.userId,
        userName: context.userName,
      },
    });

    const data = result.data;
    return {
      content: data.content ?? "",
      suggestions: data.suggestions ?? extractSuggestions(data.content ?? ""),
      actions: data.actions,
      error: data.error,
    };
  } catch (e: any) {
    console.warn("[AI] askCampusAssistant failed, falling back:", e?.code ?? e?.message ?? e);
    return null;
  }
}

/**
 * 主要 API：與 AI 對話
 * @param messages - 對話訊息陣列
 * @param context - AI 上下文資料
 * @param signal - AbortSignal 用於取消請求
 */
export async function chatWithAI(
  messages: AIMessage[],
  context: AIContext,
  signal?: AbortSignal
): Promise<AIResponse> {
  const config = getConfig();

  try {
    if (config.aiProvider === "mock") {
      return await mockAIResponse(messages, context, signal);
    }

    const managedResponse = await callManagedAI(messages, context, signal);
    if (managedResponse) {
      return managedResponse;
    }

    return await mockAIResponse(messages, context, signal);
  } catch (e: any) {
    if (e.name === "AbortError") {
      return { content: "", error: "請求已取消" };
    }
    throw e;
  }
}

/**
 * 校園助理專用入口：優先走後端 callable，失敗再退回既有 AI 流程。
 */
export async function chatWithCampusAssistant(
  messages: AIMessage[],
  context: AIContext,
  signal?: AbortSignal
): Promise<AIResponse> {
  const cloudResponse = await callManagedAI(messages, context, signal);
  if (cloudResponse) {
    return cloudResponse;
  }
  return mockAIResponse(messages, context, signal);
}

/**
 * 建立可取消的 AI 對話 hook
 */
export function createCancellableChat() {
  let abortController: AbortController | null = null;
  
  return {
    chat: async (messages: AIMessage[], context: AIContext): Promise<AIResponse> => {
      abortController?.abort();
      abortController = new AbortController();
      return chatWithAI(messages, context, abortController.signal);
    },
    cancel: () => {
      abortController?.abort();
      abortController = null;
    },
  };
}

/**
 * 檢查 AI 服務是否可用
 */
export function getAIStatus(): { provider: AIProvider; configured: boolean } {
  const config = getConfig();
  const configured = config.aiProvider === "mock" || hasUsableFirebaseConfig();

  return { provider: config.aiProvider, configured };
}

/**
 * 產生 AI 摘要（用於公告等）
 */
export async function generateSummary(text: string, maxLength = 100): Promise<string> {
  const config = getConfig();

  if (config.aiProvider === "mock") {
    const sentences = text.split(/[。！？\n]/).filter(Boolean);
    return sentences.slice(0, 2).join("。") + (sentences.length > 2 ? "..." : "");
  }

  const messages: AIMessage[] = [
    {
      role: "user",
      content: `請用繁體中文簡短摘要以下內容（最多 ${maxLength} 字）：\n\n${text}`,
    },
  ];

  const response = await chatWithAI(messages, { schoolId: "unknown" });
  return response.content || text.slice(0, maxLength) + "...";
}

/**
 * 提取重要日期（用於公告）
 */
export async function extractDates(text: string): Promise<Array<{ date: string; description: string }>> {
  const dates: Array<{ date: string; description: string }> = [];

  const datePatterns = [
    /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日號]?/g,
    /(\d{1,2})[月\/](\d{1,2})[日號]?/g,
  ];

  for (const pattern of datePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const dateStr = match[0];
      const contextStart = Math.max(0, match.index - 20);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 20);
      const context = text.slice(contextStart, contextEnd).trim();

      dates.push({
        date: dateStr,
        description: context,
      });
    }
  }

  return dates;
}

export function buildTodayActionBrief(params: {
  signals: CampusSignal[];
  importedArtifacts?: ImportedArtifact[];
  userName?: string | null;
  role?: UserRole | null;
  schoolName?: string;
}): AIActionBrief | null {
  const topSignals = params.signals.slice(0, 3);
  const importedCount = params.importedArtifacts?.filter((artifact) => artifact.userConfirmedAt).length ?? 0;

  if (topSignals.length === 0 && importedCount === 0) {
    return {
      summary: `${params.schoolName ?? "校園"}目前先以公開資料模式運作。先匯入課表或行事曆，Today 才能開始幫你排序真正重要的下一步。`,
      reasons: ["目前還沒有個人課務或匯入資料", "系統只會顯示公開公告、活動與校園服務"],
      suggestedActions: [
        {
          id: "action-import",
          label: "匯入資料",
          reason: "先建立你的個人節奏",
          actionTarget: { tab: "課程", screen: "Calendar" },
        },
      ],
      generatedAt: new Date().toISOString(),
      basedOn: [],
    };
  }

  const lead = topSignals[0];
  const leadSource = getTodaySourceLabel(lead.source);
  const leadFreshness = getFreshnessLabel(lead.freshness);
  const name = params.userName?.trim() ? params.userName.trim() : "你";
  const roleHint =
    params.role === "teacher" || params.role === "professor" || params.role === "staff"
      ? "先把教學節奏穩住"
      : params.role === "admin" || params.role === "principal"
        ? "先處理校務節點"
        : "先完成最接近現在的下一步";

  const summary =
    lead.type === "course"
      ? `${name}現在最值得先看的，是 ${lead.title}${lead.meta ? `（${lead.meta}）` : ""}。這則判斷來自${leadSource}，而且資料${leadFreshness}。`
      : lead.type === "crowd"
        ? `${name}現在移動前先看 ${lead.title} 比較划算。這個建議來自${leadSource}，可以幫你省掉現場等待成本。`
        : `${name}現在最值得注意的是 ${lead.title}。它來自${leadSource}，資料${leadFreshness}，建議你先處理這個節點。`;

  const reasons = [
    `${roleHint}。`,
    ...topSignals.map((signal) => {
      const source = getTodaySourceLabel(signal.source);
      const freshness = getFreshnessLabel(signal.freshness);
      return `${signal.title} · ${source} · ${freshness}`;
    }),
  ].slice(0, 4);

  return {
    summary,
    reasons,
    suggestedActions: createSuggestedActionsFromSignals(topSignals),
    generatedAt: new Date().toISOString(),
    basedOn: topSignals.map((signal) => ({
      signalId: signal.id,
      source: signal.source,
    })),
  };
}
