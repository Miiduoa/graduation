/**
 * Socratic Coach — AI 解題教練（TronClass 沒有）
 *
 * 設計：學生卡題時找 AI 幫忙，AI 不直接給答案，而是用 Socratic method 提示。
 * 本檔提供：
 *  1. 系統 prompt 模板（給 chatWithAI 用）
 *  2. Hint 等級控制：可從 L1 (最輕) 到 L5 (差一步給答案) 漸進提示
 *  3. detectAnswerLeak：偵測 AI 是否一不小心給了答案 → 重生
 *  4. 學生反作弊：防止用「請直接告訴我答案」繞過
 *
 * 完全純函式 + 可序列化 prompt。
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type SocraticLevel = 1 | 2 | 3 | 4 | 5;

export interface CoachRequest {
  /** 題目內容 */
  questionText: string;
  /** 學生目前嘗試 / 卡住的點 */
  studentAttempt: string;
  /** 課程 context */
  courseName?: string;
  /** Hint level；1 最輕，5 最具體 */
  level: SocraticLevel;
  /** 已對話歷史（給 AI 連貫） */
  history?: Array<{ role: 'student' | 'coach'; message: string }>;
  /** 是否禁用「給答案」（teacher 開）。預設 true */
  refuseDirectAnswer?: boolean;
  /** 題目正解（不會給學生，但給 AI 校準）。可選 */
  correctAnswer?: string;
}

export interface CoachResponse {
  /** 渲染給學生的 hint */
  hint: string;
  /** Hint 等級 */
  level: SocraticLevel;
  /** 建議下一輪要不要 escalate */
  shouldEscalate: boolean;
  /** 簡短意圖摘要（教師查 audit log 用） */
  intent: string;
}

// ─────────────────────────────────────────────────────────
// 1. System prompt
// ─────────────────────────────────────────────────────────

const LEVEL_GUIDANCE: Record<SocraticLevel, string> = {
  1: '只丟一個極輕的引導問題，讓學生發現自己思路缺口；絕不提示方向。',
  2: '指出題目中需要先注意的關鍵字或概念；不解釋只列出。',
  3: '提示要用到的公式名稱、定義或方法（不展開計算）。',
  4: '把解題拆成 2-3 個步驟；學生自己填每步內容。',
  5: '給出第一步的具體做法 + 提示下一步驗證點；仍不給最終答案。',
};

