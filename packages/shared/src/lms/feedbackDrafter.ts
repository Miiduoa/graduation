/**
 * Feedback Drafter — 教師 AI 評語草稿引擎（TronClass 沒有）
 *
 * 設計：老師面對 30+ 份作業時最痛的是寫個人化評語。本引擎：
 *  1. 從 rubric 評分結果 + 學生作品摘要 → 自動起草中文評語
 *  2. 評語結構：肯定 → 具體建議 → 鼓勵下一步
 *  3. 老師可在 UI 微調後一鍵發送
 *  4. 風格控制：嚴格 / 中性 / 鼓勵
 *  5. 防止「太罐頭」：每份 draft 隨機抽不同肯定句，避免 30 份學生收到同一套
 *
 * 完全純函式 + 可序列化。
 */

import type { RubricCriterion, RubricEvaluation } from './rubricScoring';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type FeedbackTone = 'strict' | 'neutral' | 'encouraging';

export interface DraftFeedbackInput {
  /** 學生姓名（可用「同學」當 fallback） */
  studentName?: string;
  /** Rubric 評分 */
  rubric?: { criteria: RubricCriterion[] };
  evaluation?: RubricEvaluation;
  /** 學生分數，百分制 */
  scorePercent?: number | null;
  /** 學生作業內容摘要（純文字 < 500 chars） */
  workSummary?: string;
  /** 是否遲交 */
  isLate?: boolean;
  /** 風格 */
  tone?: FeedbackTone;
  /** 用於 deterministic rotation 的 seed（例：studentId） */
  seed?: string;
  /** 課程名稱（可選，加在開場） */
  courseName?: string;
}

export interface DraftFeedbackOutput {
  /** 完整評語草稿 */
  draft: string;
  /** 拆解：肯定 / 建議 / 結語 三段 */
  sections: {
    affirmation: string;
    suggestions: string[];
    closing: string;
  };
  /** 標記哪些 criteria 表現弱（< 60% level） */
  weakCriteria: string[];
}

// ─────────────────────────────────────────────────────────
// 句池（每個 tone × section 有多句，hash seed 抽一句避免雷同）
// ─────────────────────────────────────────────────────────

const AFFIRMATIONS: Record<FeedbackTone, string[]> = {
  strict: [
    '能在期限內完成整份作業，這是基本功；下一步要往細節品質衝刺。',
    '完成度看得到，但深度還有空間。',
    '架構抓得到，論點需要更精準。',
  ],
  neutral: [
    '整體完成度不錯，看得出你對題目有理解。',
    '主軸抓得清楚，下一步在細節打磨。',
    '提交的內容能回應到題目要求。',
  ],
  encouraging: [
    '看到你願意動手嘗試，這就是進步的起點！',
    '完成這份作業展現了你對課程的投入，很棒。',
    '你抓到題目想問的方向，這已經贏一半。',
  ],
};

const SUGGESTION_OPENERS: Record<FeedbackTone, string[]> = {
  strict: ['務必修正', '請特別注意', '下次必須改善', '不能再忽略'],
  neutral: ['建議補強', '可以再加強', '下次注意', '可以更細節'],
  encouraging: ['再多一點點', '試試看', '下一輪可以挑戰', '若再延伸'],
};

const CLOSINGS: Record<FeedbackTone, string[]> = {
  strict: [
    '請以這份回饋為準修正觀念，下次評量時我會檢視同樣的點。',
    '把這次的問題記下來，期末考的論點要看到改善。',
  ],
  neutral: [
    '若針對上述幾點修正一下，整份作業會更扎實。',
    '可以在下次討論時把這幾個問題提出來一起釐清。',
  ],
  encouraging: [
    '你已經走了一大段，再修一輪會更亮眼，加油！',
    '相信你之後一定能把這幾個點吃透，期待下次的進步。',
  ],
};

