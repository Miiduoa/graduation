'use client';

import { SiteShell } from '@/components/SiteShell';
import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getDemoRoleDefinition, type DemoRole } from '@/lib/demoRole';
import { buildAISystemContext, getCreditSummary } from '@/lib/aiContext';
import {
  NEXT_SEM_COURSES,
  type CreditCategory,
  DEMO_ANNOUNCEMENTS,
  DEMO_CLUBS,
  DEMO_LIBRARY_DUE_SOON_BOOK,
  DEMO_LIBRARY_DUE_SOON_DAYS,
  DEMO_LIBRARY_DUE_SOON_BOOK_ID,
  TEACHER_PENDING_REVIEWS,
  STUDENT_ASSIGNMENTS,
  UPCOMING_EXAMS,
  CLUB_ACTIVITIES,
  readPendingAnns,
} from '@/lib/demoData';
import {
  getDemoStore,
  useDemoStore,
  getAllMessagesForRole,
  getUnreadCountDynamic,
  getPendingClubMembers,
  getPendingSubmissions,
  // 一鍵動作 — AI 主軸
  renewBook,
  requestHelp,
  requestLeave,
  placeOrder,
  submitFeedback,
  bulkRemind,
  replyHelpRequest,
  approveClubMember,
  publishGrades,
  sendDeptBroadcast,
  notifyStudentsAnnApproved,
  notifySubmitterAnnApproved,
  setUserDisabled,
  getOpenHelpRequests,
  postDiscussion,
} from '@/lib/demoStore';
import { approvePendingAnn, addPendingAnn } from '@/lib/demoData';
import { useToast, Modal } from '@/components/ui';
import { notifyDeptHeadNewAnn, assignPeerReview, rsvpAlumniEvent } from '@/lib/demoStore';
import { callCampusAssistant, type AgentCard } from '@/lib/campusAssistantClient';
import { AgentCardList } from './AgentCards';

// ── 型別 ──────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  cards?: AgentCard[];
  suggestions?: string[];
}

type QuickPrompt = {
  label: string;
  icon: string;
  prompt: string;
};

// ── 角色感知快速提示詞 ────────────────────────────────────────
const ROLE_QUICK_PROMPTS: Record<DemoRole, QuickPrompt[]> = {
  student: [
    { label: '幫我規劃下學期選課', icon: '📚', prompt: '我下學期應該選哪幾門課？請根據我的學分缺口和成績幫我推薦最佳組合。' },
    { label: '分析我的成績趨勢', icon: '📊', prompt: '根據我的歷史成績，分析我的學習趨勢，哪些科目是強項、哪些需要補強？' },
    { label: '哪些學分還差？', icon: '🎓', prompt: '我目前各類別學分還差多少？按時畢業的話大三下和大四各應選幾學分？' },
    { label: '整理今日重要事項', icon: '📋', prompt: '整理一下我今天有什麼重要事項，包括作業截止、考試提醒、社團活動。' },
    { label: '圖書館推薦', icon: '📖', prompt: '我在學資工，圖書館有哪些推薦書單？另外請提醒我借閱到期情況。' },
    { label: '衝堂檢查', icon: '⚠️', prompt: '如果我下學期同時選「人工智慧導論」和「機器學習實務」，會有衝堂問題嗎？' },
  ],
  teacher: [
    { label: '哪些學生需要關注？', icon: '🔍', prompt: '幫我分析資料結構班上成績偏低或出缺席異常的學生，列出需要關注的名單。' },
    { label: '幫我出 5 題期末考題', icon: '📝', prompt: '幫我出資料結構期末考的 5 道題目，涵蓋樹、圖、排序演算法，難度中等偏難。' },
    { label: '分析本學期出缺席趨勢', icon: '📅', prompt: '分析資料結構（CS301）本學期的出缺席趨勢，有沒有特別異常的情況？' },
    { label: '批改回饋範本', icon: '✍️', prompt: '幫我寫一份資料結構作業二的批改回饋範本，分別針對優秀、普通、待改進的學生。' },
    { label: '生成本學期課程總結報告', icon: '📋', prompt: '幫我生成資料結構（CS301）本學期的課程總結報告，包含教學進度、班級表現摘要及下學期改進建議。' },
  ],
  ta: [
    { label: '這份作業怎麼評分？', icon: '📋', prompt: '請問作業二（鏈結串列實作）的評分標準是什麼？特別是遞迴實作和迭代實作的差異要如何給分？' },
    { label: '整理學生常見錯誤', icon: '🔍', prompt: '幫我整理資料結構作業二學生常見的錯誤，以及如何在評語中給予有效建議。' },
    { label: '如何給有效回饋？', icon: '💡', prompt: '如何給學生有效且有建設性的批改回饋？請給我一些原則和範例。' },
    { label: '本週批改進度整理', icon: '📊', prompt: '我擔任資料結構助教，幫我整理本週待批改的作業清單與優先順序，讓我有效率地完成批改。' },
    { label: '幫我起草學生答覆', icon: '✉️', prompt: '有學生來信詢問作業二評分為何扣分，幫我起草一份有條理的回覆，說明扣分原因並給予鼓勵。' },
  ],
  club_officer: [
    { label: '幫我寫招募文案', icon: '✍️', prompt: '幫我寫程式設計社的新學年招募文案，目標是吸引大一和大二想學程式的學生加入。' },
    { label: '幫我規劃黑客松流程', icon: '🏆', prompt: '幫我規劃 5/23 黑客松的詳細流程表，從早上 9 點到隔天 9 點，包含各個時段的活動安排。' },
    { label: '分析社團活躍度', icon: '📊', prompt: '根據程式設計社的成員和活動情況，分析社團活躍度，並建議如何提升參與率。' },
    { label: '幫我寫社團活動公告', icon: '📢', prompt: '幫我起草下週程式設計社例會的公告，包含活動時間、地點、議程，語氣活潑友善。' },
    { label: '評估新成員申請', icon: '👥', prompt: '我有幾位新成員申請加入程式設計社，幫我設計一套評估標準，確保招募到真正有熱情的成員。' },
  ],
  department_head: [
    { label: '本學期各課程平均分數？', icon: '📊', prompt: '請幫我整理本學期各課程的平均分數分布，哪些課程分數偏低需要關注？' },
    { label: '哪些課程選課人數最多？', icon: '📈', prompt: '本學期選課人數最多的前 5 門課程是什麼？有沒有熱門課程超額的情況？' },
    { label: '幫我寫系所公告草稿', icon: '📄', prompt: '幫我起草一份關於本學期期末考試安排的系所公告，語氣正式、格式完整。' },
    { label: '生成系所教學品質週報', icon: '📋', prompt: '幫我生成本學期資管系教學品質摘要週報，包含開課數、平均成績分布、待審公告數量，格式簡明扼要。' },
    { label: '分析待審公告與師資分配', icon: '🏛️', prompt: '本學期有哪些待審公告？師資分配是否均衡？請分析並提出改善建議。' },
  ],
  admin: [
    { label: '過去 7 天有異常登入嗎？', icon: '🛡️', prompt: '請幫我查看過去 7 天的系統安全事件，有沒有異常登入或可疑活動需要關注？' },
    { label: '系統使用狀況摘要', icon: '📊', prompt: '幫我生成本週系統使用狀況摘要，包含活躍使用者數、API 用量、備份狀態等。' },
    { label: '起草系統維護公告', icon: '📝', prompt: '幫我起草一份系統維護公告，說明本週日凌晨 2-4 點進行例行維護，服務可能中斷。' },
    { label: '分析帳號與權限異常', icon: '🔐', prompt: '幫我分析目前所有帳號的角色權限設定，有沒有異常的高權限帳號或長期未登入的帳號需要停用？' },
    { label: '生成月度系統健康報告', icon: '📈', prompt: '幫我生成本月系統健康報告，包含上線率、錯誤次數、API 延遲、備份狀態及資安風險評估。' },
  ],
  alumni: [
    { label: '整理我在校的成績摘要', icon: '🎓', prompt: '請幫我整理在校期間的成績摘要，包含 GPA 趨勢、強弱科目分析。' },
    { label: '校友會有什麼活動？', icon: '🎉', prompt: '請告訴我最近有哪些校友相關的活動，以及如何報名參與。' },
    { label: '如何申請成績單？', icon: '📄', prompt: '我需要申請在校成績單，請問流程是什麼？需要準備哪些文件？' },
    { label: '在校經歷如何寫進履歷？', icon: '💼', prompt: '幫我將在校期間的學業成就、社團活動和專題經歷，整理成適合求職的履歷重點描述。' },
    { label: '母校最新動態', icon: '🏫', prompt: '請告訴我母校（靜宜大學資管系）最近有什麼值得關注的學術活動、課程更新或產學合作資訊。' },
  ],
  guest: [
    { label: '這個 App 有什麼功能？', icon: '🏫', prompt: '這個校園 App 有哪些主要功能？不同身份的使用者各能使用什麼服務？' },
    { label: '如何申請帳號？', icon: '📝', prompt: '如何申請這個校園 App 的帳號？需要哪些資格或文件？' },
    { label: '靜宜大學在哪？怎麼去？', icon: '📍', prompt: '靜宜大學在哪裡？最近的公車站怎麼到？大眾運輸有什麼選擇？' },
    { label: '校園地圖在哪可以看？', icon: '🗺️', prompt: '我想看校園地圖、瀏覽教學大樓、餐廳、停車場的位置，App 哪裡可以看？' },
    { label: '我可以先看哪些公開資訊？', icon: '📢', prompt: '我還沒登入，請告訴我訪客身份可以瀏覽哪些公開資訊（公告、餐廳、公車、地圖）。' },
  ],
};

