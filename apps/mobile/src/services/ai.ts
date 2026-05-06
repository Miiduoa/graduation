/* eslint-disable */
/**
 * AI Service - 校園智慧助理 API 整合層
 *
 * 支援：裝置端離線 AI、後端代理 AI、本地模擬（開發用）
 *
 * 使用方式：
 * 1. 在 .env 設定 AI 模式與選用參數
 * 2. 呼叫 chatWithAI() 發送對話
 *
 * 選用環境變數：
 * - EXPO_PUBLIC_AI_PROVIDER = offline | local-llm | cloud | gemini | mock
 * - EXPO_PUBLIC_AI_MAX_TOKENS（預設 1000）
 */

import Constants from "expo-constants";
import { getFunctions, httpsCallable } from "firebase/functions";
import type {
  AssistantActionProposal,
  CampusActorRole,
  EvidenceRef,
  RoleActionPolicy,
} from "../data";
import { getFirebaseApp, hasUsableFirebaseConfig } from "../firebase";
import { buildThinkingChain, type ThinkingStep } from "../data/puAIAgentData";
import { answerWithOnlineSearch, shouldUseWebSearch } from "./webSearch";
import {
  buildAnswerFromLearnedWebItem,
  findRelevantWebLearningItem,
  saveWebLearningAnswer,
} from "./webLearning";
import {
  buildAssistantCapabilityPrompt,
  getAssistantIdentityAnswer,
} from "../data/aiAssistantProfile";

export type AIProvider = "offline" | "cloud" | "mock" | "local-llm" | "gemini";

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
  actions?: AssistantActionProposal[];
  citations?: EvidenceRef[];
  error?: string;
  thinking?: { step: string; detail: string; status: "done" | "checking" | "warning" | "info" }[];
};

type CampusAssistantRequest = {
  messages: AIMessage[];
  context: {
    schoolId?: string;
    screen?: string;
    groupId?: string;
    courseId?: string;
    locale?: string;
    timezone?: string;
    clientCapabilities?: string[];
  };
};

type CampusAssistantResponse = AIResponse & {
  debug?: Record<string, unknown>;
};

export type AIContext = {
  schoolId: string;
  userId?: string;
  userName?: string;
  role?: CampusActorRole;
  // 公開校園資料
  announcements?: Array<{ id: string; title: string; source?: string }>;
  events?: Array<{ id: string; title: string; location?: string; startsAt?: string }>;
  menus?: Array<{ id: string; name: string; price?: number; cafeteria?: string }>;
  pois?: Array<{ id: string; name: string; category?: string }>;
  // 個人化學習資料（新增）
  courses?: Array<{
    id: string;
    name: string;
    teacher?: string;
    dayOfWeek?: number;
    startPeriod?: number;
    endPeriod?: number;
    startTime?: string;
    endTime?: string;
    location?: string;
    credits?: number;
    schedule?: Array<{
      dayOfWeek?: number;
      startPeriod?: number;
      endPeriod?: number;
      startTime?: string;
      endTime?: string;
      location?: string;
    }>;
  }>;
  pendingAssignments?: Array<{ id: string; title: string; groupName: string; dueAt?: string; isLate?: boolean }>;
  gradesSummary?: { gpa?: number; courses: Array<{ name: string; grade?: number; credits?: number }> };
  weeklyReport?: { summary: string; stats: { onTimeRate: number; totalSubmissions: number; newAchievements: number } };
  // 全 App 資料與即時脈動摘要（由 aiAppContext 聚合）
  appPulseSummary?: string;
  appDataCoverage?: Array<{
    key: string;
    label: string;
    count: number;
    state: "live" | "empty" | "missing" | "blocked";
    detail?: string;
  }>;
  // 自動訓練洞察（從歷史對話學習）
  trainingInsights?: string;
  // 對話上下文摘要（讓 API 也知道目前對話狀態）
  contextSummary?: string;
};

const ROLE_ACTION_POLICIES: RoleActionPolicy[] = [
  {
    role: "student",
    allowedActions: ["navigate", "start_navigation", "schedule_reminder", "create_reminder_draft", "split_assignment", "draft_message", "queue_action", "open_url", "check_in"],
    preconditions: ["signed_in", "is_self", "school_member"],
    effects: ["navigate_only", "create_draft", "schedule_local_reminder", "write_user_queue"],
  },
  {
    role: "teacher",
    allowedActions: ["navigate", "start_navigation", "schedule_reminder", "create_reminder_draft", "draft_message", "queue_action", "submit_draft", "open_url", "check_in"],
    preconditions: ["signed_in", "school_member", "teaching_staff"],
    effects: ["navigate_only", "create_draft", "write_group_data", "write_user_queue"],
  },
  {
    role: "staff",
    allowedActions: ["navigate", "start_navigation", "draft_message", "queue_action", "submit_draft", "open_url"],
    preconditions: ["signed_in", "school_member", "service_staff"],
    effects: ["navigate_only", "create_draft", "write_school_data"],
  },
  {
    role: "department",
    allowedActions: ["navigate", "start_navigation", "draft_message", "queue_action", "submit_draft", "open_url"],
    preconditions: ["signed_in", "school_member", "service_staff"],
    effects: ["navigate_only", "create_draft", "write_school_data"],
  },
  {
    role: "department_head",
    allowedActions: ["navigate", "start_navigation", "draft_message", "queue_action", "submit_draft", "open_url"],
    preconditions: ["signed_in", "school_member", "teaching_staff"],
    effects: ["navigate_only", "create_draft", "write_school_data"],
  },
  {
    role: "admin",
    allowedActions: ["navigate", "start_navigation", "draft_message", "queue_action", "submit_draft", "open_url"],
    preconditions: ["signed_in", "school_member", "admin"],
    effects: ["navigate_only", "create_draft", "write_school_data"],
  },
  {
    role: "school",
    allowedActions: ["navigate", "start_navigation", "draft_message", "queue_action", "submit_draft", "open_url"],
    preconditions: ["signed_in", "school_member", "admin"],
    effects: ["navigate_only", "create_draft", "write_school_data"],
  },
];

function getRolePolicy(role?: CampusActorRole): RoleActionPolicy {
  return ROLE_ACTION_POLICIES.find((policy) => policy.role === role) ?? ROLE_ACTION_POLICIES[0];
}

function filterActionsByRole(
  actions: AssistantActionProposal[] | undefined,
  role?: CampusActorRole,
): AssistantActionProposal[] | undefined {
  if (!actions || actions.length === 0) return actions;
  const policy = getRolePolicy(role);
  return actions.filter((action) => policy.allowedActions.includes(action.action));
}

// 上下文顯示筆數（可透過環境變數覆寫）
const CONTEXT_LIMITS = {
  announcements: 8,
  events: 8,
  menus: 8,
  pois: 15,
};

function getConfig() {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  const rawProvider = String(extra.aiProvider ?? process.env.EXPO_PUBLIC_AI_PROVIDER ?? "offline").toLowerCase();
  const rawWebSearch = extra.aiWebSearchEnabled ?? process.env.EXPO_PUBLIC_AI_ENABLE_WEB_SEARCH;
  const rawAppEnv = String(extra.appEnv ?? process.env.APP_ENV ?? process.env.EXPO_PUBLIC_API_ENV ?? "").toLowerCase();
  const isReleaseLike =
    extra.isReleaseLike === true ||
    String(extra.isReleaseLike).toLowerCase() === "true" ||
    rawAppEnv === "preview" ||
    rawAppEnv === "production";
  const provider: AIProvider =
    rawProvider === "mock" ? "mock" :
    rawProvider === "cloud" ? "cloud" :
    rawProvider === "gemini" ? "gemini" :
    rawProvider === "local-llm" ? "local-llm" :
    "offline";
  return {
    aiProvider: provider,
    maxTokens: extra.aiMaxTokens ?? process.env.EXPO_PUBLIC_AI_MAX_TOKENS ?? 1000,
    isReleaseLike,
    webSearchEnabled:
      rawWebSearch == null
        ? process.env.NODE_ENV !== "test"
        : rawWebSearch === true || String(rawWebSearch).toLowerCase() === "true",
  };
}

function isDeviceOnlyProvider(provider: AIProvider): boolean {
  return provider === "offline" || provider === "mock";
}

function isStrictRealDataMode(): boolean {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  const forceFlag = extra.forceRealData ?? process.env.EXPO_PUBLIC_FORCE_REAL_DATA;
  const apiEnv = String(extra.apiEnv ?? process.env.EXPO_PUBLIC_API_ENV ?? "").toLowerCase();
  return forceFlag === true || String(forceFlag).toLowerCase() === "true" || apiEnv === "production";
}

function getCloudFunctionRegion(): string {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  return String(extra.cloudFunctionRegion ?? process.env.EXPO_PUBLIC_CLOUD_FUNCTION_REGION ?? "asia-east1");
}

const DAY_NAMES = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

type CourseContextItem = NonNullable<AIContext["courses"]>[number];
type CourseMeeting = NonNullable<CourseContextItem["schedule"]>[number];

function getCourseMeetings(course: CourseContextItem): CourseMeeting[] {
  if (Array.isArray(course.schedule) && course.schedule.length > 0) {
    return course.schedule.filter((meeting) => typeof meeting.dayOfWeek === "number");
  }
  if (typeof course.dayOfWeek === "number") {
    return [{
      dayOfWeek: course.dayOfWeek,
      startPeriod: course.startPeriod,
      endPeriod: course.endPeriod,
      startTime: course.startTime,
      endTime: course.endTime,
      location: course.location,
    }];
  }
  return [];
}

function getCourseDayOfWeek(course: CourseContextItem): number | undefined {
  return getCourseMeetings(course)[0]?.dayOfWeek;
}