// 簡單可序列化 hash
function seedIndex(seed: string | undefined, modulo: number): number {
  if (!seed) return 0;
  let acc = 0;
  for (let i = 0; i < seed.length; i++) acc = (acc * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(acc) % modulo;
}

// ─────────────────────────────────────────────────────────
// 主函式
// ─────────────────────────────────────────────────────────

export function draftFeedback(input: DraftFeedbackInput): DraftFeedbackOutput {
  const tone: FeedbackTone = input.tone ?? 'neutral';
  const seed = input.seed ?? input.studentName ?? '';
  const studentName = input.studentName ?? '同學';

  // 1. 開場肯定句
  const affPool = AFFIRMATIONS[tone];
  const affirmation = `${studentName}，${affPool[seedIndex(seed + '_aff', affPool.length)]}`;

  // 2. 從 rubric 抓 weak criteria → 變成具體建議
  const weakCriteria: string[] = [];
  const suggestions: string[] = [];
  if (input.evaluation && input.rubric) {
    for (const cs of input.evaluation.perCriterion) {
      const c = input.rubric.criteria.find((x) => x.id === cs.criterionId);
      if (!c) continue;
      // 找出滿分 level 是多少
      const maxPoints = Math.max(...c.levels.map((l) => l.points));
      const ratio = maxPoints > 0 ? cs.rawPoints / maxPoints : 0;
      if (ratio < 0.6) {
        weakCriteria.push(c.title);
        const opener =
          SUGGESTION_OPENERS[tone][
            seedIndex(seed + '_sug_' + c.id, SUGGESTION_OPENERS[tone].length)
          ];
        suggestions.push(`${opener}「${c.title}」這個項目：可從教材或同學作品找對照例。`);
      }
    }
  }

  // 3. 沒 rubric 但有分數 → 根據分數段給一條通用建議
  if (suggestions.length === 0 && typeof input.scorePercent === 'number') {
    if (input.scorePercent < 60) {
      suggestions.push('整體掌握度未達標，建議找老師或同學討論幾個關鍵概念。');
    } else if (input.scorePercent < 75) {
      suggestions.push('論述清楚但深度可以再挖一層；下次嘗試多舉一個反例。');
    } else if (input.scorePercent < 90) {
      suggestions.push('已有水準，差別在細節打磨：格式 / 文獻 / 邊界條件再走一輪。');
    }
  }

  // 4. 遲交提醒（中性，不重複罵）
  if (input.isLate) {
    suggestions.push('這份作業遲交，請留意下次時間管理；可在 APP 的「今日駕駛艙」設定提醒。');
  }

  // 5. 結語
  const closingPool = CLOSINGS[tone];
  const closing = closingPool[seedIndex(seed + '_clo', closingPool.length)];

  // 6. 組裝
  const lines: string[] = [affirmation];
  if (suggestions.length > 0) {
    lines.push('', '具體建議：');
    for (const s of suggestions) lines.push(`- ${s}`);
  }
  if (input.workSummary) {
    lines.push('', `（針對你提到的「${truncate(input.workSummary, 40)}」這部分。）`);
  }
  lines.push('', closing);

  return {
    draft: lines.join('\n'),
    sections: { affirmation, suggestions, closing },
    weakCriteria,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ─────────────────────────────────────────────────────────
// Bulk-action helpers
// ─────────────────────────────────────────────────────────

export interface BulkReminderInput {
  /** 沒交作業的學生 */
  students: Array<{ uid: string; displayName: string; email?: string }>;
  homeworkTitle: string;
  courseId?: string | number;
  courseName: string;
  /** 作業 id（用於 deepLink） */
  homeworkId?: string | number;
  /** ISO */
  dueAt: string;
  tone?: FeedbackTone;
}

export interface BulkReminderItem {
  uid: string;
  email?: string;
  /** Inbox 標題 */
  title: string;
  /** Inbox 內文 */
  body: string;
  /** 系統內 deep link */
  deepLink: string;
}

/**
 * 老師對 N 個沒交作業的學生一鍵發提醒。
 * 為每個學生生成個人化的提醒（用 seedIndex 抽不同句子避免 30 個學生收一樣的訊息）。
 */
export function bulkReminders(input: BulkReminderInput): BulkReminderItem[] {
  const tone = input.tone ?? 'neutral';
  const dueDate = new Date(input.dueAt);
  const now = Date.now();
  const hoursLeft = (dueDate.getTime() - now) / 3_600_000;
  const isOverdue = hoursLeft < 0;

  const greetings = ['哈囉', 'Hi', '同學您好', '提醒一下'];
  const urgencyBlurb = isOverdue
    ? `已逾期 ${Math.abs(Math.round(hoursLeft))} 小時，請盡快補交。`
    : hoursLeft <= 24
      ? `${Math.round(hoursLeft)} 小時內截止，記得提交。`
      : `${Math.round(hoursLeft / 24)} 天內截止，提前準備。`;

  const closer = tone === 'encouraging'
    ? '有任何問題隨時來找老師討論，加油！'
    : tone === 'strict'
      ? '請務必如期完成，逾期將影響成績計算。'
      : '若有困難，記得在課程討論區提問或寫信給老師。';

  return input.students.map((s) => {
    const greeting = greetings[seedIndex(s.uid + 'g', greetings.length)];
    const title = isOverdue
      ? `📛 補交提醒：${input.homeworkTitle}`
      : `⏰ 作業到期提醒：${input.homeworkTitle}`;
    const body = [
      `${greeting} ${s.displayName}，`,
      `這是 ${input.courseName} 的作業「${input.homeworkTitle}」提醒：`,
      urgencyBlurb,
      '',
      closer,
    ].join('\n');
    const courseIdParam = input.courseId !== undefined ? `&courseId=${encodeURIComponent(String(input.courseId))}` : '';
    const hwIdParam = input.homeworkId !== undefined ? `&hwId=${encodeURIComponent(String(input.homeworkId))}` : '';
    return {
      uid: s.uid,
      email: s.email,
      title,
      body,
      deepLink: `HomeworkSubmit?hwTitle=${encodeURIComponent(input.homeworkTitle)}${courseIdParam}${hwIdParam}`,
    };
  });
}
