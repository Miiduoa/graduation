/**
 * Question Bank — TronClass parity P1-2
 *
 * 題庫資料模型 + 抽題演算法（純函式）。
 * 對應 Firestore 路徑：schools/{schoolId}/questionBanks/{bankId}/questions/{questionId}
 */

import type { ScoringQuestion } from './quizScoring';

export interface QuestionBankEntry extends ScoringQuestion {
  /** 用於分類：例如 "資料庫.SQL.JOIN" */
  topic?: string;
  /** 1=易 / 2=中 / 3=難 */
  difficulty?: 1 | 2 | 3;
  /** 標籤陣列 */
  tags?: string[];
  /** 建立者 uid */
  createdBy?: string;
  /** 使用次數（教師可看哪題最常出） */
  usedCount?: number;
}

export interface QuestionBank {
  id: string;
  schoolId: string;
  courseSpaceId?: string; // 若是課程私有
  title: string;
  description?: string;
  entries: QuestionBankEntry[];
}

export interface DrawQuestionsOptions {
  count: number;
  /** 從哪些 topic 抽（取交集） */
  topics?: string[];
  /** 難度分布，例如 { 1: 0.3, 2: 0.5, 3: 0.2 } */
  difficultyDistribution?: Partial<Record<1 | 2 | 3, number>>;
  /** 排除特定題目（例如最近用過） */
  excludeIds?: Set<string>;
  /** 偽隨機種子，方便測試可重現 */
  seed?: number;
}

// 簡單 LCG 偽隨機（純函式可測試）
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 從題庫抽 N 題（依難度分布 + topic 過濾），結果保證沒有重複。
 */
export function drawQuestionsForQuiz(
  bank: QuestionBank,
  options: DrawQuestionsOptions,
): QuestionBankEntry[] {
  const rand = mulberry32(options.seed ?? Date.now());
  let pool = bank.entries.filter((q) => !options.excludeIds?.has(q.id));
  if (options.topics && options.topics.length > 0) {
    pool = pool.filter((q) => q.topic && options.topics!.includes(q.topic));
  }

  if (!options.difficultyDistribution || Object.keys(options.difficultyDistribution).length === 0) {
    return shuffle(pool, rand).slice(0, options.count);
  }

  const buckets: Record<1 | 2 | 3, QuestionBankEntry[]> = {
    1: [],
    2: [],
    3: [],
  };
  for (const q of pool) {
    const d = (q.difficulty ?? 2) as 1 | 2 | 3;
    buckets[d].push(q);
  }
  for (const k of [1, 2, 3] as const) buckets[k] = shuffle(buckets[k], rand);

  const out: QuestionBankEntry[] = [];
  for (const k of [1, 2, 3] as const) {
    const ratio = Number(options.difficultyDistribution[k] ?? 0);
    const want = Math.round(options.count * ratio);
    out.push(...buckets[k].slice(0, want));
  }
  // 若還沒滿 count，從剩下池隨機補
  if (out.length < options.count) {
    const ids = new Set(out.map((q) => q.id));
    const rest = shuffle(
      pool.filter((q) => !ids.has(q.id)),
      rand,
    );
    out.push(...rest.slice(0, options.count - out.length));
  }
  return out.slice(0, options.count);
}

/**
 * 題庫健康檢查（教師端 UI 用，提醒「該補題了」）
 */
export interface QuestionBankHealth {
  totalQuestions: number;
  byType: Record<ScoringQuestion['type'], number>;
  byDifficulty: Record<1 | 2 | 3, number>;
  topicCoverage: Record<string, number>;
  warnings: string[];
}

export function checkQuestionBankHealth(bank: QuestionBank): QuestionBankHealth {
  const byType: QuestionBankHealth['byType'] = {
    single_choice: 0,
    multiple_choice: 0,
    short_answer: 0,
    essay: 0,
    true_false: 0,
  };
  const byDifficulty: QuestionBankHealth['byDifficulty'] = { 1: 0, 2: 0, 3: 0 };
  const topicCoverage: Record<string, number> = {};
  for (const q of bank.entries) {
    byType[q.type] = (byType[q.type] ?? 0) + 1;
    const d = (q.difficulty ?? 2) as 1 | 2 | 3;
    byDifficulty[d] += 1;
    if (q.topic) topicCoverage[q.topic] = (topicCoverage[q.topic] ?? 0) + 1;
  }

  const warnings: string[] = [];
  if (bank.entries.length < 10) warnings.push('題庫題目少於 10 題，難以抽到不重複測驗。');
  if (byDifficulty[3] === 0) warnings.push('沒有任何難題，建議補充進階題目。');
  if (Object.keys(topicCoverage).length < 3 && bank.entries.length > 0) {
    warnings.push('題目集中在少數 topic，難以做主題分區考試。');
  }
  return {
    totalQuestions: bank.entries.length,
    byType,
    byDifficulty,
    topicCoverage,
    warnings,
  };
}
