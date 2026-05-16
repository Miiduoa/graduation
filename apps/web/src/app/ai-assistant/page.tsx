'use client';

import { SiteShell } from '@/components/SiteShell';
import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, type DemoRole } from '@/lib/demoRole';
import { buildAISystemContext, getCreditSummary } from '@/lib/aiContext';
import {
  NEXT_SEM_COURSES,
  type CreditCategory,
  DEMO_ANNOUNCEMENTS,
  DEMO_CLUBS,
} from '@/lib/demoData';

// ── 型別 ──────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type QuickPrompt = {
  label: string;
  icon: string;
  prompt: string;
};

// ── 快速提示詞 ─────────────────────────────────────────────────
const QUICK_PROMPTS: QuickPrompt[] = [
  {
    label: '下學期選什麼？',
    icon: '📚',
    prompt: '我下學期應該選哪幾門課？請根據我的學分缺口和成績幫我推薦最佳組合。',
  },
  {
    label: '幾年可以畢業？',
    icon: '🎓',
    prompt: '按照我目前的修課進度，預計幾年可以畢業？有什麼需要加速的地方嗎？',
  },
  {
    label: '衝堂檢查',
    icon: '⚠️',
    prompt: '如果我下學期同時選「人工智慧導論」和「機器學習實務」，會有衝堂問題嗎？',
  },
  {
    label: '學期完整規劃',
    icon: '📋',
    prompt: '請幫我規劃大三下和大四的選課計畫，讓我能在大四下順利畢業。',
  },
  {
    label: '成績弱項建議',
    icon: '💡',
    prompt: '根據我的歷史成績，有哪些科目我比較弱？選進階課前有什麼需要注意的？',
  },
  {
    label: '通識學分補齊',
    icon: '🌍',
    prompt: '我的通識學分還差多少？下學期有哪些推薦的通識課可以選？',
  },
];

// ── 顏色 ──────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<CreditCategory, string> = {
  required: '#5E6AD2',
  elective: '#34C759',
  general: '#FF9500',
  pe: '#FF3B30',
  other: '#8E8E93',
};