function getMeetingSortValue(meeting?: CourseMeeting): number {
  if (!meeting) return Number.MAX_SAFE_INTEGER;
  if (typeof meeting.startPeriod === "number") return meeting.startPeriod * 100;
  if (meeting.startTime) {
    const [hour, minute] = meeting.startTime.split(":").map(Number);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  }
  return Number.MAX_SAFE_INTEGER;
}

function formatMeetingTime(meeting: CourseMeeting): string {
  if (typeof meeting.startPeriod === "number") {
    const end = typeof meeting.endPeriod === "number" && meeting.endPeriod !== meeting.startPeriod
      ? `-${meeting.endPeriod}`
      : "";
    return `第${meeting.startPeriod}${end}節`;
  }
  if (meeting.startTime && meeting.endTime) return `${meeting.startTime}-${meeting.endTime}`;
  if (meeting.startTime) return meeting.startTime;
  return "時間未提供";
}

function formatCourseMeeting(meeting: CourseMeeting): string {
  const day = typeof meeting.dayOfWeek === "number" ? DAY_NAMES[meeting.dayOfWeek] : "日期未提供";
  const location = meeting.location ? `，${meeting.location}` : "";
  return `${day} ${formatMeetingTime(meeting)}${location}`;
}

function formatCourseSummary(course: CourseContextItem): string {
  const meetings = getCourseMeetings(course);
  const meetingText = meetings.length > 0
    ? meetings.map(formatCourseMeeting).join("；")
    : "時間未提供";
  const teacher = course.teacher ? `，授課：${course.teacher}` : "";
  const credits = typeof course.credits === "number" ? `，${course.credits}學分` : "";
  return `${course.name}（${meetingText}${teacher}${credits}）`;
}

function parseRequestedDay(message: string): { day: number; label: string } {
  if (/明天/.test(message)) {
    const day = (new Date().getDay() + 1) % 7;
    return { day, label: "明天" };
  }
  if (/後天/.test(message)) {
    const day = (new Date().getDay() + 2) % 7;
    return { day, label: "後天" };
  }
  const dayMatch = message.match(/(?:星期|週|禮拜)(一|二|三|四|五|六|日|天)/);
  if (dayMatch) {
    const dayMap: Record<string, number> = { "日": 0, "天": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6 };
    const day = dayMap[dayMatch[1]] ?? new Date().getDay();
    return { day, label: DAY_NAMES[day] };
  }
  const day = new Date().getDay();
  return { day, label: "今天" };
}