export function buildSocraticSystemPrompt(req: CoachRequest): string {
  const lines: string[] = [
    '你是一位耐心的學習教練（Socratic coach），協助大學生解題。',
    '',
    '【絕對禁止】',
    '1. 直接給最終答案、最終算式結果、選擇題正解、是非題答案、英文翻譯成品。',
    '2. 把整個解題流程一次列完。',
    '3. 用「答案是 X」、「正解：X」、「就是 X」之類句型。',
    '',
    '【你的職責】',
    '依照 hint 等級給對應深度的提示，引導學生「自己想出來」。',
    '',
    '【本次 hint level】',
    `Level ${req.level}：${LEVEL_GUIDANCE[req.level]}`,
    '',
    '【回應風格】',
    '- 一次最多 2-3 句。',
    '- 用提問或暗示句型（「想想看…」「先檢查…」「如果…那麼…」）。',
    '- 結尾不總結，把思考留給學生。',
    '- 中文回覆。',
  ];

  if (req.refuseDirectAnswer !== false) {
    lines.push('', '【拒答訊號】', '若學生說「直接告訴我答案 / 給答案 / 告訴我選哪個」，禮貌但堅定地拒絕，並重新引導。');
  }
  if (req.correctAnswer) {
    lines.push(
      '',
      '【校準資訊（學生看不到）】',
      `正確答案：${req.correctAnswer}（僅供你校準提示方向，絕不可洩漏給學生）。`,
    );
  }
  if (req.courseName) {
    lines.push('', `【課程】${req.courseName}`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────
// 2. 偵測 AI 是否洩漏答案
// ─────────────────────────────────────────────────────────

const ANSWER_LEAK_PATTERNS = [
  /答案是\s*[：:]?\s*\S/,
  /正解\s*[：:]?\s*\S/,
  /^\s*(就是|應該是|等於是)\s*\S/m,
  /選\s*[A-D]\s*$/m,
  /\b(true|false|正確|錯誤)\b\s*$/i,
];

export function detectAnswerLeak(aiText: string, correctAnswer?: string): boolean {
  for (const p of ANSWER_LEAK_PATTERNS) {
    if (p.test(aiText)) return true;
  }
  if (correctAnswer && aiText.includes(correctAnswer) && correctAnswer.length >= 3) {
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────
// 3. 學生試圖繞過偵測
// ─────────────────────────────────────────────────────────

const STUDENT_BYPASS_PATTERNS = [
  /直接(告訴|跟我說|給).*答案/,
  /告訴我選\s*[A-D]/,
  /幫我寫.*答案/,
  /\bjust give me the answer\b/i,
  /\bjust tell me\b/i,
  /\bplease (give|tell) me the answer\b/i,
];

export function detectStudentBypassAttempt(studentText: string): boolean {
  return STUDENT_BYPASS_PATTERNS.some((p) => p.test(studentText));
}

// ─────────────────────────────────────────────────────────
// 4. Hint 等級控制 (escalation policy)
// ─────────────────────────────────────────────────────────

export interface EscalationInput {
  /** 學生在這題已經求救幾次 */
  hintsAsked: number;
  /** 上次 hint 後學生是否做出新嘗試 */
  studentMadeNewAttempt: boolean;
  /** 學生留言是否露出明顯沮喪/放棄訊號 */
  showsFrustration?: boolean;
}

export function nextLevel(current: SocraticLevel, signals: EscalationInput): SocraticLevel {
  // 沒做新嘗試就要 hint → 不 escalate
  if (!signals.studentMadeNewAttempt && signals.hintsAsked > 0) return current;
  // 沮喪 → 提早升一級
  if (signals.showsFrustration) {
    return Math.min(5, current + 1) as SocraticLevel;
  }
  // 已經求救過 3+ 次 → 升一級
  if (signals.hintsAsked >= 3) {
    return Math.min(5, current + 1) as SocraticLevel;
  }
  return current;
}

// ─────────────────────────────────────────────────────────
// 5. Fallback hint (AI 失敗時的安全網)
// ─────────────────────────────────────────────────────────

const FALLBACK_HINTS_BY_LEVEL: Record<SocraticLevel, string[]> = {
  1: [
    '把題目慢慢讀一遍：每個關鍵字背後在問什麼？',
    '先寫下你已知什麼、未知什麼、要求什麼。',
    '畫一張圖或圖表，常常能看到題目的結構。',
  ],
  2: [
    '哪個概念跟這題最相關？翻翻最近的教材。',
    '把題目換成你自己的話再講一次，會發現缺少什麼資訊。',
    '檢查一下單位、變數名稱有沒有對齊。',
  ],
  3: [
    '想想看這題要套哪個公式或定義；翻教材的第 N 章。',
    '先設個變數代表未知數，再寫出已知條件的等式。',
    '檢查邊界條件（最小、最大、空集合）會發生什麼。',
  ],
  4: [
    '把解題拆成「先求 A，再用 A 推 B」這樣的步驟。寫出你的步驟看看。',
    '先算最簡單的 case，再 generalize 到完整題目。',
    '建立兩個方程式，再解聯立。先別跳到結果。',
  ],
  5: [
    '第一步：[把已知條件代入公式]。下一步驗證你算的單位對不對。',
    '第一步：[設 x = 未知數]。然後寫出題目給的等式。',
    '第一步：[列出 2-3 個情境]。逐個檢查哪個成立。',
  ],
};

export function fallbackHint(req: CoachRequest): CoachResponse {
  const pool = FALLBACK_HINTS_BY_LEVEL[req.level];
  const seed = (req.history?.length ?? 0) % pool.length;
  return {
    hint: pool[seed],
    level: req.level,
    shouldEscalate: false,
    intent: 'fallback',
  };
}