// ── AI 回應（模擬 + Anthropic API） ──────────────────────────────
async function callAI(messages: { role: string; content: string }[]): Promise<string> {
  // 嘗試呼叫 API route（若設定好就用真的 AI）
  try {
    const res = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = (await res.json()) as { reply?: string };
      if (data.reply) return data.reply;
    }
  } catch {
    // fallback to demo reply
  }

  // Demo 回應（API 未設定時的 fallback）
  const summary = getCreditSummary();
  const lastUserMsg = messages[messages.length - 1]?.content ?? '';

  // 衝堂相關
  if (
    lastUserMsg.includes('衝堂') ||
    lastUserMsg.includes('人工智慧') ||
    lastUserMsg.includes('機器學習實務')
  ) {
    return `⚠️ **衝堂警告！**

根據下學期課表，**「人工智慧導論（CS501）」**與**「機器學習實務（CS504）」**時段完全重疊：

- 兩門課都在 **週一 第 3-4 節**，由陳志遠老師授課
- 兩門課不可同時選修

**建議：**
- 大三下選「人工智慧導論」（AI 基礎，推薦優先修）
- 大四上再選「機器學習實務」（進階實作，有 AI 基礎後效果更好）

這樣安排不僅避免衝堂，學習循序漸進效果更佳 ✅`;
  }

  // 畢業預測
  if (lastUserMsg.includes('畢業') || lastUserMsg.includes('幾年')) {
    return `📊 **畢業年限預測**

根據你目前的學分狀況：
- 已修（歷史）：**${summary.historicalEarned} 學分**
- 本學期修習中：**${summary.currentSemester} 學分**
- 合計：**${summary.totalSoFar} / ${summary.totalRequired} 學分**
- 還差：**${summary.remaining} 學分**

**預測：按時在大四下（115-2）畢業** 🎓

如果下學期選 5-6 門課（約 15-18 學分），大四只需再修 16-19 學分，是完全可行的節奏。

**特別注意：**
- 資訊安全（CS503）是必修，不能忘記選
- 專題研究（一）建議大三下就開始，大四才有足夠時間完成專題`;
  }

  // 選課建議
  if (
    lastUserMsg.includes('選') ||
    lastUserMsg.includes('推薦') ||
    lastUserMsg.includes('下學期')
  ) {
    return `📚 **下學期選課建議**

根據你的學分缺口分析：

| 類別 | 需求 | 已修+修習中 | 還差 |
|------|------|------------|------|
| 必修 | ${summary.categoryRequired.required} | ${summary.byCategory.required + summary.currentSemester} | ${Math.max(0, summary.categoryRequired.required - summary.byCategory.required - 19)} |
| 選修 | ${summary.categoryRequired.elective} | ${summary.byCategory.elective} | ${Math.max(0, summary.categoryRequired.elective - summary.byCategory.elective)} |
| 通識 | ${summary.categoryRequired.general} | ${summary.byCategory.general + 2} | ${Math.max(0, summary.categoryRequired.general - summary.byCategory.general - 2)} |

**AI 推薦下學期選課組合（共 13 學分）：**

⭐ **資訊安全（CS503）** — 3 學分，必修，週三第 5-6 節
  → 你的必修還有缺口，這門是核心課，早修早好

⭐ **人工智慧導論（CS501）** — 3 學分，選修，週一第 3-4 節
  → 你的程式設計底子不錯（大一下 93 分），適合進入 AI 領域

⭐ **雲端運算與服務（CS502）** — 3 學分，選修，週二第 1-2 節
  → 補足選修學分，業界熱門技術

⭐ **科技與社會（GE101）** — 2 學分，通識，週四第 1-2 節
  → 你的通識還差 4 學分，這門輕鬆好修

⭐ **專題研究（一）（CS505）** — 2 學分，必修，週五第 1-2 節
  → 大三下必修，要提前規劃！

**⚠️ 不建議同時選「機器學習實務（CS504）」**，因為與「人工智慧導論」時段衝突。`;
  }

  // 通識學分
  if (lastUserMsg.includes('通識')) {
    const generalDone = summary.byCategory.general;
    const generalNeed = summary.categoryRequired.general;
    const generalCurrent = 2; // ENG201
    const generalLeft = Math.max(0, generalNeed - generalDone - generalCurrent);
    return `📘 **通識學分分析**

你的通識學分狀況：
- 需求：${generalNeed} 學分
- 已修（歷史）：${generalDone} 學分（大學國文、英文一二、哲學與生命、社會學概論、藝術鑑賞）
- 本學期修習中：${generalCurrent} 學分（英文寫作）
- **還差：${generalLeft} 學分**

下學期推薦通識課：
1. **科技與社會（GE101）** — 2 學分，週四第 1-2 節，輕鬆有趣，補齊 2 學分
2. **環境永續與創新（GE102）** — 2 學分，週四第 5-6 節，符合 SDGs 趨勢

選上這兩門，通識學分就完全達標 ✅`;
  }

  // 成績弱項
  if (
    lastUserMsg.includes('弱') ||
    lastUserMsg.includes('成績') ||
    lastUserMsg.includes('補強')
  ) {
    return `💡 **成績分析與建議**

根據你的歷史成績，以下幾點值得注意：

📈 **表現優異的科目：**
- 程式設計（一）（二）：91, 93 分 → 程式設計底子很好
- 網頁程式設計：96 分 → 資訊應用類強項

⚠️ **相對偏弱的科目：**
- 微積分（一）（二）：83, 79 分 → 數學偏弱，特別是微積分二
- 計算機網路：84 分 → 尚可，但屬於資工必修核心

**選課策略建議：**
1. 由於數學底子較弱，若要修「機器學習實務」，建議先把「人工智慧導論」修完，建立直覺後再進階
2. 計算機網路還在修習中，可等確認成績後再決定要不要選進階的「資訊安全」
3. 你的程式設計能力強，「行動應用程式開發（CS506）」應該會是你的強項課

整體而言你的成績相當不錯，GPA 3.63，繼續保持！ 💪`;
  }

  // 預設回應
  return `你好！我是你的 AI 選課助理 🤖

我已掌握你的完整學籍資料：
- 已修 **${summary.historicalEarned} 學分**，本學期修習中 **${summary.currentSemester} 學分**
- 距離畢業還差 **${summary.remaining} 學分**
- 下學期有 ${NEXT_SEM_COURSES.length} 門可選課程可供規劃

你可以問我：
- 「下學期應該選哪些課？」
- 「我同時選 A 和 B 會衝堂嗎？」
- 「按我現在的速度，幾年可以畢業？」
- 「我通識學分還差多少？怎麼補？」
- 「幫我規劃大三下到大四的選課計畫」

有什麼想問的，直接說吧！`;
}