function buildSystemPrompt(context: AIContext): string {
  const limits = CONTEXT_LIMITS;
  const now = new Date();
  const hour = now.getHours();
  const mealTime = hour < 10 ? "早餐" : hour < 14 ? "午餐" : hour < 17 ? "下午茶" : "晚餐";
  const config = getConfig();
  const parts = [
    "# 你是「小靜」— 靜宜大學最聰明的 AI 校園助理",
    "",
    "你的目標是用 App 真實資料、工具執行器、動作草稿與多步驟推理，提供接近通用助理的校園代理體驗。",
    "不要宣稱自己和 ChatGPT、Claude、Codex 或任何雲端模型有相同參數量；使用者問模型參數時要誠實說明限制與可提升的能力面。",
    "",
    buildAssistantCapabilityPrompt({
      role: context.role,
      provider: config.aiProvider,
      hasSignedInUser: Boolean(context.userId),
      hasSchoolId: Boolean(context.schoolId),
    }),
    "",
    "## 人格特質",
    "- 像學長姐一樣親切，但知識淵博得像教授",
    "- 說話自然不做作，會用口語但不失準確",
    "- 能讀懂言外之意：「好煩」= 需要情緒支持，「會不會被當」= 學業焦慮",
    "- 有幽默感，但不會在嚴肅話題開玩笑",
    "- 記得對話脈絡，能延續之前的話題",
    "",
    "## 核心能力",
    "1. 深度推理：「我還能畢業嗎？」→ 計算已修學分 vs 128 門檻，分析各類學分夠不夠",
    "2. 跨領域關聯：「下午有空嗎？」→ 同時查課表+作業截止+活動，綜合判斷",
    "3. 情境感知：現在是" + mealTime + "時段，你會根據時間調整回答",
    "4. 個人化分析：根據課表、作業繳交狀況來分析風險",
    "5. 多輪對話：記得前面聊什麼，能處理追問、換話題",
    "6. 生活建議：吃什麼、去哪玩、心情不好都能聊",
    "",
    "## 回答原則（非常重要）",
    "- 繁體中文，友善簡潔，像朋友聊天",
    "- **直接回答不繞圈子**。問「會被當嗎」就分析風險，別回「請查看成績系統」",
    "- **永遠不要只說「沒有資料」就結束**。即使沒有即時資料，也要給有用的一般性建議",
    "- 有個人資料就引用具體數據（課名、截止日）",
    "- 不要捏造數據，但可給常識性建議",
    "- 學生表達情緒 → 先同理再建議",
    "- 簡單問題 2-3 句，複雜問題有結構但不囉嗦",
    "",
    "## 靜宜大學知識庫",
    "",
    "### 基本資訊",
    "靜宜大學 (Providence University)，位於台中市沙鹿區台灣大道七段200號。",
    "1956年創校，天主教大學，校訓「進德修業」，約11000名學生。",
    "",
    "### 學院：外語學院（英文/西語/日語）、人社院（中文/大傳/法律/社工/生態/台文）、管理學院（企管/國企/會計/財金/觀光）、理學院（統資/資科/應化/化粧品/食營）、資訊學院（資工/資管）、國際學院",
    "",
    "### 建築",
    "主顧樓（行政中心+主顧咖啡）、伯鐸樓（B1美食街+教室）、濟時樓（1F學餐+全家）、至善樓（1F衛保+2F諮商）、蓋夏圖書館（藏書60萬+自習區+討論室）、文興樓（外語學院）、思敏樓（管院）、聖方濟樓（理學院）、任垣樓（資訊學院）、體育館（球場+游泳池+健身房）、希嘉/思高學苑（宿舍）",
    "",
    "### 校園餐飲（學生最常問！）",
    "- 以 App 今日菜單、餐廳資料與 DataSource 回傳內容為準。",
    "- 若菜單沒有價格，不要自行排序最便宜；請說「價格未提供」並建議現場或餐廳頁確認。",
    "- 若餐廳未開通接單、營業狀態未知或品項無法確認，不可說已下單；改為草稿或導到點餐頁。",
    "- 現在是" + mealTime + "，推薦時考慮營業時間",
    "",
    "### 重要服務",
    "教務處(主顧樓2F)、學務處(主顧樓3F)、衛保組(至善樓1F,週一~五09:00-16:30)、諮商中心(至善樓2F,免費,04-2632-8001#11501)、圖書館(蓋夏,週一~五08:00-21:30,週六日09:00-17:00)",
    "",
    "### 學術制度",
    "畢業128學分（通識28-32+院必修+系必修+選修）、60分及格、二一制度、選課（初選→加退選→期中退選）、暑修、大二起可申請雙主修/輔系",
    "",
    "### 交通",
    "300/307/308路→台中車站(40-50min)、304→清水、統聯/35路→高鐵台中站(30min)、校門口有YouBike",
    "",
    "### 周邊",
    "沙鹿火車站(10min車程)、三井Outlet(15min)、高美濕地(20min)、沙鹿夜市(週三六)、全聯/美廉社(步行5min)",
    "",
    "## 建議選項",
    "回答結尾可加「建議選項：」+ 1~3個簡短選項（2~6字），如：建議選項：查看詳情、推薦餐點、開啟導航",
    "",
    `## 當前環境：${context.schoolId}，${DAY_NAMES[now.getDay()]} ${now.toLocaleDateString("zh-TW")} ${hour}:${String(now.getMinutes()).padStart(2, "0")}`,
  ];

  if (context.userName) {
    parts.push(`學生姓名：${context.userName}`);
  }

  // ── 個人化學習資料（最重要，放在最前面）──
  if (context.courses && context.courses.length > 0) {
    parts.push("");
    parts.push("【你的課程列表】");
    context.courses.slice(0, 15).forEach((c, i) => {
      parts.push(`${i + 1}. ${formatCourseSummary(c)}`);
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

  if (context.appPulseSummary && context.appPulseSummary.length > 0) {
    parts.push("");
    parts.push("【全 App 即時脈動】");
    parts.push(context.appPulseSummary);
    parts.push("請把這段視為目前使用者狀態與 App 最新資料總覽；回答時優先處理 high/critical、逾期、即將截止、擁擠、未讀或進行中的事項。");
  }

  if (context.appDataCoverage && context.appDataCoverage.length > 0) {
    parts.push("");
    parts.push("【App 資料覆蓋】");
    context.appDataCoverage.slice(0, 18).forEach((row) => {
      parts.push(`- ${row.label}：${row.state}，${row.detail ?? `${row.count} 筆`}`);
    });
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

  // ── 對話上下文注入 ──
  // 讓 Gemini 知道目前的對話狀態（主題、槽位、情緒…）
  if (context.contextSummary && context.contextSummary.length > 0) {
    parts.push("");
    parts.push("【目前對話上下文】");
    parts.push(context.contextSummary);
    parts.push("請根據上下文做出連貫的回答。如果用戶在追問前一個話題，請延續前文而不是重新開始。");
  }

  // ── 自動訓練洞察注入 ──
  // 從歷史對話學習的好範例和反面教材，幫助 AI 持續進步
  if (context.trainingInsights && context.trainingInsights.length > 0) {
    parts.push("");
    parts.push(context.trainingInsights);
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

// ═══════════════════════════════════════════════════════
// 語意意圖引擎 — 不依賴外部 LLM 也能智慧理解
// ═══════════════════════════════════════════════════════

type IntentCategory =
  | "food"         // 餐飲相關
  | "health"       // 健康/身體
  | "course"       // 課程/學分/成績/作業/畢業
  | "location"     // 地點/導航
  | "event"        // 活動/報名
  | "announcement" // 公告/消息
  | "library"      // 圖書館/借書
  | "dorm"         // 宿舍/報修/洗衣/包裹
  | "transport"    // 交通/公車
  | "print"        // 列印
  | "lost_found"   // 失物招領
  | "schedule"     // 行事曆/提醒/時間
  | "greeting"     // 打招呼
  | "thanks"       // 感謝
  | "help"         // 功能/幫助
  | "weather"      // 天氣
  | "mood"         // 心情/壓力
  | "leave"        // 請假
  | "general";     // 一般問答

interface IntentMatch {
  category: IntentCategory;
  confidence: number;
  subIntent?: string;
}

const INTENT_PATTERNS: { category: IntentCategory; patterns: RegExp[]; keywords: string[]; subIntentMap?: Record<string, string[]> }[] = [
  {
    category: "food",
    patterns: [/什麼.*吃/, /吃.*什麼/, /有.*好吃/, /推薦.*[餐飯麵]/, /[餐飯麵].*推薦/, /想吃/, /肚子餓/, /好餓/, /覓食/],
    keywords: ["吃", "餐", "飯", "麵", "湯", "菜", "蔬菜", "肉", "素食", "便當", "小吃", "甜點", "飲料", "外送",
      "午餐", "晚餐", "早餐", "宵夜", "點心", "食物", "餐廳", "餐點", "菜單", "美食", "推薦", "便宜",
      "健康餐", "低卡", "咖啡", "奶茶", "雞排", "滷肉", "排骨", "牛肉", "豬", "海鮮", "火鍋",
      "定食", "套餐", "加蛋", "加大", "辣", "不辣", "清淡", "重口味", "炸", "烤", "涼麵", "沙拉",
      "有哪些", "其他選擇", "還有其他", "別的", "換一個", "多一點", "少一點", "價格", "多少錢", "預算", "划算", "CP值", "平價", "省錢",
      "訂餐", "點餐", "下單", "外帶", "內用", "排隊", "等多久"],
    subIntentMap: {
      "recommend": ["推薦", "建議", "有哪些", "什麼好", "吃什麼", "想吃"],
      "order": ["訂", "點餐", "下單", "幫我訂", "我要"],
      "wait": ["排隊", "等多久", "人多", "等候"],
      "budget": ["便宜", "預算", "多少錢", "價格", "划算", "CP"],
      "dietary": ["素食", "蔬菜", "健康", "低卡", "清淡", "不辣", "過敏"],
    },
  },
  {
    category: "health",
    patterns: [/不舒服/, /頭.*痛/, /肚子.*痛/, /身體.*不/, /想.*看醫/, /需要.*看診/],
    keywords: ["不舒服", "頭痛", "肚子痛", "發燒", "感冒", "咳嗽", "流鼻水", "喉嚨痛",
      "拉肚子", "過敏", "頭暈", "噁心", "想吐", "受傷", "扭到", "痛",
      "看醫生", "掛號", "門診", "看診", "衛保", "諮商", "心理", "牙齒", "牙痛",
      "生病", "藥", "急救", "AED", "緊急"],
  },
  {
    category: "course",
    patterns: [/還有.*多久.*畢業/, /畢業.*還.*多久/, /差.*多少.*學分/, /什麼時候.*畢業/, /能不能.*畢業/,
      /成績.*怎/, /怎.*成績/, /gpa.*多少/, /修.*多少.*學分/, /[幾什].*門課/, /有.*什麼課/, /有課嗎/, /星期.*有課/, /週.*有課/, /禮拜.*有課/],
    keywords: ["畢業", "學分", "成績", "分數", "gpa", "排名", "選課", "退選", "加選",
      "必修", "選修", "通識", "學程", "輔系", "雙主修", "延畢", "本學期", "哪些課", "幾門課",
      "課表", "上什麼課", "今天有課", "明天有課", "幾點上課", "教室",
      "考試", "期中", "期末", "報告", "小考", "quiz",
      "老師", "教授", "助教", "修課", "擋修", "有課", "作業", "待繳", "截止", "繳交", "期限", "幾分"],
  },
  {
    category: "leave",
    patterns: [/想.*請假/, /幫.*請假/, /幫.*請.*假/, /請.*假/, /怎.*請假/, /可以.*請假/],
    keywords: ["請假", "請病假", "病假", "事假", "公假", "喪假", "翹課", "缺課", "曠課", "補假", "請明天的假", "請今天的假"],
  },
  {
    category: "location",
    patterns: [/在哪/, /怎麼走/, /怎麼去/, /哪裡有/, /.*位置/, /.*地址/],
    keywords: ["在哪", "怎麼走", "怎麼去", "地點", "導航", "地圖", "位置", "路線",
      "圖書館", "行政大樓", "體育館", "教室", "實驗室", "停車場", "校門", "操場"],
  },
  {
    category: "event",
    patterns: [/有.*活動/, /什麼.*活動/, /可以.*報名/, /想.*參加/],
    keywords: ["活動", "報名", "參加", "社團", "演講", "工作坊", "比賽", "展覽", "營隊"],
  },
  {
    category: "announcement",
    patterns: [/有.*公告/, /什麼.*消息/, /最新.*通知/],
    keywords: ["公告", "消息", "通知", "最新", "學校公告", "系公告", "重要公告"],
  },
  {
    category: "library",
    patterns: [/想.*借書/, /怎.*借書/, /有.*書/, /找.*書/],
    keywords: ["借書", "還書", "圖書", "書籍", "館藏", "預約座位", "自習", "討論室", "閱覽室", "開館", "閉館"],
  },
  {
    category: "dorm",
    patterns: [/宿舍.*壞/, /.*壞了/, /怎麼.*報修/, /有.*包裹/],
    keywords: ["宿舍", "報修", "壞了", "故障", "維修", "漏水", "冷氣", "熱水器",
      "洗衣機", "烘衣機", "洗衣", "包裹", "快遞", "門禁", "室友", "退宿", "住宿"],
  },
  {
    category: "transport",
    patterns: [/怎麼.*[去到].*[站市]/, /公車.*幾點/, /有.*公車/],
    keywords: ["公車", "搭車", "坐車", "交通", "火車站", "高鐵", "客運", "Uber", "計程車",
      "停車", "腳踏車", "YouBike", "幾號公車"],
  },
  {
    category: "print",
    patterns: [/怎.*列印/, /哪.*列印/, /印.*[報作文]/, /列印.*餘額/],
    keywords: ["列印", "影印", "印表機", "影印卡", "列印餘額", "掃描"],
  },
  {
    category: "lost_found",
    patterns: [/遺失.*[了]/, /掉了/, /不見了/, /撿到/, /找不到.*我的/],
    keywords: ["遺失", "掉了", "不見了", "弄丟", "丟了", "撿到", "拾獲", "失物"],
  },
  {
    category: "schedule",
    patterns: [/提醒.*我/, /別忘.*了/, /幾點.*[要有]/],
    keywords: ["提醒", "鬧鐘", "行事曆", "排程", "日程", "時間表"],
  },
  {
    category: "mood",
    patterns: [/心情.*[不好差]/, /壓力.*大/, /好.*[煩累]/, /覺得.*[焦憂鬱]/],
    keywords: ["心情", "情緒", "壓力", "焦慮", "緊張", "憂鬱", "煩", "累", "低落", "難過", "開心", "快樂"],
  },
  {
    category: "weather",
    patterns: [/會.*下雨/, /要.*帶傘/, /天氣.*怎/, /氣溫.*多少/],
    keywords: ["天氣", "下雨", "氣溫", "帶傘", "防曬", "紫外線"],
  },
  {
    category: "greeting",
    patterns: [/^(嗨|你好|哈囉|hi|hello|hey|早安|午安|晚安|安安|嘿)[\s！!？?。,.]*$/i],
    keywords: [],
  },
  {
    category: "thanks",
    patterns: [/謝謝|感謝|感恩|3q|thx|thanks|好的謝|太好了/i],
    keywords: [],
  },
  {
    category: "help",
    patterns: [/你.*[能會可].*什麼/, /有.*功能/, /怎麼用/, /你.*做.*什麼/],
    keywords: ["功能", "怎麼用", "說明", "幫助", "help", "你能做", "你會什麼"],
  },
];

function classifyIntent(message: string): IntentMatch {
  const msg = message.toLowerCase().trim();
  let bestMatch: IntentMatch = { category: "general", confidence: 0 };

  for (const intent of INTENT_PATTERNS) {
    let score = 0;

    // Pattern matching (high confidence)
    for (const pattern of intent.patterns) {
      if (pattern.test(msg)) { score += 3; break; }
    }

    // Keyword matching (cumulative)
    let kwHits = 0;
    for (const kw of intent.keywords) {
      if (msg.includes(kw)) kwHits++;
    }
    score += Math.min(kwHits * 1.5, 4);

    // SubIntent boost: if subintent keywords also match, boost
    if (intent.subIntentMap) {
      for (const [, subKws] of Object.entries(intent.subIntentMap)) {
        if (subKws.some(k => msg.includes(k))) { score += 0.5; break; }
      }
    }

    if (score > bestMatch.confidence) {
      let subIntent: string | undefined;
      if (intent.subIntentMap) {
        for (const [sub, subKws] of Object.entries(intent.subIntentMap)) {
          if (subKws.some(k => msg.includes(k))) { subIntent = sub; break; }
        }
      }
      bestMatch = { category: intent.category, confidence: score, subIntent };
    }
  }

  return bestMatch;
}

function detectSubIntent(category: IntentCategory, msg: string): string | undefined {
  const intent = INTENT_PATTERNS.find(i => i.category === category);
  if (!intent?.subIntentMap) return undefined;
  for (const [sub, kws] of Object.entries(intent.subIntentMap)) {
    if (kws.some(k => msg.includes(k))) return sub;
  }
  return undefined;
}

function buildOfflineTransitAnswer(message: string): { content: string; suggestions: string[] } | null {
  const q = message.toLowerCase();
  const asksDirections = /怎麼去|怎樣去|如何去|怎麼到|到.*怎麼走|搭什麼|搭哪|幾號公車|路線|交通/.test(q);
  const wantsTaichungStation = /台中車站|臺中車站|台中火車站|臺中火車站|台中.*車站|臺中.*車站/.test(q);
  const wantsHsr = /高鐵|烏日/.test(q);
  const wantsShaluStation = /沙鹿.*(車站|火車站)|沙鹿火車站/.test(q);

  if (!asksDirections && !wantsTaichungStation && !wantsHsr && !wantsShaluStation) return null;

  if (wantsHsr) {
    return {
      content: [
        "從靜宜大學到高鐵台中站：",
        "",
        "1. 公車/客運：在校門口一帶搭往高鐵台中站方向的客運或 35 路，約 30-40 分鐘。",
        "2. 計程車或共乘：約 20-30 分鐘，費用較高但最快。",
        "",
        "離線模式沒有即時到站資訊，建議出發前查台中公車 App。",
      ].join("\n"),
      suggestions: ["怎麼去台中車站", "去沙鹿火車站", "查公車"],
    };
  }

  if (wantsTaichungStation || (/台中/.test(q) && /車站|火車站|站/.test(q))) {
    return {
      content: [
        "從靜宜大學到台中車站：",
        "",
        "1. 直達公車：到校門口台灣大道上的站牌，搭 300、307 或 308 往台中車站方向，約 40-50 分鐘，尖峰可能更久。",
        "2. 台鐵轉乘：先到沙鹿火車站，再搭區間車到台中車站，約 20-30 分鐘車程，但要多一次轉乘。",
        "",
        "離線模式不能查即時班次，出門前請用台中公車 App 或台鐵 App 確認下一班。",
      ].join("\n"),
      suggestions: ["怎麼去高鐵", "去沙鹿火車站", "查公車"],
    };
  }

  if (wantsShaluStation) {
    return {
      content: [
        "從靜宜大學到沙鹿火車站：",
        "",
        "1. 最快：計程車或共乘，約 10 分鐘。",
        "2. 省錢：到校門口周邊搭往沙鹿市區方向的公車，班次請用台中公車 App 確認。",
        "3. 要去台中車站的話，可從沙鹿火車站搭台鐵區間車到台中車站。",
      ].join("\n"),
      suggestions: ["怎麼去台中車站", "怎麼去高鐵", "校門口公車"],
    };
  }

  return null;
}

async function mockAIResponse(
  messages: AIMessage[],
  context: AIContext,
  signal?: AbortSignal
): Promise<AIResponse> {
  const skipMockDelay = process.env.NODE_ENV === "test" || process.env.EXPO_PUBLIC_AI_TEST_FAST === "1";
  if (!skipMockDelay) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, 300 + Math.random() * 400);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timeout);
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        };
        if (signal.aborted) { clearTimeout(timeout); reject(Object.assign(new Error("Aborted"), { name: "AbortError" })); return; }
        signal.addEventListener("abort", onAbort);
      }
    });
  }

  const lastMessage = messages[messages.length - 1]?.content ?? "";
  const lowerMsg = lastMessage.toLowerCase().trim();

  // Classify intent
  let intent = classifyIntent(lastMessage);
  if (intent.category === "general") {
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant")?.content ?? "";
    const diningFollowUp = /便宜|平價|划算|省錢|其他|還有|別的|換|素食|蔬菜|健康|清淡|不辣|第[一二三四五六七八九十\d]+|編號|那道|這道|哪一道/.test(lowerMsg);
    const lastWasDining = /餐|飯|麵|菜單|餐廳|餐點|吃|濟時|伯鐸|靜園|主顧|白鬍子|Morning House|飲料|吐司|蛋餅|鐵板麵|水果杯/.test(lastAssistant);
    if (lastWasDining && diningFollowUp) {
      intent = { category: "food", confidence: 3, subIntent: /便宜|平價|划算|省錢/.test(lowerMsg) ? "budget" : "recommend" };
    }
  }

  // Build thinking chain — 先推理再回答
  const thinkingChain = buildThinkingChain(lastMessage, {
    hasCourses: (context.courses?.length ?? 0) > 0,
    hasAssignments: (context.pendingAssignments?.length ?? 0) > 0,
    hasGrades: !!context.gradesSummary,
    hasAnnouncements: (context.announcements?.length ?? 0) > 0,
    hasEvents: (context.events?.length ?? 0) > 0,
    hasMenus: (context.menus?.length ?? 0) > 0,
    hasPois: (context.pois?.length ?? 0) > 0,
    hasMemory: false,
  });

  const thinking: ThinkingStep[] = thinkingChain.steps;

  const userName = context.userName ?? "同學";
  const hour = new Date().getHours();
  const dayName = DAY_NAMES[new Date().getDay()];
  const config = getConfig();
  const forceOnlineSearch = config.webSearchEnabled && shouldUseWebSearch(lastMessage, intent.category);
  const transitAnswer = forceOnlineSearch ? null : buildOfflineTransitAnswer(lowerMsg);
  if (transitAnswer) {
    return {
      thinking,
      content: transitAnswer.content,
      suggestions: transitAnswer.suggestions,
    };
  }

  const unsafeOrDishonestRequest = /偽造|竄改|作弊|偷看|帳號密碼|密碼|駭|破解|繞過|入侵|盜用/.test(lowerMsg);
  if (unsafeOrDishonestRequest) {
    return {
      thinking,
      content: "這個要求我不能協助，也不會提供偽造、偷看帳號、破解或繞過系統的方法。\n\n如果你是遇到帳號、成績、系統操作或申訴問題，我可以幫你整理正式詢問信、申訴草稿，或告訴你該找哪個校內單位。",
      suggestions: ["幫我寫正式詢問信", "帳號登入有問題", "成績申訴怎麼寫"],
    };
  }

  const wantsDraft = /草稿|幫我寫|寫一封|寫信|寫訊息|訊息跟|公告|email|mail|改寫|潤飾/.test(lowerMsg);
  if (wantsDraft) {
    const cleaned = lastMessage.replace(/幫我寫|寫一封|寫信|寫訊息|草稿|改寫|潤飾/g, "").trim();
    return {
      thinking,
      content: `我先幫你整理一版草稿：\n\n「您好，我想說明：${cleaned || "請在這裡補上具體內容"}。若需要補充資料或調整語氣，我可以再修改。謝謝。」\n\n如果你要更精準，請補上對象、目的、日期和希望語氣。`,
      suggestions: ["正式一點", "短一點", "加上日期"],
    };
  }

  if (forceOnlineSearch) {
    const webAnswer = await answerWithOnlineSearch(lastMessage, signal);
    if (webAnswer) {
      await saveWebLearningAnswer(lastMessage, webAnswer).catch(() => undefined);
      return {
        thinking: [
          ...thinking,
          { step: "連網搜尋", detail: `已查詢 ${webAnswer.sources.length} 個公開來源`, status: "done" },
          { step: "證據整理", detail: "已把搜尋結果整理成結論、依據與來源", status: "done" },
          { step: "本機學習", detail: "已存入來源可追溯的本地 web-learning 知識庫", status: "done" },
        ],
        content: webAnswer.content,
        suggestions: webAnswer.suggestions ?? ["再查一次", "換個關鍵字", "問校園資料"],
      };
    }

    const learnedItem = await findRelevantWebLearningItem(lastMessage, { allowStale: true }).catch(() => null);
    if (learnedItem) {
      const learnedAnswer = buildAnswerFromLearnedWebItem(lastMessage, learnedItem);
      return {
        thinking: [
          ...thinking,
          { step: "連網搜尋", detail: "新搜尋沒有取得可靠結果", status: "warning" },
          { step: "本機知識庫", detail: "改用先前已保存且有來源的 web-learning 資料", status: "done" },
        ],
        content: learnedAnswer.content,
        suggestions: learnedAnswer.suggestions,
      };
    }

    return {
      thinking: [
        ...thinking,
        { step: "連網搜尋", detail: "有嘗試查詢公開來源，但沒有取得可驗證結果", status: "warning" },
      ],
      content: "我有嘗試連網搜尋，但這次沒有取得足夠可靠的公開來源，所以不會亂編答案。\n\n你可以換一個更具體的關鍵字，或指定要查的網站/機構名稱。",
      suggestions: ["換個關鍵字", "指定來源網站", "問校園資料"],
    };
  }

  switch (intent.category) {

    // ── 餐飲 ──
    case "food": {
      const allMenus = context.menus ?? [];
      if (allMenus.length === 0) {
        const h = new Date().getHours();
        const meal = h < 10 ? "早餐" : h < 14 ? "午餐" : h < 17 ? "下午茶" : "晚餐";
        return {
          thinking,
          content: `${meal}時間到！推薦你幾個校園用餐好去處：\n\n1. 濟時樓學生餐廳（1F）— 自助餐 $55起、滷肉飯 $40、排骨飯 $60\n2. 伯鐸樓美食街（B1）— 牛肉麵 $75、鍋燒麵 $60、咖哩飯 $65\n3. 思源樓輕食區（1F）— 三明治 $35、飯糰 $30、沙拉 $50\n\n想吃什麼類型的？我可以更精準推薦！`,
          suggestions: ["便宜的", "有素食嗎", "校門口美食"],
        };
      }

      const subIntent = intent.subIntent ?? detectSubIntent("food", lowerMsg);

      // Dietary preference filtering
      const wantsVeg = /素|蔬菜|菜多|青菜|沙拉|健康|低卡|清淡/.test(lowerMsg);
      const wantsMeat = /肉|雞|豬|牛|排骨|雞腿|牛肉/.test(lowerMsg);
      const wantsCheap = /便宜|划算|省|cp|預算/i.test(lowerMsg);
      const wantsSpicy = /辣|麻/.test(lowerMsg);
      const hasAnyMenuPrice = allMenus.some((m: any) => typeof m.price === "number");

      if (wantsCheap && !hasAnyMenuPrice) {
        return {
          thinking,
          content: [
            "目前離線資料裡的官方菜單沒有單品價格，我不能亂排「最便宜」。",
            "",
            "省錢優先可以先看：",
            "1. 校內便利商店鮮食：飯糰、三明治、微波食品。",
            "2. 靜園餐廳早餐/點心類：吐司、蛋餅、飲料類。",
            "3. 學生餐廳主食類：有現場價格時再決定比較準。",
          ].join("\n"),
          suggestions: ["還有其他選擇嗎", "有素食嗎", "不想吃飯想吃麵"],
        };
      }

      let filtered = [...allMenus];
      let filterDesc = "";

      if (wantsVeg) {
        filtered = allMenus.filter((m: any) => /素|菜|沙拉|蔬|豆腐/.test(m.name));
        filterDesc = "蔬菜/素食";
      } else if (wantsMeat) {
        filtered = allMenus.filter((m: any) => /肉|雞|豬|牛|排|腿|魚/.test(m.name));
        filterDesc = "肉類";
      } else if (wantsCheap) {
        filtered = [...allMenus].sort((a: any, b: any) => (a.price ?? 999) - (b.price ?? 999));
        filterDesc = "平價";
      }

      if (filtered.length === 0) filtered = allMenus;
      const picks = filtered.slice(0, 4);
      const list = picks.map((m: any, i: number) => `${i + 1}. ${m.name}${m.price != null ? ` — $${m.price}` : " — 價格未提供"}${m.cafeteria ? `（${m.cafeteria}）` : ""}`).join("\n");

      const intro = filterDesc
        ? `幫你篩選了${filterDesc}類的餐點：`
        : hour < 10 ? "早餐時段推薦：" : hour < 14 ? "午餐推薦：" : hour < 18 ? "下午茶/點心推薦：" : "晚餐推薦：";

      return {
        thinking,
        content: `${intro}\n\n${list}\n\n${filtered.length > 4 ? `還有 ${filtered.length - 4} 道其他選擇。` : ""}想看哪一道的詳細資訊，或想換條件，直接告訴我。`,
        suggestions: subIntent === "order" ? ["整理點餐內容"] : ["便宜一點的", "其他選擇", "有素食嗎"],
        actions: [{ label: "查看完整菜單", action: "navigate", params: { screen: "校園" } }],
      };
    }

    // ── 健康 ──
    case "health": {
      const wantsBooking = /掛號|預約|看醫|看診/.test(lowerMsg);
      const wantsCounseling = /諮商|心理|壓力|焦慮|憂鬱/.test(lowerMsg);

      if (wantsBooking) {
        return {
          thinking,
          content: `離線模式不能真的送出掛號，但我可以先幫你整理預約資訊。\n\n衛保組門診時間：\n週一～五 09:00-12:00、13:30-16:30\n地點：至善樓 1F 衛保組\n\n你可以補上科別、日期和症狀，我會整理成可送出的掛號內容。`,
          suggestions: ["一般門診草稿", "心理諮商資訊", "衛保組在哪"],
        };
      }
      if (wantsCounseling) {
        return {
          thinking,
          content: `心理諮商預約方式：\n\n1. 初次諮商：需先到諮輔中心填寫初談表\n2. 預約方式：電話 (04)2632-8001 分機 11501\n3. 地點：至善樓 2F 諮商輔導中心\n4. 完全免費且保密\n\n需要我幫你預約嗎？`,
          suggestions: ["幫我預約", "衛保組在哪", "記錄心情"],
        };
      }
      // Symptom description
      return {
        thinking,
        content: `聽起來你身體不太舒服。根據你的描述，建議：\n\n1. 如果症狀輕微：多休息、補充水分\n2. 如果持續不適：到衛保組就診（至善樓 1F）\n3. 嚴重情況：撥打校園緊急專線 (04)2632-8001\n\n門診時間：週一～五 09:00-16:30\n\n需要我幫你預約掛號嗎？`,
        suggestions: ["幫我掛號", "幫我請病假", "AED 在哪"],
      };
    }

    // ── 課程/學分/畢業 ──
    case "course": {
      const courseList = context.courses ?? [];
      const assignments = context.pendingAssignments ?? [];

      // 畢業 / 學分查詢
      if (/畢業|學分|還要修|差多少/.test(lowerMsg)) {
        const currentCredits = courseList.reduce((sum, c) => sum + (c.credits ?? 0), 0);
        const requiredCredits = 128;
        const list = courseList.length > 0
          ? courseList.slice(0, 8).map((c, i) => `${i + 1}. ${c.name}${typeof c.credits === "number" ? `（${c.credits}學分）` : ""}`).join("\n")
          : "目前沒有載入本學期課程。";

        return {
          thinking,
          content: `${userName}，目前我只拿得到已載入的課程資料，不會亂推歷年累計學分。\n\n已載入課程：${courseList.length} 門\n已載入課程合計：${currentCredits} 學分\n畢業門檻參考：${requiredCredits} 學分\n\n${list}\n\n要精準計算「還差多少學分」，需要同步歷年修課/學分試算資料；目前不能只用本學期課表推估。`,
          suggestions: ["查成績", "查未繳作業", "選課建議"],
          actions: [{ label: "前往學分試算", action: "navigate", params: { screen: "我的", nested: "CreditAuditStack" } }],
        };
      }

      // 成績
      if (/成績|分數|gpa|排名|幾分/.test(lowerMsg)) {
        const grades = context.gradesSummary;
        if (grades && grades.courses.length > 0) {
          const list = grades.courses.slice(0, 5).map((c, i) => `${i + 1}. ${c.name}：${c.grade ?? "尚未公布"}${c.credits ? `（${c.credits}學分）` : ""}`).join("\n");
          return {
            thinking,
            content: `你的成績：\n\n${grades.gpa ? `GPA：${grades.gpa.toFixed(2)}\n\n` : ""}${list}`,
            suggestions: ["查學分", "查作業截止"],
          };
        }
        return {
          thinking,
          content: `目前沒有載入你的成績資料，所以我不能推測分數、GPA 或排名。\n\n已載入課程數：${courseList.length} 門。若你要查成績，請先同步成績資料或到成績查詢頁查看。`,
          suggestions: ["查未繳作業", "查學分"],
        };
      }

      // 作業
      if (/作業|截止|deadline|繳交|期限/.test(lowerMsg)) {
        if (assignments.length === 0) {
          return { thinking, content: "目前沒有待繳作業，太棒了！好好放鬆一下。", suggestions: ["推薦午餐", "查活動"] };
        }
        const list = assignments.slice(0, 5).map((a, i) => `${i + 1}. ${a.title}（${a.groupName}）${a.dueAt ? ` — 截止：${a.dueAt}` : ""}${a.isLate ? " ⚠️ 已逾期" : ""}`).join("\n");
        return {
          thinking,
          content: `你有 ${assignments.length} 項待繳作業：\n\n${list}\n\n需要我設定提醒嗎？`,
          suggestions: ["設定提醒", "幫我請假"],
        };
      }

      // 課表 / 今天有什麼課
      if (/課表|什麼課|有課|幾點上課|幾堂課/.test(lowerMsg)) {
        if (courseList.length === 0) {
          return { thinking, content: "目前沒有載入課程資料。你可以在設定中同步課表！", suggestions: ["查公告"] };
        }
        const asksSpecificDay = /今天|明天|後天|星期|週|禮拜|有課|幾點上課|什麼課/.test(lowerMsg) && !/查.*課表|我的課表|本學期/.test(lowerMsg);
        if (!asksSpecificDay) {
          const list = courseList.slice(0, 8).map((c, i) => `${i + 1}. ${formatCourseSummary(c)}`).join("\n");
          return {
            thinking,
            content: `你本學期的課程（共 ${courseList.length} 門）：\n\n${list}\n\n需要查某一天的課也可以直接問，例如「週一有什麼課」。`,
            suggestions: ["週一有什麼課", "查作業截止", "查學分"],
          };
        }
        const { day: targetDay, label: targetDayName } = parseRequestedDay(lowerMsg);
        const dayRows = courseList
          .flatMap((course) => getCourseMeetings(course)
            .filter((meeting) => meeting.dayOfWeek === targetDay)
            .map((meeting) => ({ course, meeting })))
          .sort((a, b) => getMeetingSortValue(a.meeting) - getMeetingSortValue(b.meeting));

        if (dayRows.length === 0) {
          return { thinking, content: `${targetDayName}沒有課！本學期共 ${courseList.length} 門課。要我幫你安排其他事嗎？`, suggestions: ["推薦午餐", "預約圖書館座位"] };
        }
        const list = dayRows.map(({ course, meeting }, i) =>
          `${i + 1}. ${course.name}（${formatMeetingTime(meeting)}${meeting.location ? `，${meeting.location}` : ""}${course.teacher ? `，${course.teacher}` : ""}）`
        ).join("\n");
        return {
          thinking,
          content: `${targetDayName}（${DAY_NAMES[targetDay]}）有 ${dayRows.length} 堂課：\n\n${list}`,
          suggestions: ["設定上課提醒", "幫我請假"],
        };
      }

      // General course info
      if (courseList.length > 0) {
        const list = courseList.slice(0, 8).map((c, i) => `${i + 1}. ${formatCourseSummary(c)}`).join("\n");
        return {
          thinking,
          content: `你本學期的課程（共 ${courseList.length} 門）：\n\n${list}\n\n需要查什麼嗎？`,
          suggestions: ["查成績", "查作業截止", "查學分"],
        };
      }
      return { thinking, content: "目前沒有載入課程資料。你可以在設定中同步課表！", suggestions: ["查公告", "推薦午餐"] };
    }

    // ── 請假 ──
    case "leave": {
      return {
        thinking,
        content: `離線模式不能真的送出請假申請，但我可以先幫你整理請假草稿。\n\n需要以下資訊：\n1. 課程名稱\n2. 請假日期\n3. 假別（病假/事假/公假）\n4. 事由說明\n\n你可以直接說「明天程式設計病假，原因是發燒」，我會整理成可貼到系統的內容。`,
        suggestions: ["病假草稿", "事假草稿", "查課表"],
      };
    }

    // ── 地點 ──
    case "location": {
      const allPois = context.pois ?? [];
      // Try to extract target location from message
      const locationKeywords = ["圖書館", "餐廳", "行政", "體育", "宿舍", "教室", "停車", "校門", "操場", "實驗室", "伯鐸", "至善", "文興", "思敏", "聖方"];
      let targetKw = "";
      for (const kw of locationKeywords) {
        if (lowerMsg.includes(kw)) { targetKw = kw; break; }
      }

      if (targetKw && allPois.length > 0) {
        const matches = allPois.filter((p: any) => p.name.includes(targetKw) || (p.category && p.category.includes(targetKw)));
        if (matches.length > 0) {
          const poi = matches[0] as any;
          return {
            thinking,
            content: `找到了！「${poi.name}」位於${poi.category ? ` ${poi.category} 區域` : "校園內"}。\n\n要開啟地圖導航嗎？`,
            suggestions: ["開啟導航", "附近還有什麼"],
            actions: [
              { label: "在地圖上查看", action: "navigate", params: { screen: "校園", nested: "PoiDetail", id: poi.id } },
            ],
          };
        }
      }

      return {
        thinking,
        content: "你想找什麼地方呢？我可以幫你找到校園內任何地點並導航。\n\n常見地點：圖書館、學生餐廳、行政大樓、體育館、各教學大樓。",
        suggestions: ["圖書館在哪", "餐廳在哪", "開啟地圖"],
        actions: [{ label: "開啟校園地圖", action: "navigate", params: { screen: "校園" } }],
      };
    }

    // ── 活動 ──
    case "event": {
      const eventList = context.events ?? [];
      if (eventList.length === 0) {
        return { thinking, content: "近期沒有登錄的活動。新活動公布時我會通知你！", suggestions: ["查公告", "推薦午餐"] };
      }
      const list = eventList.slice(0, 4).map((e, i) => `${i + 1}. ${e.title}${e.location ? `（${e.location}）` : ""}${e.startsAt ? ` — ${e.startsAt}` : ""}`).join("\n");
      return {
        thinking,
        content: `近期有 ${eventList.length} 個活動：\n\n${list}\n\n想報名哪一個？`,
        suggestions: ["查看更多", "報名活動"],
      };
    }

    // ── 公告 ──
    case "announcement": {
      const annList = context.announcements ?? [];
      if (annList.length === 0) {
        return { thinking, content: "目前沒有新公告。", suggestions: ["查活動", "推薦午餐"] };
      }
      const list = annList.slice(0, 4).map((a, i) => `${i + 1}. ${a.title}${a.source ? `（${a.source}）` : ""}`).join("\n");
      return {
        thinking,
        content: `最新公告（共 ${annList.length} 則）：\n\n${list}\n\n想看哪一則的詳情？`,
        suggestions: ["查看詳情", "查活動"],
      };
    }

    // ── 圖書館 ──
    case "library": {
      if (/座位|自習|討論室/.test(lowerMsg)) {
        return {
          thinking,
          content: `我可以幫你預約圖書館座位！蓋夏圖書館資訊：\n\n開放時間：週一～五 08:00-21:30、週六日 09:00-17:00\n座位類型：個人自習、安靜閱覽區、團體討論室\n\n想預約哪種座位？`,
          suggestions: ["個人座位", "團體討論室", "安靜閱覽區"],
        };
      }
      if (/借|書|找書|館藏/.test(lowerMsg)) {
        return {
          thinking,
          content: `告訴我你想找的書名、作者或 ISBN，我幫你搜尋蓋夏圖書館的館藏！\n\n也可以直接在圖書館系統搜尋。`,
          suggestions: ["查詢館藏", "預約座位"],
        };
      }
      return {
        thinking,
        content: `蓋夏圖書館資訊：\n\n開放時間：週一～五 08:00-21:30\n地點：蓋夏圖書館（校園中央）\n\n我可以幫你預約座位或搜尋書籍！`,
        suggestions: ["預約座位", "借書查詢", "圖書館在哪"],
      };
    }

    // ── 宿舍 ──
    case "dorm": {
      if (/壞|報修|故障|維修|漏/.test(lowerMsg)) {
        return {
          thinking,
          content: `離線模式不能真的提交報修單，但我可以幫你整理報修草稿。\n\n請補上：\n1. 問題類型（水管/電力/冷氣/家具/網路）\n2. 房號\n3. 問題描述\n\n例如：「冷氣不冷，房號 A305」。`,
          suggestions: ["冷氣報修草稿", "水管報修草稿", "網路報修草稿"],
        };
      }
      if (/洗衣|烘衣/.test(lowerMsg)) {
        return {
          thinking,
          content: `洗衣機/烘衣機狀態需要即時查詢。我可以幫你發送查詢請求！\n\n宿舍洗衣房位置：\n• 希嘉學苑 — 1F 洗衣間\n• 思高學苑 — 1F 洗衣間\n\n要我幫你查詢目前狀態嗎？`,
          suggestions: ["查詢洗衣機狀態", "設定完成提醒", "查包裹"],
        };
      }
      if (/包裹|快遞|取件/.test(lowerMsg)) {
        return {
          thinking,
          content: `我可以幫你查詢是否有待領包裹！\n\n領取資訊：\n• 地點：宿舍管理室\n• 時間：08:00-21:00\n• 需攜帶：學生證\n\n要我幫你查詢嗎？`,
          suggestions: ["查詢包裹", "設定取件提醒"],
        };
      }
      return {
        thinking,
        content: `宿舍相關服務：\n\n1. 設施報修 — 水電/冷氣/網路\n2. 洗衣機狀態查詢\n3. 包裹查詢\n4. 門禁申請\n\n需要哪項服務？`,
        suggestions: ["報修", "查洗衣機", "查包裹"],
      };
    }

    // ── 交通 ──
    case "transport": {
      return {
        thinking,
        content: `靜宜大學（沙鹿區）常用公車路線：\n\n• 300 路 — 往台中火車站（約 40 分鐘）\n• 301 路 — 往新光三越\n• 35 路 — 往高鐵台中站\n\n⚠️ 以上為固定路線資訊，即時到站時間請查詢「台中公車」APP 或站牌電子看板。\n\n校門口站牌位於校門左側。`,
        suggestions: ["開啟地圖", "查活動"],
      };
    }

    // ── 列印 ──
    case "print": {
      if (/餘額|額度/.test(lowerMsg)) {
        return { thinking, content: "⚠️ 影印卡餘額需要在校園列印系統登入後才能查詢，我目前無法即時讀取。\n\n你可以到圖書館 1F 儲值機查詢與加值（接受現金和學生證綁定）。", suggestions: ["列印文件", "圖書館在哪"] };
      }
      return {
        thinking,
        content: `校園列印服務資訊：\n\n列印點：圖書館 1F/B1、伯鐸樓 3F、行政大樓 1F\n價格：黑白 $1/頁、彩色 $10/頁\n\n需要列印可以告訴我檔案名稱，我幫你排入佇列！`,
        suggestions: ["列印文件", "圖書館在哪"],
      };
    }

    // ── 失物招領 ──
    case "lost_found": {
      if (/掉|遺失|丟|不見/.test(lowerMsg)) {
        return {
          thinking,
          content: `別擔心！我可以幫你發布遺失公告，AI 會自動比對拾獲物資料庫。\n\n請告訴我：\n1. 遺失物品\n2. 大約在哪裡丟的\n3. 物品特徵（顏色/品牌/貼紙等）`,
          suggestions: ["學生證不見了", "手機掉了", "鑰匙丟了"],
        };
      }
      return {
        thinking,
        content: `失物招領服務：\n\n1. 報失 — AI 自動比對\n2. 搜尋拾獲物\n3. 認領通知\n\n需要哪項服務？`,
        suggestions: ["我東西掉了", "搜尋拾獲物"],
      };
    }

    // ── 提醒/行事曆 ──
    case "schedule": {
      return {
        thinking,
        content: `我可以幫你設定提醒！請告訴我：\n\n1. 提醒內容\n2. 時間（例如：明天下午 2 點、3 小時後）\n\n例如：「提醒我明天交程式設計作業」`,
        suggestions: ["查作業截止", "查課表"],
      };
    }

    // ── 心情 ──
    case "mood": {
      if (/壓力|焦慮|憂|煩|累|低落|難過/.test(lowerMsg)) {
        return {
          thinking,
          content: `聽起來你最近壓力不小。記住，感到壓力是很正常的。\n\n一些建議：\n1. 深呼吸，暫時放下手邊的事\n2. 到校園走走散心\n3. 和朋友聊聊天\n\n如果持續感到不適，學校有免費的心理諮商服務（諮輔中心，至善樓 2F）。\n\n要記錄一下今天的心情嗎？`,
          suggestions: ["記錄心情", "預約諮商", "推薦散步路線"],
        };
      }
      return {
        thinking,
        content: `要記錄今天的心情嗎？持續記錄可以幫助你了解情緒變化趨勢。\n\n選擇你現在的感受：`,
        suggestions: ["😄 很好", "🙂 不錯", "😐 普通", "😟 不太好"],
      };
    }

    // ── 天氣 ──
    case "weather": {
      const month = new Date().getMonth() + 1;
      const seasonalTip = (month >= 5 && month <= 9)
        ? "台中 5-9 月為雨季，午後常有雷陣雨，建議攜帶雨具。"
        : (month >= 11 || month <= 2)
        ? "台中冬季乾冷，沙鹿近海風較大，建議穿外套。"
        : "台中春秋天氣舒適，偶有午後短暫陣雨。";
      return {
        thinking,
        content: `⚠️ 我沒有即時天氣資料，以下是根據季節的一般參考：\n\n${seasonalTip}\n\n靜宜大學位於台中市沙鹿區，建議查詢中央氣象署或天氣 APP 取得即時預報。`,
        suggestions: ["查公車", "推薦午餐"],
      };
    }

    // ── 打招呼 ──
    case "greeting": {
      const timeGreet = hour < 12 ? "早安" : hour < 18 ? "午安" : "晚安";
      return {
        thinking,
        content: `${timeGreet} ${userName}！我是校園 AI 助理。\n\n我可以回答校園資訊、整理課表作業、推薦餐點與交通路線，也能幫你寫請假、報修、失物公告等草稿。當 App 資料源支援且你按下確認卡時，我可以把訂餐、掛號、報修、預約座位、提醒等動作交給 executor 執行。\n\n離線對話本身不呼叫雲端 LLM；如果資料源不可用，我會退回草稿，不會假裝已送出。`,
        suggestions: hour < 11 ? ["今天有什麼課", "查公告"] : hour < 14 ? ["推薦午餐", "查作業截止"] : ["預約圖書館座位", "查公車"],
      };
    }

    // ── 感謝 ──
    case "thanks": {
      return { thinking, content: "不客氣！有需要隨時叫我 😊", suggestions: ["推薦午餐", "查作業"] };
    }

    // ── 功能說明 ──
    case "help": {
      return {
        thinking,
        content: `我是校園 AI 代理，能幫你做這些事：\n\n🍽️ 推薦餐點 / 查餐廳資訊 / 確認後送出支援的點餐\n🏥 健康建議 / 衛保組與心理諮商資訊 / 確認後掛號或建草稿\n📚 圖書館位置、借書與座位資訊 / 確認後預約可用座位\n🏠 宿舍報修、洗衣、包裹資訊 / 確認後提交支援的報修\n📖 課表、作業、成績與學分資料整理\n🚌 靜宜到台中車站、高鐵、沙鹿火車站等交通建議\n📝 請假信、失物公告、訊息與課程發布草稿\n🔔 本地主動回報：課前提醒、作業截止/逾期、每日摘要、重要公告\n\n會寫入或通知他人的動作都會先停在確認卡；缺 API 或缺識別資料時只建立草稿/導頁。`,
        suggestions: ["推薦午餐", "我頭有點痛", "怎麼去台中車站"],
      };
    }

    // ── 一般問答（兜底）──
    default: {
      // Try to give a contextually relevant response instead of generic
      const hasCourses = (context.courses?.length ?? 0) > 0;
      const hasAssignments = (context.pendingAssignments?.length ?? 0) > 0;
      const isIdentityQuestion = /你是誰|你是什麼|什麼模型|模型|離線|本地|chatgpt|gpt|codex|智商|多聰明|參數|parameter|權重|訓練|跟.*一樣/.test(lowerMsg);
      const isComplaint = /笨|很爛|不好用|答錯|錯了|不聰明|沒用|廢|亂回|答非所問/.test(lowerMsg);
      const wantsDraft = /草稿|幫我寫|寫一封|寫信|寫訊息|訊息跟|公告|email|mail|改寫|潤飾/.test(lowerMsg);

      if (isComplaint) {
        return {
          thinking,
          content: `你說得對，離線版目前不是雲端大模型，所以如果問題太開放，我可能會答得很死板。\n\n我會比較擅長這幾類：\n1. 校園生活資訊：餐廳、圖書館、宿舍、交通、健康\n2. 個人資料整理：課表、作業、學分、提醒\n3. 草稿生成：請假信、報修單、失物公告、群組訊息\n\n你可以直接把剛剛那題再貼一次，我會用「先判斷需求 → 找本地資料 → 給可執行建議」的方式回答。`,
          suggestions: ["重新回答", "你能做什麼", "請假信草稿"],
        };
      }

      if (isIdentityQuestion) {
        return {
          thinking,
          content: getAssistantIdentityAnswer(config.aiProvider),
          suggestions: ["你能做什麼", "推薦午餐", "幫我寫草稿"],
        };
      }

      if (wantsDraft) {
        return {
          thinking,
          content: `我先幫你整理一版可修改的草稿：\n\n「您好，我想說明：${lastMessage.replace(/幫我寫|寫一封|草稿|改寫|潤飾/g, "").trim() || "請在這裡補上具體內容"}。若需要我補充資料或調整語氣，我可以再修改。謝謝。」\n\n如果你要更像正式信件，請補上對象、目的、日期和希望語氣。`,
          suggestions: ["正式一點", "短一點", "加上日期"],
        };
      }

      // Check if the message is a question
      const isQuestion = /[？?]|嗎|什麼|怎麼|哪裡|誰|幾|多少|為什麼|可以嗎|能不能|有沒有/.test(lowerMsg);

      if (isQuestion) {
        // Attempt to relate to campus context
        const contextHints: string[] = [];
        if (hasAssignments) contextHints.push(`你有 ${context.pendingAssignments!.length} 項待繳作業`);
        if (hasCourses) contextHints.push(`本學期修 ${context.courses!.length} 門課`);

        return {
          thinking,
          content: `這題我沒有足夠的離線知識可以可靠回答，所以不亂編。\n\n我目前比較擅長校園情境：餐飲、課表、作業、圖書館、宿舍、交通、健康、請假/報修草稿。\n\n${contextHints.length > 0 ? `順帶一提：${contextHints.join("，")}。\n\n` : ""}你可以把問題改成「在校園 App 裡我要怎麼做？」或直接給我具體任務，我會比較準。`,
          suggestions: hasAssignments ? ["查未繳作業", "推薦午餐", "查成績"] : ["推薦午餐", "今天有什麼課", "查公車"],
        };
      }

      // Non-question general message
      return {
        thinking,
        content: `收到！不確定你想做什麼，但我可以幫你很多事。試試這些：\n\n• 「幫我推薦午餐」\n• 「我還有多久畢業」\n• 「預約圖書館座位」\n• 「幫我請明天的假」\n\n直接告訴我你的需求！`,
        suggestions: ["推薦午餐", "查作業截止", "查成績"],
      };
    }
  }
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
        screen: (context as any).screen,
        groupId: (context as any).groupId,
        courseId: (context as any).courseId,
        locale: "zh-TW",
        timezone: "Asia/Taipei",
      },
    });

    const data = result.data;
    const filteredActions = filterActionsByRole(data.actions, context.role);
    return {
      content: data.content ?? "",
      suggestions: data.suggestions ?? extractSuggestions(data.content ?? ""),
      actions: filteredActions,
      citations: data.citations,
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
    if (config.isReleaseLike) {
      const managedResponse = await callManagedAI(messages, context, signal);
      if (managedResponse) return managedResponse;
      return {
        content: "",
        error: "AI 服務目前無法連線；上架版本只允許透過後端代理呼叫 AI。",
      };
    }

    if (isDeviceOnlyProvider(config.aiProvider)) {
      return await mockAIResponse(messages, context, signal);
    }

    // ── Gemini 優先：全站統一走 Gemini ──
    if (config.aiProvider === "gemini") {
      await waitForRateLimit();
      const geminiResponse = await callGeminiAPI(messages, context, signal);
      if (geminiResponse) {
        resetRateLimitState();
        return geminiResponse;
      }
      // Gemini 失敗 → mock
      return await mockAIResponse(messages, context, signal);
    }

    if (config.aiProvider === "local-llm") {
      const localResponse = await callLocalLLM(messages, context, signal);
      if (localResponse) return localResponse;
      return await mockAIResponse(messages, context, signal);
    }

    const managedResponse = await callManagedAI(messages, context, signal);
    if (managedResponse) {
      return managedResponse;
    }

    if (isStrictRealDataMode()) {
      return {
        content: "",
        error: "AI 服務目前無法連線；已停用 mock 回退以確保真實資料路徑。",
      };
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
  const config = getConfig();

  if (config.isReleaseLike) {
    const cloudResponse = await callManagedAI(messages, context, signal);
    if (cloudResponse) return cloudResponse;
    return {
      content: "",
      error: "Campus Assistant 暫時不可用；上架版本只允許透過後端代理呼叫 AI。",
    };
  }

  // ── Offline 模式：完全不呼叫雲端或本地 server ──
  if (isDeviceOnlyProvider(config.aiProvider)) {
    return mockAIResponse(messages, context, signal);
  }

  // ── Gemini 優先模式：直接用 Gemini API（真正的 LLM 理解力） ──
  if (config.aiProvider === "gemini") {
    try {
      const geminiResponse = await callGeminiAPI(messages, context, signal);
      if (geminiResponse) return geminiResponse;
    } catch (e: any) {
      if (e.name === "AbortError") throw e;
      console.warn("[AI] Gemini failed, falling back:", e);
    }
    // Gemini 失敗 → mock
    return mockAIResponse(messages, context, signal);
  }

  // ── Local LLM 模式 ──
  if (config.aiProvider === "local-llm") {
    const localResponse = await callLocalLLM(messages, context, signal);
    if (localResponse) return localResponse;
  }

  // ── Cloud 模式 ──
  const cloudResponse = await callManagedAI(messages, context, signal);
  if (cloudResponse) return cloudResponse;

  if (isStrictRealDataMode()) {
    return {
      content: "",
      error: "Campus Assistant 暫時不可用；已停用 mock 回退以維持真實資料策略。",
    };
  }

  // ── 所有外部服務失敗 → 嘗試 Gemini → mock ──
  try {
    const geminiResponse = await callGeminiAPI(messages, context, signal);
    if (geminiResponse) return geminiResponse;
  } catch (e: any) {
    if (e.name === "AbortError") throw e;
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
export function getAIStatus(): { provider: AIProvider; configured: boolean; webSearchEnabled: boolean } {
  const config = getConfig();
  const configured = config.isReleaseLike
    ? hasUsableFirebaseConfig()
    : config.aiProvider === "offline" ||
      config.aiProvider === "mock" ||
      config.aiProvider === "local-llm" ||
      config.aiProvider === "gemini" ||
      hasUsableFirebaseConfig();

  return { provider: config.aiProvider, configured, webSearchEnabled: config.webSearchEnabled };
}

/**
 * 產生 AI 摘要（用於公告等）
 */
export async function generateSummary(text: string, maxLength = 100): Promise<string> {
  const config = getConfig();

  if (isDeviceOnlyProvider(config.aiProvider)) {
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

// ─── Gemini API Integration (development-only direct mode) ─────────────
// 正式/上架 build 不能直接使用 EXPO_PUBLIC_GEMINI_API_KEY；production 只走後端代理。
// 僅限本機測試時設定 .env: EXPO_PUBLIC_GEMINI_API_KEY=你的key

function getGeminiApiKey(): string | null {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  return extra.geminiApiKey ?? process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? null;
}

/**
 * 呼叫 Google Gemini API（開發測試用 direct mode）。
 * 正式版本會在進入這裡前改走 callManagedAI。
 */
async function callGeminiAPI(
  messages: AIMessage[],
  context: AIContext,
  signal?: AbortSignal,
): Promise<AIResponse | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  const systemPrompt = buildSystemPrompt(context);

  // Build Gemini-format messages
  const geminiContents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  // System instruction goes as first "user" turn with model acknowledgment
  geminiContents.push({ role: "user", parts: [{ text: systemPrompt }] });
  geminiContents.push({ role: "model", parts: [{ text: "明白！我已了解所有校園資料和你的個人資訊，我會根據這些真實資料來回答你的問題。有什麼我可以幫你的？" }] });

  // Add conversation history
  for (const msg of messages) {
    if (msg.role === "system") continue;
    geminiContents.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    });
  }

  // Ensure last message is from user
  if (geminiContents.length > 0 && geminiContents[geminiContents.length - 1].role !== "user") {
    return null;
  }

  try {
    const model = "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        contents: geminiContents,
        generationConfig: {
          temperature: 0.8,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ],
      }),
    });

    if (!resp.ok) {
      console.warn(`[AI] Gemini API error: ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    // Parse suggestions from response
    const suggestions = extractSuggestions(text);

    // Clean the content (remove the "建議選項：..." line from display)
    const cleanContent = text.replace(/\n*(?:建議選項|建議)[：:][^\n]*/g, "").trim();

    return {
      content: cleanContent,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  } catch (e: any) {
    if (e.name === "AbortError") throw e;
    console.warn("[AI] Gemini API call failed:", e);
    return null;
  }
}

// ─── Local LLM (FastAPI) Integration ────────────────────────────────

import { getAIServerBaseUrl } from "./cloudFunctions";

/**
 * 呼叫本地 LLM server（非 streaming）
 */
async function callLocalLLM(
  messages: AIMessage[],
  context: AIContext,
  signal?: AbortSignal,
): Promise<AIResponse | null> {
  const baseUrl = getAIServerBaseUrl();
  const lastMessage = messages[messages.length - 1]?.content ?? "";
  const history = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));

  try {
    const resp = await fetch(`${baseUrl}/api/chat/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        message: lastMessage,
        history,
        context: {
          schoolId: context.schoolId,
          userId: context.userId,
          userName: context.userName,
          announcements: context.announcements?.slice(0, 5),
          events: context.events?.slice(0, 5),
          menus: context.menus?.slice(0, 10),
          pois: context.pois?.slice(0, 10),
          courses: context.courses,
          pendingAssignments: context.pendingAssignments,
          gradesSummary: context.gradesSummary,
          weeklyReport: context.weeklyReport,
          appPulseSummary: context.appPulseSummary,
          appDataCoverage: context.appDataCoverage,
        },
        stream: false,
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      content: data.content ?? "",
      suggestions: data.suggestions ?? extractSuggestions(data.content ?? ""),
    };
  } catch (e) {
    console.warn("[AI] Local LLM call failed:", e);
    return null;
  }
}