// ── 顏色 ──────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<CreditCategory, string> = {
  required: '#5856D6',
  elective: '#34C759',
  general: '#FF9500',
  pe: '#FF3B30',
  other: '#8E8E93',
};

// ── AI 回應結果型別 ──────────────────────────────
type AIReply = { content: string; cards?: AgentCard[]; suggestions?: string[] };

// ── AI 回應（真實後端 askCampusAssistant + fallback demo） ──────────
async function callAI(messages: { role: string; content: string }[], role?: DemoRole): Promise<AIReply> {
  // 真實 AI：呼叫部署的 Cloud Function `askCampusAssistant`（含 4 個地圖/餐廳工具 + cards）
  try {
    const envelope = await callCampusAssistant({
      messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      schoolId: 'pu',
      screen: 'web/ai-assistant',
    });
    if (envelope && envelope.content) {
      return {
        content: envelope.content,
        cards: envelope.cards || [],
        suggestions: envelope.suggestions || [],
      };
    }
  } catch {
    // fallback to demo reply
  }

  // Demo 回應（Firebase 未設定或 callable 失敗時的 fallback）
  return { content: buildDemoReply(messages, role) };
}

function buildDemoReply(messages: { role: string; content: string }[], role?: DemoRole): string {
  const summary = getCreditSummary();
  const lastUserMsg = messages[messages.length - 1]?.content ?? '';

  // ── 教師 / TA 角色的 demo 回應 ──
  if (role === 'teacher' || role === 'ta') {
    if (lastUserMsg.includes('學生') || lastUserMsg.includes('關注') || lastUserMsg.includes('成績')) {
      return `🔍 **班級成績分析（資料結構 CS301）**

根據目前成績數據，以下學生需要特別關注：

⚠️ **需要關注的學生（分數 < 70）：**
- 張志偉（M11302005）：作業 60、期中 55、期末 58 → 建議約談輔導
- 許志明（M11302009）：作業 66、期中 70、期末 65 → 邊緣通過，需加油

📈 **表現優異：**
- 王小明（M11302001）：作業 95、期中 96、期末 97 → 班級第一
- 蔡雅芳（M11302008）：作業 93、期中 90、期末 94

**建議行動：**
1. 針對低分學生發送關懷訊息，了解學習困難
2. 提供課後輔導時間（工程館 308，週二 14-17:00）
3. 考慮在下次上課時加強講解常見錯誤`;
    }
    if (lastUserMsg.includes('考題') || lastUserMsg.includes('出題')) {
      return `📝 **資料結構期末考題（5 道，中等偏難）**

**第 1 題（20 分）** — 二元搜尋樹
設計一個 BST，插入以下序列：{50, 30, 70, 20, 40, 60, 80}。
(a) 繪出樹的結構（10 分）
(b) 以中序走訪輸出節點，並說明結果特性（10 分）

**第 2 題（20 分）** — 遞迴 vs 迭代
比較遞迴與迭代實作 Fibonacci 數列的時間複雜度，並分析記憶體使用差異。

**第 3 題（25 分）** — 圖論演算法
給定加權無向圖（附圖），使用 Dijkstra 演算法求從頂點 A 到所有其他頂點的最短路徑。請列出每一步驟。

**第 4 題（20 分）** — 排序演算法
比較 Quick Sort 和 Merge Sort 在（a）最佳、（b）最差、（c）平均情況下的時間複雜度，並說明各自適用的場景。

**第 5 題（15 分）** — 設計題
設計一個「最近最少使用（LRU）快取」，說明使用哪種資料結構組合最有效率，並說明 get 和 put 操作的時間複雜度。`;
    }
    return `你好！我是你的課程 AI 助手 🤖

我可以協助你：
- **分析班級成績**：找出需要關注的學生
- **出考題**：根據課程範圍生成考題
- **批改回饋**：提供評語範本
- **統計出缺席**：分析本學期出席趨勢

有什麼需要幫忙的嗎？`;
  }

  // ── 社團幹部角色的 demo 回應 ──
  if (role === 'club_officer') {
    if (lastUserMsg.includes('招募') || lastUserMsg.includes('文案')) {
      return `✍️ **程式設計社招募文案**

---
🚀 **2026 新學年 × 程式設計社 × 一起 Build 點什麼**

你有想法，但不知道怎麼動手？
你會寫 code，但想找同伴一起玩？
你聽過黑客松，但還沒跳進去過？

**這裡就是你的地方。**

📍 程式設計社，120 位夥伴，從零到一都歡迎。

我們有：
• 每週技術分享（React、Python、AI 什麼都談）
• 每學年黑客松（今年獎金 NT$30,000）
• Side project 工作坊（有人帶，不孤單）
• 業界人士訪談（真實職涯不包裝）

**報名截止：9/15，名額有限，先搶先贏。**
加入表單：[連結]

來一起 Build 點什麼吧 💻

---

需要我調整語氣或加入特定活動資訊嗎？`;
    }
    if (lastUserMsg.includes('活躍') || lastUserMsg.includes('分析')) {
      return `📊 **程式設計社活躍度分析**

**成員概況**
- 總成員：120 位
- 估計活躍成員（每月參與活動）：約 45 位（37.5%）
- 新成員申請：本月 3 位（李宇欣、張博文、陳怡萱）

**活動參與率趨勢**
- 黑客松（去年）：18 組 × 4 人 = 72 人參與 ✅ 高
- 技術分享（平均）：30-40 人 / 次 📊 中等
- 社課（每週）：15-25 人 / 次 📉 偏低

**提升參與率建議：**
1. 社課加入實作環節，從「聽講」改為「邊做邊學」
2. 建立「入社後 30 天任務清單」，幫新生快速融入
3. 舉辦小型組隊競賽，降低參與門檻
4. 整合 LINE 群組通知，確保活動資訊觸達每位成員`;
    }
    return `你好！我是程式設計社 AI 助手 🤖

我可以協助你：
- **起草招募文案、活動文宣**
- **規劃活動流程（黑客松、工作坊）**
- **分析社團活躍度**
- **起草公告審核申請**

有什麼需要我幫你準備的嗎？`;
  }

  // ── 系主任角色的 demo 回應 ──
  if (role === 'department_head') {
    if (lastUserMsg.includes('課程') || lastUserMsg.includes('選課') || lastUserMsg.includes('趨勢')) {
      return `📈 **本學期課程選課趨勢分析**

**選課人數 Top 5：**
| 課程 | 代碼 | 選課人數 | 狀態 |
|------|------|---------|------|
| 微積分 | MATH101 | 120 人 | 接近滿額 |
| 線性代數 | MATH201 | 102 人 | 正常 |
| 作業系統 | CS302 | 76 人 | 正常 |
| 計算機網路 | CS401 | 68 人 | 正常 |
| 資料庫系統 | CS303 | 54 人 | 正常 |

**分析摘要：**
- 數學類課程需求高，微積分接近滿額，建議下學期增開一班
- 資料結構（CS301）48 人，班級規模適中
- 英文寫作（ENG201）僅 32 人，可考慮是否調整必選修規定

**班級平均分數警示：**
- 資料結構班級平均約 82 分，正常範圍
- 建議定期追蹤各課程期中考後的成績分布`;
    }
    if (lastUserMsg.includes('公告') || lastUserMsg.includes('草稿')) {
      return `📄 **系所公告草稿**

---
【資訊管理系公告】2026 學年度第一學期期末考試安排

各位師生同學，您好：

本學期期末考試定於 **2026 年 6 月 15 日至 6 月 21 日** 舉行，相關事項說明如下：

1. **考試時間**：依各科目課表公告時間進行
2. **應考規定**：請攜帶學生證，禁止攜帶電子裝置入場
3. **衝突處理**：如有考試時間衝突，請於 6 月 1 日前向各授課老師申請調整
4. **補考申請**：病假缺考學生請於考試後 3 個工作日內提出補考申請

如有任何問題，請洽系辦（行政大樓 5 樓，分機 5201）。

資訊管理系系主任 黃○○ 敬上
2026 年 5 月 17 日

---

需要我調整內容或格式嗎？`;
    }
    return `你好！我是系所行政 AI 助手 🤖

我可以協助你：
- **分析課程選課趨勢與成績統計**
- **起草系所公告草稿**
- **師資分配建議**
- **生成系所統計報表摘要**

有什麼需要分析或撰寫的嗎？`;
  }

  // ── 管理員角色的 demo 回應 ──
  if (role === 'admin') {
    if (lastUserMsg.includes('異常') || lastUserMsg.includes('登入') || lastUserMsg.includes('安全')) {
      return `🛡️ **過去 7 天安全事件摘要（2026-05-11 ～ 2026-05-17）**

**⚠️ 高優先事件（1 件）：**
- **2026-05-17 09:23** — 5 次登入失敗（來自 185.220.101.xx，荷蘭 Tor 出口節點）
  - 目標帳號：admin@pu.edu.tw
  - 建議：立即確認密碼安全，考慮加入 IP 封鎖清單，並啟用雙因子驗證

**一般事件（3 件）：**
- 2026-05-14：使用者密碼重設 × 2（一般帳號）
- 2026-05-15：異地登入偵測 × 1（台北 IP，已確認為師生出差）

**整體評估：** 風險等級 🟡 中等
→ 主要威脅來自 Tor 節點嘗試，建議今日處理 admin 帳號的 2FA 設定。`;
    }
    return `你好！我是系統管理 AI 助手 🤖

我可以協助你：
- **安全事件分析**：查詢異常登入、威脅評估
- **系統狀況摘要**：API 用量、備份狀態
- **起草系統維護公告**
- **使用者帳號查詢**

有什麼系統問題需要分析嗎？`;
  }

  // ── 校友角色的 demo 回應 ──
  if (role === 'alumni') {
    if (lastUserMsg.includes('成績') || lastUserMsg.includes('摘要')) {
      return `🎓 **在校成績摘要（資管系 109 屆，學號 B09203001）**

**畢業 GPA：3.65**（優良，全系前 20%）

**學期 GPA 趨勢：**
大一上 3.42 → 大一下 3.58 → 大二上 3.71 → 大二下 3.82 → ...（逐學期進步 ✅）

**成績亮點：**
- 程式設計相關科目全部 A 以上
- 網頁程式設計：96 分（系所名列前茅）
- 大四畢業專題：A+

**各類學分完成：**
- 必修 64 / 64 ✅
- 選修 32 / 32 ✅
- 通識 20 / 20 ✅
- 總計 128 / 128 學分，符合畢業標準

如需申請正式成績單，請至學校網站「學生服務」→「成績單申請」，或親至教務處辦理。`;
    }
    return `你好，張學長！歡迎回到校友服務系統 🤖

我可以協助你：
- **整理在校成績摘要**（畢業 GPA 3.65，資管系 109 屆）
- **說明校友活動與系友會資訊**
- **解說成績單申請流程**
- **了解母校近況**

有什麼想詢問的嗎？`;
  }

  // ── 訪客角色的 demo 回應 ──
  if (role === 'guest') {
    return `你好！歡迎使用校園 AI 助理 👋

這個校園 App 整合了以下功能：
- 🗓️ **課表**：查看個人課程時間表
- 📚 **課程**：教材、作業、測驗、成績
- 📊 **成績**：GPA 追蹤與學分進度
- 📣 **公告**：課程與校園最新公告
- 🎯 **社團**：探索並加入校園社團
- 📖 **圖書館**：館藏搜尋與借閱管理
- 🤖 **AI 助理**：選課規劃、學習建議

**如何使用：**
[前往登入](/login) 選擇身份後即可使用完整功能。
我們提供 8 種身份（學生、教師、TA、社團幹部、系主任、管理員、校友、訪客）的完整 demo。

有什麼想了解的嗎？`;
  }

  // ── 學生角色（預設）的 demo 回應 ──

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
| 必修 | ${summary.categoryRequired.required} | ${summary.byCategory.required + 19} | ${Math.max(0, summary.categoryRequired.required - summary.byCategory.required - 19)} |
| 選修 | ${summary.categoryRequired.elective} | ${summary.byCategory.elective} | ${Math.max(0, summary.categoryRequired.elective - summary.byCategory.elective)} |
| 通識 | ${summary.categoryRequired.general} | ${summary.byCategory.general + 2} | ${Math.max(0, summary.categoryRequired.general - summary.byCategory.general - 2)} |

**AI 推薦下學期選課組合（共 13 學分）：**

⭐ **資訊安全（CS503）** — 3 學分，必修，週三第 5-6 節
⭐ **人工智慧導論（CS501）** — 3 學分，選修，週一第 3-4 節
⭐ **雲端運算與服務（CS502）** — 3 學分，選修，週二第 1-2 節
⭐ **科技與社會（GE101）** — 2 學分，通識，週四第 1-2 節
⭐ **專題研究（一）（CS505）** — 2 學分，必修，週五第 1-2 節

**⚠️ 不建議同時選「機器學習實務（CS504）」**，因為與「人工智慧導論」時段衝突。`;
  }

  // 通識學分
  if (lastUserMsg.includes('通識')) {
    const generalDone = summary.byCategory.general;
    const generalNeed = summary.categoryRequired.general;
    const generalCurrent = 2;
    const generalLeft = Math.max(0, generalNeed - generalDone - generalCurrent);
    return `📘 **通識學分分析**

需求：${generalNeed} 學分
已修：${generalDone} 學分 ｜ 修習中：${generalCurrent} 學分
**還差：${generalLeft} 學分**

下學期推薦通識課：
1. **科技與社會（GE101）** — 2 學分，週四第 1-2 節
2. **環境永續與創新（GE102）** — 2 學分，週四第 5-6 節

選這兩門通識學分就達標 ✅`;
  }

  // 成績弱項
  if (lastUserMsg.includes('弱') || lastUserMsg.includes('成績') || lastUserMsg.includes('補強')) {
    return `💡 **成績分析與建議**

📈 **表現優異：** 程式設計（91, 93 分）、網頁程式設計（96 分）
⚠️ **相對偏弱：** 微積分（83, 79 分）、計算機網路（84 分）

**選課策略：**
1. 數學底子較弱 → 修「機器學習實務」前先修完「人工智慧導論」
2. 程式能力強 → 「行動應用程式開發」適合你

整體 GPA 3.63，繼續保持！ 💪`;
  }

  // 作業 / 截止日
  if (lastUserMsg.includes('作業') || lastUserMsg.includes('截止') || lastUserMsg.includes('今天')) {
    return `📋 **今日重要待辦清單**

⚠️ **作業截止（4 件）：**
- 【作業系統】Lab 5 實作 → 截止 **2026-05-18**（明天！）
- 【資料結構】期末專題提案 → 截止 **2026-05-20**
- 【軟體工程】Sprint 3 Review 報告 → 截止 **2026-05-26**
- 【計算機網路】期末專題分組報告 → 截止 **2026-05-30**

📅 **近期考試：**
- 線性代數 第二次小考 → **2026-05-22 13:10**，理學院 201

📚 **圖書館：** 《${DEMO_LIBRARY_DUE_SOON_BOOK}》還有 **${DEMO_LIBRARY_DUE_SOON_DAYS} 天**到期，記得續借！

建議優先完成 Lab 5（明天截止），加油！`;
  }

  // 預設回應
  return `你好！我是你的 AI 校園助理 🤖

我已掌握你的完整學籍資料：
- 已修 **${summary.historicalEarned} 學分**，本學期修習中 **${summary.currentSemester} 學分**
- 距離畢業還差 **${summary.remaining} 學分**
- 下學期有 ${NEXT_SEM_COURSES.length} 門可選課程

你可以問我：「下學期應該選哪些課？」「幾年可以畢業？」「今天有什麼要做的？」

有什麼想問的，直接說吧！`;
}

// ── 角色感知開場白 ───────────────────────────────────────────
function buildOpeningMessage(role: DemoRole): string {
  const summary = getCreditSummary();
  const store = getDemoStore();   // 讀最新 demoStore（包含跨角色動作觸發的狀態）
  const pendingAnnouncements = readPendingAnns().length;
  const joinedClubs = DEMO_CLUBS.filter((c) => c.isJoined);

  // 學生相關：計算待繳作業
  const pendingAssignments = STUDENT_ASSIGNMENTS.filter((a) => a.status === 'pending')
    .sort((a, b) => a.due.localeCompare(b.due));
  const soonestAssignment = pendingAssignments[0];
  const nextExam = UPCOMING_EXAMS.sort((a, b) => a.date.localeCompare(b.date))[0];

  // 圖書館：動態讀 demoStore，支援續借後更新到期日
  const libOverride = store.borrowingOverrides[DEMO_LIBRARY_DUE_SOON_BOOK_ID];
  const libDaysLeft = libOverride
    ? Math.ceil((new Date(libOverride.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : DEMO_LIBRARY_DUE_SOON_DAYS;
  const libRenewed = !!libOverride;

  // 教師相關：靜態 + 動態繳交數合計
  const teacherPendingCount = TEACHER_PENDING_REVIEWS.filter((r) => r.status === 'submitted').length;
  const teacherGradingCount = TEACHER_PENDING_REVIEWS.filter((r) => r.status === 'grading').length;
  const dynSubmissions = getPendingSubmissions('c1', store);
  const totalPendingReviews = teacherPendingCount + dynSubmissions.length;

  // 社團近期活動
  const clubActivities = CLUB_ACTIVITIES.filter((a) =>
    joinedClubs.some((c) => c.id === a.clubId)
  ).sort((a, b) => a.date.localeCompare(b.date));

  // 社團幹部：動態待審申請數
  const pendingClubMembers = getPendingClubMembers('club-1', store);

  // 學生訊息相關（靜態 + 動態合併）
  const studentMsgs = getAllMessagesForRole('student', store);
  const studentUnread = getUnreadCountDynamic('student', store);
  const urgentMsg = studentMsgs.find(
    (m) => !m.isRead && !store.readMessageIds.includes(m.id) && (m.type === 'warning' || m.type === 'action'),
  );

  switch (role) {
    case 'student':
      return `王小明你好！我是你的 AI 校園助理 🤖

📬 **訊息提醒**：你有 **${studentUnread} 則未讀訊息**${urgentMsg ? `，其中 1 則重要：「${urgentMsg.subject.slice(0, 25)}${urgentMsg.subject.length > 25 ? '…' : ''}」` : ''}
[前往訊息收件匣 →](/messages)

📊 **學分進度**
- 已修 **${summary.historicalEarned} 學分**，本學期修習中 **${summary.currentSemester} 學分**（合計 ${summary.totalSoFar} / ${summary.totalRequired} 學分）
- 距離畢業還差 **${summary.remaining} 學分**

⚠️ **今日待辦（${pendingAssignments.length} 件作業 + ${UPCOMING_EXAMS.length} 個考試）**
${soonestAssignment ? `- 最緊急：【${soonestAssignment.courseName}】${soonestAssignment.title}，截止 **${soonestAssignment.due}**` : '- 目前無待繳作業'}
${nextExam ? `- 最近考試：【${nextExam.courseName}】${nextExam.title}，${nextExam.date} ${nextExam.time} 於 ${nextExam.location}` : ''}

📚 **圖書館提醒**：《${DEMO_LIBRARY_DUE_SOON_BOOK}》還有 **${libDaysLeft} 天**到期${libRenewed ? '（已續借 ✅）' : '！[前往續借](/library)'}


🎯 **社團活動**：${clubActivities.length > 0 ? `【${clubActivities[0].clubName}】${clubActivities[0].title}，${clubActivities[0].date}` : '暫無即將到來的活動'}

💡 **選課提醒**：下學期「人工智慧導論」與「機器學習實務」時段衝突，需要我幫你規劃嗎？

直接問我任何問題，或點下方快速問題！`;

    case 'teacher':
      return `王大明老師，你好！我是校園 AI 助手 🤖

📊 **資料結構（CS301）課程摘要**
- 修課學生：**48 位**，教室：工程館 302
- **待批改作業：${totalPendingReviews} 份**（其中 ${teacherPendingCount} 份未批、${teacherGradingCount} 份批改中${dynSubmissions.length > 0 ? `、🆕 ${dynSubmissions.length} 份剛繳交` : ''}）
- 待批改學生：${TEACHER_PENDING_REVIEWS.slice(0, 3).map((r) => r.studentName).join('、')}${dynSubmissions.length > 0 ? `、${dynSubmissions.map(s => s.studentName).join('、')}` : ''}

📅 **近期排程**
- 作業二（實作專題）提交截止：**2026-05-16**
- 期末考試：**2026-06-15**，工學院 301

我可以協助你：分析班級成績分布、查詢學生出缺席、規劃教材進度。
有什麼需要我幫到你的嗎？`;

    case 'ta':
      return `林助教，你好！我是校園 AI 助手 🤖

📊 **資料結構（CS301）助教工作摘要**
- 協助課程：**資料結構（CS301）**，授課教師：王大明
- **待批改作業：${TEACHER_PENDING_REVIEWS.filter(r => r.status === 'submitted').length} 份**（${TEACHER_PENDING_REVIEWS.filter(r => r.status === 'submitted').map(r => r.studentName).slice(0, 3).join('、')} 等同學）
- 你可以批改作業、查看成績，但「發布成績」按鈕由授課教師操作

⚠️ **提醒**：作業二批改截止建議於 5/17 前完成（讓教師有時間審閱後發布）

我可以幫助你了解批改進度、學生成績分佈。請告訴我你需要什麼！`;

    case 'department_head':
      return `黃主任，你好！我是行政 AI 助手 🤖

📊 **資管系系所摘要**
- 全系在學學生：**312 位**，教師：**19 位**
- **${pendingAnnouncements} 則公告待審核**${pendingAnnouncements > 0 ? '，請[前往管理後台](/admin)處理' : '（目前無待審公告）'}
- 本學期開設課程：**${NEXT_SEM_COURSES.length + 8} 門**
- 本週有 **2 堂課有點名紀錄**需確認

我可以幫你查詢課程統計、學生選課分析、或協助規劃系所公告。
有什麼需要我分析的嗎？`;

    case 'admin':
      return `管理員，你好！我是系統 AI 助手 🤖

⚙️ **系統狀態摘要**
- 總使用者：**139 位**（學生 115、教師 19、管理員 5）
- 本學期活躍課程：**${NEXT_SEM_COURSES.length + 8} 門**，社團：**6 個**
- 已發布公告：**${DEMO_ANNOUNCEMENTS.length} 則**
- 系統狀態：**正常運行** ✅

我可以協助你查詢系統資料、使用者管理、公告審核，或統計分析。
請說明你需要什麼幫助！`;

    case 'club_officer': {
      const officerUnread = getUnreadCountDynamic('club_officer', store);
      return `陳社長，你好！我是校園 AI 助手 🤖

🎯 **程式設計社狀況**
- 成員：**120 位**，未讀訊息：**${officerUnread} 則**
- **黑客松報名截止：2026-05-19**（距今還有 2 天！）
- 黑客松活動：**2026-05-23 週六**，地點：工程館 B101
${pendingClubMembers.length > 0 ? `\n📨 **${pendingClubMembers.length} 份新入社申請待審核**（${pendingClubMembers.map(m => m.studentName).join('、')}），請前往社團頁面處理。` : ''}
⚠️ **建議馬上發公告**提醒成員報名截止日！

我可以協助你規劃社團活動、起草公告或管理成員名單。
有什麼需要我幫你準備的嗎？`;
    }

    case 'alumni':
      return `張學長，你好！歡迎回到校友服務系統 🤖

🎓 你是**資管系 109 屆校友**，畢業已 3 年，現任軟體工程師。
📊 **在校記錄**：畢業 GPA 3.65，已修 128 學分，順利畢業 ✅

我可以協助你瀏覽校園最新公告（${DEMO_ANNOUNCEMENTS.length} 則）、整理在校成績摘要、說明校友活動資訊。
⚠️ 注意：校友身份無法加入社團、借書或修改在校資料。

有什麼想了解的嗎？`;

    default:
      return `你好！歡迎使用校園 AI 助理 🤖

我可以協助你了解校園資訊、課程、社團與活動。
請先[登入](/login)以獲取個人化服務，或直接問我公開資訊！`;
  }
}

// ── 主頁面元件 ────────────────────────────────────────────────
export default function AIAssistantPage(props: {
  searchParams?: { school?: string; schoolId?: string; q?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const store = useDemoStore();
  const { success, info } = useToast();

  // AI 主軸：通用動作 modal
  const [actionModal, setActionModal] = useState<{
    title: string;
    body: import('react').ReactNode;
    footer?: import('react').ReactNode;
  } | null>(null);

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

    const systemCtx = buildAISystemContext(demoRole);
    const apiMessages = [
      { role: 'system', content: systemCtx },
      ...messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ];

    try {
      const reply = await callAI(apiMessages, demoRole);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: reply.content,
          cards: reply.cards,
          suggestions: reply.suggestions,
          timestamp: new Date(),
        },
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
  }, [isLoading, demoRole]);

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
  const isStudentLike = demoRole === 'student' || demoRole === 'ta' || demoRole === 'alumni';
  const roleDef = getDemoRoleDefinition(demoRole);
  const summary = getCreditSummary();
  const quickPrompts = ROLE_QUICK_PROMPTS[demoRole] ?? ROLE_QUICK_PROMPTS.student;

  // 根據角色決定頁面標題與副標題
  const pageTitle = (() => {
    switch (demoRole) {
      case 'teacher': return 'AI 教學助理';
      case 'ta':      return 'AI 批改助理';
      case 'club_officer': return 'AI 社團助理';
      case 'department_head': return 'AI 行政助理';
      case 'admin':   return 'AI 系統助理';
      case 'alumni':  return 'AI 校友服務';
      case 'guest':   return 'AI 校園助理';
      default:        return 'AI 選課助理';
    }
  })();

  const pageSubtitle = (() => {
    switch (demoRole) {
      case 'teacher': return '分析班級表現、出考題、生成批改回饋範本';
      case 'ta':      return '批改建議、評分標準查詢、回覆學生問題';
      case 'club_officer': return '活動規劃、招募文案、社團活躍度分析';
      case 'department_head': return '課程統計分析、公告草稿、師資建議';
      case 'admin':   return '系統安全監控、使用者管理、維護公告';
      case 'alumni':  return '在校成績摘要、校友活動、申辦服務說明';
      case 'guest':   return '了解校園功能、申請帳號說明';
      default:        return '根據你的學分、成績、時間表，AI 幫你規劃最佳選課';
    }
  })();

  return (
    <SiteShell
      title={pageTitle}
      subtitle={pageSubtitle}
      schoolName={schoolName}
    >
      <div className="pageStack">
        {/* ── 訪客提示 ── */}
        {isRestrictedRole && (
          <div
            className="card"
            style={{
              padding: '14px 16px',
              background: 'rgba(88,86,214,0.08)',
              border: '1px solid #5856D6',
              fontSize: 13,
            }}
          >
            👀 <strong>訪客身份</strong> · 我可以介紹校園 App 功能，但無法提供個人化服務。
            <Link href={`/login${q}`} style={{ marginLeft: 8, color: 'var(--brand)' }}>
              登入查看個人化建議 →
            </Link>
          </div>
        )}

        {/* ── 學生 / TA / 校友：學分快照卡 ── */}
        {isStudentLike && (
          <div
            className="card"
            style={{ padding: '12px 16px', display: 'flex', gap: 16, flexWrap: 'wrap' }}
          >
            {demoRole === 'alumni' ? (
              // 校友：顯示畢業資訊
              [
                { label: '已修學分', val: 128, color: '#5856D6' },
                { label: '畢業年份', val: '109屆', color: '#34C759' },
                { label: '畢業 GPA', val: '3.65', color: '#FF9500' },
              ].map((s) => (
                <div key={s.label} style={{ flex: '1 1 80px', textAlign: 'center', padding: '8px 4px', borderRadius: 'var(--radius-sm)', background: 'var(--panel2)' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color, letterSpacing: '-0.04em' }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))
            ) : (
              // 學生 / TA：學分進度
              [
                { label: '已修學分', val: summary.historicalEarned, color: '#5856D6' },
                { label: '修習中', val: summary.currentSemester, color: '#34C759' },
                { label: '還差', val: summary.remaining, color: '#FF9500' },
                { label: '畢業需求', val: summary.totalRequired, color: '#8E8E93' },
              ].map((s) => (
                <div key={s.label} style={{ flex: '1 1 80px', textAlign: 'center', padding: '8px 4px', borderRadius: 'var(--radius-sm)', background: 'var(--panel2)' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color, letterSpacing: '-0.04em' }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── 教師 / TA：課程摘要卡 ── */}
        {(demoRole === 'teacher' || demoRole === 'ta') && (
          <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: '課程', val: '資料結構', color: '#5856D6' },
              { label: '修課人數', val: 48, color: '#5856D6' },
              { label: '待批改', val: TEACHER_PENDING_REVIEWS.filter(r => r.status === 'submitted').length + getPendingSubmissions('c1', store).length, color: '#FF9500' },
            ].map((s) => (
              <div key={s.label} style={{ flex: '1 1 80px', textAlign: 'center', padding: '8px 4px', borderRadius: 'var(--radius-sm)', background: 'var(--panel2)' }}>
                <div style={{ fontSize: typeof s.val === 'number' ? 24 : 16, fontWeight: 700, color: s.color, letterSpacing: '-0.04em' }}>{s.val}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── 社團幹部：社團摘要卡 ── */}
        {demoRole === 'club_officer' && (
          <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: '社團', val: '程式設計社', color: '#34C759' },
              { label: '成員', val: 120, color: '#5856D6' },
              { label: '待審申請', val: getPendingClubMembers('club-1', store).length, color: '#FF9500' },
            ].map((s) => (
              <div key={s.label} style={{ flex: '1 1 80px', textAlign: 'center', padding: '8px 4px', borderRadius: 'var(--radius-sm)', background: 'var(--panel2)' }}>
                <div style={{ fontSize: typeof s.val === 'number' ? 24 : 14, fontWeight: 700, color: s.color, letterSpacing: '-0.04em' }}>{s.val}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── 系主任：系所摘要卡 ── */}
        {demoRole === 'department_head' && (
          <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: '在學學生', val: 312, color: '#5856D6' },
              { label: '教師人數', val: 19, color: '#5856D6' },
              { label: '待審公告', val: readPendingAnns().length, color: '#FF9500' },
            ].map((s) => (
              <div key={s.label} style={{ flex: '1 1 80px', textAlign: 'center', padding: '8px 4px', borderRadius: 'var(--radius-sm)', background: 'var(--panel2)' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color, letterSpacing: '-0.04em' }}>{s.val}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── 管理員：系統摘要卡 ── */}
        {demoRole === 'admin' && (
          <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: '系統狀態', val: '✅ 正常', color: '#34C759' },
              { label: '活躍使用者', val: 89, color: '#5856D6' },
              { label: '安全事件', val: 1, color: '#FF3B30' },
            ].map((s) => (
              <div key={s.label} style={{ flex: '1 1 80px', textAlign: 'center', padding: '8px 4px', borderRadius: 'var(--radius-sm)', background: 'var(--panel2)' }}>
                <div style={{ fontSize: typeof s.val === 'number' ? 24 : 16, fontWeight: 700, color: s.color, letterSpacing: '-0.04em' }}>{s.val}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── 一鍵動作（AI 主軸 — 真的會改 demoStore） ── */}
        {!isRestrictedRole ? (
          <AIActionBar
            role={demoRole}
            roleLabel={roleDef.label}
            store={store}
            onClose={() => setActionModal(null)}
            openModal={(m) => setActionModal(m)}
            toastSuccess={success}
            toastInfo={info}
          />
        ) : null}

        {/* ── 快速問題（角色感知） ── */}
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
            {roleDef.icon} {roleDef.label}快速問題
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {quickPrompts.map((qp) => (
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
                  {msg.role === 'assistant' && msg.cards && msg.cards.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <AgentCardList cards={msg.cards} schoolId="pu" />
                    </div>
                  ) : null}
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
                placeholder={
                  demoRole === 'teacher' || demoRole === 'ta' ? '例如：哪些學生需要特別關注？幫我出期末考題…' :
                  demoRole === 'club_officer' ? '例如：幫我寫招募文案、規劃黑客松流程…' :
                  demoRole === 'department_head' ? '例如：本學期各課程平均分數？幫我起草系所公告…' :
                  demoRole === 'admin' ? '例如：過去 7 天有異常登入嗎？系統使用狀況摘要…' :
                  demoRole === 'alumni' ? '例如：整理我在校的成績摘要、如何申請成績單…' :
                  demoRole === 'guest' ? '例如：這個 App 有什麼功能？如何申請帳號…' :
                  '問我任何選課問題，例如：下學期應該選哪些課？'
                }
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
              {demoRole === 'teacher' || demoRole === 'ta' ? 'Enter 送出 · Shift+Enter 換行 · AI 已掌握課程與學生資料' :
               demoRole === 'club_officer' ? 'Enter 送出 · Shift+Enter 換行 · AI 已掌握社團資料' :
               demoRole === 'department_head' ? 'Enter 送出 · Shift+Enter 換行 · AI 已掌握系所統計資料' :
               demoRole === 'admin' ? 'Enter 送出 · Shift+Enter 換行 · AI 已掌握系統狀態資料' :
               demoRole === 'alumni' ? 'Enter 送出 · Shift+Enter 換行 · AI 已掌握你的在校記錄' :
               demoRole === 'guest' ? 'Enter 送出 · Shift+Enter 換行 · 登入後可獲得個人化服務' :
               'Enter 送出 · Shift+Enter 換行 · AI 已掌握你的完整學籍資料'}
            </div>
          </div>
        </div>

        {/* ── 下學期課程快覽（僅學生 / TA / 校友顯示） ── */}
        {(demoRole === 'student' || demoRole === 'ta' || demoRole === 'alumni') && (
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
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* AI 主軸通用動作 Modal */}
      <Modal
        isOpen={actionModal !== null}
        onClose={() => setActionModal(null)}
        title={actionModal?.title}
        size="lg"
        footer={actionModal?.footer ?? (
          <button
            type="button"
            className="btn"
            onClick={() => setActionModal(null)}
          >
            關閉
          </button>
        )}
      >
        {actionModal?.body}
      </Modal>
    </SiteShell>
  );
}

// ─────────────────────────────────────────────────────────────
// AIActionBar — AI 主軸「一鍵動作」區塊
// 每個角色 3~5 個按鈕，按下去會真的呼叫 demoStore 動作，
// 並在訊息列、其他角色 dashboard 看到結果。
// ─────────────────────────────────────────────────────────────

type AIActionModal = {
  title: string;
  body: import('react').ReactNode;
  footer?: import('react').ReactNode;
};

function AIActionBar({
  role,
  roleLabel,
  store,
  openModal,
  onClose,
  toastSuccess,
  toastInfo,
}: {
  role: DemoRole;
  roleLabel: string;
  store: ReturnType<typeof useDemoStore>;
  openModal: (m: AIActionModal) => void;
  onClose: () => void;
  toastSuccess: (msg: string) => void;
  toastInfo: (msg: string) => void;
}) {
  // 各角色一鍵動作清單
  const actions = buildActions({ role, roleLabel, store, openModal, onClose, toastSuccess, toastInfo });

  if (actions.length === 0) return null;

  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        background:
          'linear-gradient(135deg, rgba(88,86,214,0.10) 0%, rgba(124,58,237,0.06) 100%)',
        border: '1px solid rgba(88,86,214,0.28)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--brand)',
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        🤖 AI 一鍵動作（直接寫入系統，跨角色看得到）
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px solid var(--brand)',
              background: 'var(--accent-soft)',
              color: 'var(--brand)',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{a.icon}</span>
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function buildActions(args: {
  role: DemoRole;
  roleLabel: string;
  store: ReturnType<typeof useDemoStore>;
  openModal: (m: AIActionModal) => void;
  onClose: () => void;
  toastSuccess: (msg: string) => void;
  toastInfo: (msg: string) => void;
}): { icon: string; label: string; onClick: () => void }[] {
  const { role, roleLabel, store, openModal, onClose, toastSuccess, toastInfo } = args;

  // ── student ──
  if (role === 'student') {
    return [
      {
        icon: '📚',
        label: '一鍵續借快到期書',
        onClick: () => {
          // 找出 store + DEFAULT_BORROWED 中 7 天內到期的書（demo 化簡：直接全部 +14）
          const ids = ['1', '2', '3'];
          const today = new Date().toISOString().slice(0, 10);
          ids.forEach((id) => {
            const override = store.borrowingOverrides[id];
            const cur = override?.dueDate ?? today;
            const cnt = override?.renewCount ?? 0;
            if (cnt < 3) renewBook(id, cur, cnt);
          });
          toastSuccess('✅ 已續借 3 本書，到期日皆 +14 天');
        },
      },
      {
        icon: '🙋',
        label: '求助 TA',
        onClick: () => {
          requestHelp({
            courseId: 'c1',
            courseName: '資料結構',
            topic: '鏈結串列遞迴實作卡關，能否安排答疑時間？',
            urgency: 'normal',
            studentId: 'stu-001',
            studentName: roleLabel,
          });
          toastSuccess('🙋 已送出求助，TA 林助教會在 dashboard 看到並回覆');
        },
      },
      {
        icon: '📅',
        label: '請假',
        onClick: () => {
          openModal({
            title: '📅 請假申請',
            body: <LeaveRequestForm onSubmit={(reason, from, to) => {
              requestLeave({
                courseId: 'c1',
                courseName: '資料結構',
                studentId: 'stu-001',
                studentName: roleLabel,
                reason,
                dateFrom: from,
                dateTo: to,
              });
              toastSuccess('📅 已送出請假申請，王老師會在訊息中看到');
              onClose();
            }} />,
            footer: <></>,
          });
        },
      },
      {
        icon: '🍱',
        label: '訂餐',
        onClick: () => {
          placeOrder({
            studentId: 'stu-001',
            studentName: roleLabel,
            vendorName: '校園小棧',
            items: [
              { name: '雞排便當', qty: 1, price: 90 },
              { name: '紅茶', qty: 1, price: 25 },
            ],
          });
          toastSuccess('🍱 訂單已成立，店家會收到並通知你準備進度');
        },
      },
      {
        icon: '💬',
        label: '在資料結構討論區發問',
        onClick: () => {
          postDiscussion({
            courseId: 'c1',
            courseName: '資料結構',
            authorId: 'stu-001',
            authorName: roleLabel,
            preview: '請問期末專題提案的格式可以用 LaTeX 嗎？',
          });
          toastSuccess('💬 已發布討論，老師 / TA / 同學會收到通知');
        },
      },
    ];
  }

  // ── teacher ──
  if (role === 'teacher') {
    return [
      {
        icon: '✍️',
        label: 'AI 起草評語給班上 3 位重點學生',
        onClick: () => {
          [
            { studentId: 'stu-005', studentName: '張志偉', text: '你近期成績有下滑趨勢，建議加強樹與圖的基礎。老師可以協助安排額外輔導，請於下次上課前告知。' },
            { studentId: 'stu-009', studentName: '許志明', text: '邊緣通過，建議多參與討論區提問，並善用 AI 助理整理重點。' },
            { studentId: 'stu-003', studentName: '林俊宏', text: '進步空間還很大，期中比期末退步，建議系統性重做演算法練習題。' },
          ].forEach((s) => {
            submitFeedback({
              courseId: 'c1',
              courseName: '資料結構',
              studentId: s.studentId,
              studentName: s.studentName,
              draftPreview: s.text,
            });
          });
          toastSuccess('✍️ 已寄出 3 份個人化評語，學生會在訊息中看到');
        },
      },
      {
        icon: '⏰',
        label: '批量提醒未繳作業的學生',
        onClick: () => {
          bulkRemind({
            courseName: '資料結構',
            homeworkTitle: '期末專題提案',
            count: 5,
            fromName: roleLabel,
          });
          toastSuccess('⏰ 已發送 5 則提醒，全班 student inbox 即時收到');
        },
      },
      {
        icon: '🎓',
        label: '發布全班成績',
        onClick: () => {
          publishGrades({
            courseId: 'c1',
            courseName: '資料結構',
          });
          toastSuccess('🎓 已發布全班成績，每位學生收到對應分數');
        },
      },
      {
        icon: '📝',
        label: '指派下次互評',
        onClick: () => {
          assignPeerReview({
            courseId: 'c1',
            courseName: '資料結構',
            assignmentTitle: '期末專題提案',
            pairs: [
              { reviewerId: 'stu-001', reviewerName: '王小明', revieweeId: 'stu-002', revieweeName: '陳雅婷' },
              { reviewerId: 'stu-002', reviewerName: '陳雅婷', revieweeId: 'stu-003', revieweeName: '林俊宏' },
            ],
            dueDate: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
          });
          toastSuccess('📝 已指派 2 組同儕互評，學生收到通知');
        },
      },
    ];
  }

  // ── ta ──
  if (role === 'ta') {
    return [
      {
        icon: '🧑‍💻',
        label: `批量回覆求助佇列（${getOpenHelpRequests(store).length} 則）`,
        onClick: () => {
          const open = getOpenHelpRequests(store);
          if (open.length === 0) {
            toastInfo('目前佇列裡沒有求助訊息');
            return;
          }
          open.forEach((h) => {
            replyHelpRequest({
              helpId: h.id,
              reply: '已收到你的求助，下次答疑時間（週二 14:00 工程館 308）可一起討論。也可參考第 6 章課本 p. 158 的範例。',
              replierName: roleLabel,
            });
          });
          toastSuccess(`🧑‍💻 已回覆 ${open.length} 則求助`);
        },
      },
      {
        icon: '✍️',
        label: '起草批改回饋（給張志偉）',
        onClick: () => {
          submitFeedback({
            courseId: 'c1',
            courseName: '資料結構',
            studentId: 'stu-005',
            studentName: '張志偉',
            draftPreview: 'TA 林助教提醒：作業二的鏈結串列邊界條件未處理（最後一個節點刪除）。可以參考課本 p. 102 例題 4.3。',
          });
          toastSuccess('✍️ 已起草評語給張志偉');
        },
      },
    ];
  }

  // ── club_officer ──
  if (role === 'club_officer') {
    const pending = (store.clubMemberships ?? []).filter((m) => m.status === 'pending');
    return [
      {
        icon: '✅',
        label: `一鍵核准所有待審入社（${pending.length}）`,
        onClick: () => {
          if (pending.length === 0) {
            toastInfo('目前沒有待審申請');
            return;
          }
          pending.forEach((m) => {
            approveClubMember(m.id, { officerName: roleLabel });
          });
          toastSuccess(`✅ 已核准 ${pending.length} 位入社申請`);
        },
      },
      {
        icon: '📢',
        label: '提交招募公告（送待審）',
        onClick: () => {
          const title = '【程式設計社】2026 黑客松招募中';
          addPendingAnn({
            title,
            source: '程式設計社',
            submittedAt: '剛剛',
            submittedByRole: 'club_officer',
          });
          notifyDeptHeadNewAnn(title, '程式設計社');
          toastSuccess('📢 已送待審，系主任會在 admin 看到');
        },
      },
    ];
  }

  // ── department_head ──
  if (role === 'department_head') {
    const pendingAnns = readPendingAnns();
    return [
      {
        icon: '✅',
        label: `一鍵核准所有待審公告（${pendingAnns.length}）`,
        onClick: () => {
          if (pendingAnns.length === 0) {
            toastInfo('目前沒有待審公告');
            return;
          }
          pendingAnns.forEach((p) => {
            approvePendingAnn(p.id);
            notifyStudentsAnnApproved(p.title, p.source);
            notifySubmitterAnnApproved({
              title: p.title,
              submitterRole: p.submittedByRole as DemoRole,
              approvedBy: roleLabel,
            });
          });
          toastSuccess(`✅ 已核准 ${pendingAnns.length} 則公告，並通知提交者與學生`);
        },
      },
      {
        icon: '📣',
        label: '發系所廣播：期末考時程',
        onClick: () => {
          sendDeptBroadcast({
            title: '114-2 期末考試時程公告',
            body: '本學期期末考訂於 6/16~6/20 進行，請各授課教師於 5/30 前回報考場需求，學生請至 timetable 確認個人考程。',
            audience: ['student', 'teacher', 'ta'],
            fromName: roleLabel,
          });
          toastSuccess('📣 已發送系所廣播給全系師生');
        },
      },
      {
        icon: '🩺',
        label: '對 5 位掛科風險學生發輔導通知',
        onClick: () => {
          sendDeptBroadcast({
            title: '【期中關懷】學業預警',
            body: '系所注意到你在本學期某些必修科目進度落後，請於本週前主動聯絡導師或至學習輔導中心預約諮詢（含義務協助）。',
            audience: ['student'],
            fromName: '系所學業輔導小組',
          });
          toastSuccess('🩺 已對掛科風險學生發出輔導通知');
        },
      },
    ];
  }

  // ── admin ──
  if (role === 'admin') {
    const disabledCount = store.disabledUsers?.length ?? 0;
    return [
      {
        icon: '🚧',
        label: '廣播：今晚進入維護模式',
        onClick: () => {
          sendDeptBroadcast({
            title: '系統將於今晚進入維護模式',
            body: '系統將於今晚 23:00 進入例行維護，預計約 2 小時。請預先儲存進度。',
            audience: ['student', 'teacher', 'ta'],
            fromName: '系統管理員',
          });
          toastSuccess('🚧 已廣播全校：今晚維護');
        },
      },
      {
        icon: '🛡️',
        label: '一鍵封鎖可疑帳號',
        onClick: () => {
          // 示範：把 demo-alumni-1 封鎖（境外登入失敗來源）
          setUserDisabled('demo-alumni-1', true, 'AI 偵測：5 次境外登入失敗');
          toastSuccess(`🛡️ 已封鎖 demo-alumni-1（目前共 ${disabledCount + 1} 個被停用帳號）`);
        },
      },
      {
        icon: '🔐',
        label: '對所有教師發送密碼重設提醒',
        onClick: () => {
          sendDeptBroadcast({
            title: '【安全提醒】請重設您的登入密碼',
            body: '系統偵測到近期有多次密碼噴灑攻擊，為了您的帳號安全請於本週前重設密碼並啟用雙因素驗證。',
            audience: ['teacher'],
            fromName: '系統管理員',
          });
          toastSuccess('🔐 已對全校教師發送密碼重設提醒');
        },
      },
    ];
  }

  // ── alumni ──
  if (role === 'alumni') {
    return [
      {
        icon: '📄',
        label: '申請在校成績單',
        onClick: () => {
          sendDeptBroadcast({
            title: `【校友申請】${roleLabel} 申請在校成績單`,
            body: `校友 張學長（B09203001）申請在校成績單一份，請註冊組協助處理。`,
            audience: ['admin'],
            fromName: roleLabel,
          });
          toastSuccess('📄 申請已寄送至註冊組，3-5 個工作天內可至校友服務窗口領取');
        },
      },
      {
        icon: '🎉',
        label: '報名校友回娘家活動',
        onClick: () => {
          const { alreadyRegistered } = rsvpAlumniEvent({
            eventId: 'alumni-reunion-2026',
            eventName: '2026 校友回娘家活動',
            by: 'B09203001',
          });
          if (alreadyRegistered) {
            toastSuccess('✅ 你已經報名過了，活動詳情會再 Email 提醒');
          } else {
            toastSuccess('🎉 已成功報名 2026 校友回娘家，活動詳情會 Email 給你');
          }
        },
      },
    ];
  }

  return [];
}

// 請假表單元件（內部用）
function LeaveRequestForm({
  onSubmit,
}: {
  onSubmit: (reason: string, from: string, to: string) => void;
}) {
  // 用 lazy initializer 避免每次 render 都重新計算（並避免 react-hooks/purity 警告）
  const [reason, setReason] = useState('家中有事');
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 86400_000).toISOString().slice(0, 10));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ fontSize: 13, fontWeight: 600 }}>請假事由</label>
      <input
        className="input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <label style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>請假起日</label>
      <input
        className="input"
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <label style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>請假迄日</label>
      <input
        className="input"
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <button
        type="button"
        className="btn primary"
        onClick={() => onSubmit(reason, from, to)}
        style={{ marginTop: 6, alignSelf: 'flex-end' }}
      >
        送出請假申請
      </button>
    </div>
  );
}