// ── 角色感知開場白 ───────────────────────────────────────────
function buildOpeningMessage(role: DemoRole): string {
  const summary = getCreditSummary();
  const pendingAnnouncements = DEMO_ANNOUNCEMENTS.filter(
    (a) => a.category === 'academic' && a.pinned,
  ).length;
  const joinedClubs = DEMO_CLUBS.filter((c) => c.isJoined);

  switch (role) {
    case 'student':
      return `王小明你好！我是你的 AI 選課助理 🤖

我已讀取你的完整學籍資料：
- 已修 **${summary.historicalEarned} 學分**，本學期修習中 **${summary.currentSemester} 學分**
- 距離畢業還差 **${summary.remaining} 學分**
- 下學期有 **${NEXT_SEM_COURSES.length} 門可選課程**（含 2 組衝堂警告）
- 已加入社團：${joinedClubs.map((c) => c.name).join('、') || '尚未加入'}

💡 下學期有 **人工智慧導論** 與 **機器學習實務** 時段衝突，需要幫你規劃嗎？

直接問我任何選課問題，或點下方快速問題！`;

    case 'teacher':
      return `王大明老師，你好！我是校園 AI 助手 🤖

你目前負責的課程：
- **資料結構（CS301）**：48 位學生，本週五期中考
- 課程動態：下週考試範圍已發布，作業二截止日即將到來

我可以協助你：查詢課程資料、分析學生出缺席、規劃教材進度。
有什麼我可以幫到你的嗎？`;

    case 'ta':
      return `林助教，你好！我是校園 AI 助手 🤖

你目前協助的課程：
- **資料結構（CS301）**：本週有 **1 份作業**尚未完成批改
- 本學期已批改紀錄：作業一（已完成）

我可以幫助你了解課程進度、學生成績分佈，或協助規劃批改時程。
請告訴我你需要什麼幫助！`;

    case 'department_head':
      return `黃主任，你好！我是行政 AI 助手 🤖

目前系所狀況摘要：
- 全系共 **312 位在學學生**，19 位教師
- **${pendingAnnouncements > 0 ? pendingAnnouncements : 3} 則公告待審核**（請至管理後台處理）
- 本學期開設課程：**${NEXT_SEM_COURSES.length + 8} 門**

我可以幫你查詢課程統計、學生選課分析、或協助規劃系所公告。
有什麼需要我分析的嗎？`;

    case 'admin':
      return `管理員，你好！我是系統 AI 助手 🤖

系統狀態摘要：
- 目前使用者：**139 位**（學生 120、教師 19）
- 本學期活躍課程：**8 門**，社團：**6 個**
- 近期公告：**${DEMO_ANNOUNCEMENTS.length} 則**已發布

我可以協助你查詢系統資料、使用者管理或公告審核作業。
請說明你需要什麼幫助！`;

    case 'club_officer':
      return `陳社長，你好！我是校園 AI 助手 🤖

程式設計社目前狀況：
- 成員：**120 位**，本週未讀訊息：5 則
- 下次活動：**黑客松 (5/23 週六)**，距今僅剩 7 天

我可以協助你規劃社團活動、發布公告或管理成員名單。
有什麼需要我幫你準備的嗎？`;

    case 'alumni':
      return `張學長，你好！歡迎回到校園 AI 系統 🤖

你是資管系 109 屆校友，現任軟體工程師。

我可以協助你瀏覽校園最新公告、活動資訊、地圖導覽等公開資訊。
有什麼想了解的校園近況嗎？`;

    default:
      return `你好！歡迎使用校園 AI 助理 🤖

我可以協助你了解校園資訊、課程、社團與活動。
請先登入以獲取個人化服務，或直接問我公開資訊！`;
  }
}