export type StreamingCallback = (partial: string, done: boolean) => void;

/**
 * 呼叫本地 LLM server（SSE streaming），逐 token 回傳。
 */
export async function chatWithLocalLLMStreaming(
  messages: AIMessage[],
  context: AIContext,
  onToken: StreamingCallback,
  signal?: AbortSignal,
): Promise<AIResponse> {
  const config = getConfig();

  if (config.isReleaseLike) {
    const cloudResponse = await callManagedAI(messages, context, signal);
    if (cloudResponse) {
      onToken(cloudResponse.content, true);
      return cloudResponse;
    }
    const errorResponse = {
      content: "",
      error: "Campus Assistant 暫時不可用；上架版本只允許透過後端代理呼叫 AI。",
    };
    onToken("", true);
    return errorResponse;
  }

  // ── Offline / Mock 模式：用內建語意引擎產生完整答案，不發送任何網路請求 ──
  if (isDeviceOnlyProvider(config.aiProvider)) {
    const fallback = await mockAIResponse(messages, context, signal);
    onToken(fallback.content, true);
    return fallback;
  }

  // ── On-Device LLM 模式：完全本地推理（llama.rn） ──
  if (config.aiProvider === "local-llm") {
    try {
      const { localAssistant } = await import("./localAssistant");
      if (localAssistant.isModelReady()) {
        const lastMsg = messages[messages.length - 1]?.content ?? "";
        const result = await localAssistant.chat(lastMsg, {
          onToken: (token) => onToken(token, false),
          signal,
        });
        onToken(result.content, true);
        return {
          content: result.content,
          suggestions: extractSuggestions(result.content),
        };
      }
    } catch (e: any) {
      console.warn("[AI] On-device LLM failed:", e);
    }
    // On-device LLM 不可用 → fallback to offline engine
    const fallback = await mockAIResponse(messages, context, signal);
    onToken(fallback.content, true);
    return fallback;
  }

  // ── Gemini 模式：直接呼叫 Gemini，不嘗試 Local LLM ──
  if (config.aiProvider === "gemini") {
    try {
      const geminiResponse = await callGeminiAPI(messages, context, signal);
      if (geminiResponse) {
        onToken(geminiResponse.content, true);
        return geminiResponse;
      }
    } catch (e: any) {
      if (e.name === "AbortError") return { content: "", error: "請求已取消" };
      console.warn("[AI] Gemini direct call failed:", e);
    }
    // Gemini 失敗 → mock
    const fallback = await mockAIResponse(messages, context, signal);
    onToken(fallback.content, true);
    return fallback;
  }

  // ── Local LLM 模式：嘗試 streaming ──
  const baseUrl = getAIServerBaseUrl();
  const lastMessage = messages[messages.length - 1]?.content ?? "";
  const history = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));

  let fullContent = "";

  try {
    const resp = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        message: lastMessage,
        history,
        context: {
          schoolId: context.schoolId,
          userId: context.userId,
          userName: context.userName,
          announcements: context.announcements?.slice(0, 5),
          events: context.events?.slice(0, 5),
          menus: context.menus?.slice(0, 10),
          pois: context.pois?.slice(0, 10),
          courses: context.courses,
          pendingAssignments: context.pendingAssignments,
          gradesSummary: context.gradesSummary,
          weeklyReport: context.weeklyReport,
          appPulseSummary: context.appPulseSummary,
          appDataCoverage: context.appDataCoverage,
        },
        stream: true,
      }),
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.token) {
            fullContent += payload.token;
            onToken(fullContent, false);
          }
          if (payload.done) {
            onToken(fullContent, true);
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
  } catch (e: any) {
    if (e.name === "AbortError") {
      return { content: fullContent || "", error: "請求已取消" };
    }
    console.warn("[AI] Streaming error:", e);
    if (!fullContent) {
      // Try Gemini before falling back to mock
      try {
        const geminiResponse = await callGeminiAPI(messages, context, signal);
        if (geminiResponse) {
          onToken(geminiResponse.content, true);
          return geminiResponse;
        }
      } catch (ge: any) {
        if (ge.name === "AbortError") return { content: "", error: "請求已取消" };
        console.warn("[AI] Gemini fallback failed:", ge);
      }
      const fallback = await mockAIResponse(messages, context, signal);
      return fallback;
    }
  }

  return {
    content: fullContent,
    suggestions: extractSuggestions(fullContent),
  };
}

/**
 * 提交使用者回饋到本地 LLM server，驅動自我訓練。
 */
export async function submitFeedback(params: {
  messageId: string;
  userMessage: string;
  assistantResponse: string;
  rating: "thumbs_up" | "thumbs_down";
  userId?: string;
}): Promise<void> {
  const config = getConfig();
  if (isDeviceOnlyProvider(config.aiProvider)) {
    return;
  }

  const baseUrl = getAIServerBaseUrl();
  try {
    await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message_id: params.messageId,
        user_message: params.userMessage,
        assistant_response: params.assistantResponse,
        rating: params.rating,
        user_id: params.userId,
      }),
    });
  } catch (e) {
    console.warn("[AI] Feedback submission failed:", e);
  }
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