// ── 主頁面元件 ────────────────────────────────────────────────
export default function AIAssistantPage(props: {
  searchParams?: { school?: string; schoolId?: string; q?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();

  // 初始開場白（先用 student 預設，mount 後依角色更新）
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasSetOpening, setHasSetOpening] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoSentRef = useRef(false);

  // Mount 後根據角色設定開場白
  useEffect(() => {
    if (hasSetOpening) return;
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: buildOpeningMessage(demoRole),
        timestamp: new Date(),
      },
    ]);
    setHasSetOpening(true);
  }, [demoRole, hasSetOpening]);

  // 角色切換時重置對話
  useEffect(() => {
    setHasSetOpening(false);
    hasAutoSentRef.current = false;
  }, [demoRole]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 核心送出邏輯（用 ref 包裝避免循環依賴）
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const sendMessageFn = useCallback(async (text: string) => {
    const userText = text.trim();
    if (!userText || isLoading) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userText,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const systemCtx = buildAISystemContext();
    const apiMessages = [
      { role: 'system', content: systemCtx },
      ...messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ];

    try {
      const reply = await callAI(apiMessages);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', content: reply, timestamp: new Date() },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: '抱歉，AI 服務暫時無法回應，請稍後再試。',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isLoading]);

  // 自動送出 ?q= 參數（從其他頁面跳轉帶入的問題）
  const autoQ = props.searchParams?.q;
  useEffect(() => {
    if (!autoQ || hasAutoSentRef.current || !hasSetOpening) return;
    hasAutoSentRef.current = true;
    const timer = setTimeout(() => {
      void sendMessageFn(autoQ);
    }, 700);
    return () => clearTimeout(timer);
  }, [autoQ, hasSetOpening, sendMessageFn]);

  const sendMessage = useCallback(
    (text: string) => sendMessageFn(text),
    [sendMessageFn],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void sendMessageFn(input);
    },
    [input, sendMessageFn],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendMessageFn(input);
      }
    },
    [input, sendMessageFn],
  );

  // 若有 ?q 參數，頁面初始輸入框先預填（讓使用者看到問題）
  useEffect(() => {
    if (autoQ && !hasAutoSentRef.current) {
      setInput(autoQ);
    }
  }, [autoQ]);

  // 角色守衛
  const isRestrictedRole = demoRole === 'guest';

  const summary = getCreditSummary();

  return (
    <SiteShell
      title="AI 選課助理"
      subtitle="根據你的學分、成績、時間表，AI 幫你規劃最佳選課"
      schoolName={schoolName}
    >
      <div className="pageStack">
        {/* ── 訪客提示 ── */}
        {isRestrictedRole && (
          <div
            className="card"
            style={{
              padding: '14px 16px',
              background: 'rgba(0,122,255,0.08)',
              border: '1px solid #007AFF',
              fontSize: 13,
            }}
          >
            👀 <strong>訪客身份</strong> · 以示範學生資料為你展示 AI 助理功能。
            <Link href={`/login${q}`} style={{ marginLeft: 8, color: 'var(--brand)' }}>
              登入查看個人化建議 →
            </Link>
          </div>
        )}

        {/* ── 學分快照卡 ── */}
        <div
          className="card"
          style={{ padding: '12px 16px', display: 'flex', gap: 16, flexWrap: 'wrap' }}
        >
          {[
            {
              label: '已修學分',
              val: summary.historicalEarned,
              total: summary.totalRequired,
              color: '#5E6AD2',
            },
            {
              label: '修習中',
              val: summary.currentSemester,
              total: summary.totalRequired,
              color: '#34C759',
            },
            {
              label: '還差',
              val: summary.remaining,
              total: summary.totalRequired,
              color: '#FF9500',
            },
            {
              label: '畢業需求',
              val: summary.totalRequired,
              total: summary.totalRequired,
              color: '#8E8E93',
            },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                flex: '1 1 80px',
                textAlign: 'center',
                padding: '8px 4px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--panel2)',
              }}
            >
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  color: s.color,
                  letterSpacing: '-0.04em',
                }}
              >
                {s.val}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── 快速問題 ── */}
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            快速問題
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.label}
                onClick={() => void sendMessage(qp.prompt)}
                disabled={isLoading}
                style={{
                  padding: '7px 13px',
                  borderRadius: 99,
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                  fontSize: 13,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  opacity: isLoading ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{qp.icon}</span>
                <span>{qp.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 對話區 ── */}
        <div
          className="card"
          style={{
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 480,
          }}
        >
          {/* 訊息列表 */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              maxHeight: 520,
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background:
                      msg.role === 'assistant'
                        ? 'linear-gradient(135deg, var(--brand) 0%, #8EA5FF 100%)'
                        : 'var(--panel2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    flexShrink: 0,
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  {msg.role === 'assistant' ? '🤖' : '👤'}
                </div>

                {/* Bubble */}
                <div
                  style={{
                    maxWidth: '78%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                    background:
                      msg.role === 'user'
                        ? 'var(--brand)'
                        : 'var(--panel)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text)',
                    fontSize: 14,
                    lineHeight: 1.6,
                    boxShadow: 'var(--shadow-sm)',
                    border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.content}
                  <div
                    style={{
                      fontSize: 10,
                      opacity: 0.5,
                      marginTop: 6,
                      textAlign: msg.role === 'user' ? 'right' : 'left',
                    }}
                  >
                    {msg.timestamp.toLocaleTimeString('zh-TW', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            ))}

            {/* Loading */}
            {isLoading && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background:
                      'linear-gradient(135deg, var(--brand) 0%, #8EA5FF 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  🤖
                </div>
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '4px 16px 16px 16px',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    gap: 4,
                    alignItems: 'center',
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: 'var(--brand)',
                        animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                        opacity: 0.6,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 輸入框 */}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              padding: '12px 16px',
              background: 'var(--panel)',
            }}
          >
            <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="問我任何選課問題，例如：下學期應該選哪些課？"
                disabled={isLoading}
                rows={2}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 14,
                  resize: 'none',
                  lineHeight: 1.5,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 'var(--radius-sm)',
                  background:
                    isLoading || !input.trim() ? 'var(--panel2)' : 'var(--brand)',
                  color: isLoading || !input.trim() ? 'var(--muted)' : '#fff',
                  border: 'none',
                  fontSize: 20,
                  cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                  height: 48,
                  width: 48,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {isLoading ? '⏳' : '↑'}
              </button>
            </form>
            <div
              style={{
                fontSize: 11,
                color: 'var(--muted)',
                marginTop: 6,
                textAlign: 'center',
              }}
            >
              Enter 送出 · Shift+Enter 換行 · AI 已掌握你的完整學籍資料
            </div>
          </div>
        </div>

        {/* ── 下學期課程快覽 ── */}
        <div className="card" style={{ padding: '14px 16px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>下學期可選課程快覽</h3>
            <Link
              href={`/credit-planner${q}`}
              style={{ fontSize: 12, color: 'var(--brand)' }}
            >
              學分試算 →
            </Link>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {NEXT_SEM_COURSES.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--panel2)',
                  border: `1px solid ${c.conflictsWith ? 'rgba(255,59,48,0.4)' : 'var(--border)'}`,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: CATEGORY_COLORS[c.category],
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ color: 'var(--muted)' }}>{c.credits}學分</span>
                {c.conflictsWith && <span style={{ color: 'var(--danger)' }}>⚠️</span>}
                {c.recommended && <span style={{ color: 'var(--brand)' }}>⭐</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </SiteShell>
  );
}
