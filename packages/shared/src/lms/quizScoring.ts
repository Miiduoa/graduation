/**
 * Quiz Scoring Engine — TronClass parity 測驗自動計分核心
 *
 * 設計目標：
 *  - 純函式（pure），不依賴 Firestore / React / 任何 I/O，可同時在 mobile / backend / web 跑
 *  - 支援 5 種題型：single_choice / multiple_choice / true_false / short_answer / essay
 *  - 自動可判題（single_choice / multiple_choice / true_false / short_answer）即時計分
 *  - essay 標記 needsManualGrading=true，pending 人工評分
 *  - multiple_choice 採部分分制（每多選一個錯誤選項扣 1/N 分，但不為負）
 *  - 提交後產出 QuizAttemptResult，可直接寫入 gradebookEntries
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'short_answer'
  | 'essay';

export interface QuestionOption {
  id: string;
  label: string;
  value: string;
  /** 正確答案標記（multiple_choice / single_choice / true_false 用） */
  isCorrect?: boolean;
}

export interface ScoringQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  /** 題目分數（預設 1） */
  points?: number;
  options?: QuestionOption[];
  /** 短答題：可接受答案陣列（不分大小寫、自動 trim） */
  acceptableAnswers?: string[];
  /** 短答題：是否區分大小寫，預設 false */
  caseSensitive?: boolean;
}

export interface UserAnswer {
  questionId: string;
  /** single_choice / true_false：選項 id；multiple_choice：選項 id 陣列；short_answer / essay：純文字 */
  value: string | string[];
}

export interface QuestionResult {
  questionId: string;
  type: QuestionType;
  points: number;
  earned: number;
  isCorrect: boolean;
  needsManualGrading: boolean;
  /** 自動判題用：使用者選了哪些 / 寫了什麼 */
  userValue: string | string[];
  /** 自動判題用：正解 */
  correctValue: string | string[] | null;
}

export interface QuizAttemptResult {
  totalPoints: number;
  earnedPoints: number;
  autoGradedPoints: number;
  pendingManualPoints: number;
  percentage: number | null;
  needsManualGrading: boolean;
  questionResults: QuestionResult[];
  submittedAt: string;
}

// ─────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────

function normalizeShortAnswer(s: string, caseSensitive: boolean): string {
  const trimmed = String(s ?? '').trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function pointsOf(q: ScoringQuestion): number {
  const p = Number(q.points ?? 1);
  return Number.isFinite(p) && p > 0 ? p : 1;
}

function correctOptionIds(q: ScoringQuestion): string[] {
  return (q.options ?? []).filter((o) => o.isCorrect === true).map((o) => o.id);
}

function asArray(v: string | string[] | undefined | null): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
}

// ─────────────────────────────────────────────────────────
// 單題判分
// ─────────────────────────────────────────────────────────

export function scoreQuestion(
  question: ScoringQuestion,
  answer: UserAnswer | undefined,
): QuestionResult {
  const points = pointsOf(question);
  const userValue = answer?.value ?? '';

  // essay 一律人工
  if (question.type === 'essay') {
    return {
      questionId: question.id,
      type: question.type,
      points,
      earned: 0,
      isCorrect: false,
      needsManualGrading: true,
      userValue,
      correctValue: null,
    };
  }

  // single_choice / true_false：完全相符才給分
  if (question.type === 'single_choice' || question.type === 'true_false') {
    const correct = correctOptionIds(question);
    const correctValue = correct[0] ?? null;
    const picked = typeof userValue === 'string' ? userValue : asArray(userValue)[0] ?? '';
    const isCorrect = !!correctValue && picked === correctValue;
    return {
      questionId: question.id,
      type: question.type,
      points,
      earned: isCorrect ? points : 0,
      isCorrect,
      needsManualGrading: false,
      userValue: picked,
      correctValue,
    };
  }

  // multiple_choice：部分分制
  // 公式：earned = points * max(0, correctHits/totalCorrect - wrongHits/totalWrong)
  if (question.type === 'multiple_choice') {
    const correct = new Set(correctOptionIds(question));
    const allOptions = (question.options ?? []).map((o) => o.id);
    const totalCorrect = correct.size;
    const totalWrong = Math.max(allOptions.length - totalCorrect, 1);
    const picked = new Set(asArray(userValue));
    let correctHits = 0;
    let wrongHits = 0;
    picked.forEach((id) => {
      if (correct.has(id)) correctHits += 1;
      else if (allOptions.includes(id)) wrongHits += 1;
    });
    const ratio = totalCorrect === 0 ? 0 : correctHits / totalCorrect - wrongHits / totalWrong;
    const earnedRaw = Math.max(0, points * ratio);
    const earned = Math.round(earnedRaw * 100) / 100;
    return {
      questionId: question.id,
      type: question.type,
      points,
      earned,
      isCorrect: earned === points,
      needsManualGrading: false,
      userValue: Array.from(picked),
      correctValue: Array.from(correct),
    };
  }

  // short_answer：與 acceptableAnswers 比對
  if (question.type === 'short_answer') {
    const accepts = (question.acceptableAnswers ?? []).map((a) =>
      normalizeShortAnswer(a, !!question.caseSensitive),
    );
    const userText = typeof userValue === 'string' ? userValue : asArray(userValue).join(' ');
    const normalized = normalizeShortAnswer(userText, !!question.caseSensitive);
    const isCorrect = accepts.length > 0 && accepts.includes(normalized);
    return {
      questionId: question.id,
      type: question.type,
      points,
      earned: isCorrect ? points : 0,
      isCorrect,
      needsManualGrading: false,
      userValue: userText,
      correctValue: question.acceptableAnswers ?? null,
    };
  }

  // fallback
  return {
    questionId: question.id,
    type: question.type,
    points,
    earned: 0,
    isCorrect: false,
    needsManualGrading: true,
    userValue,
    correctValue: null,
  };
}

// ─────────────────────────────────────────────────────────
// 整份試卷判分
// ─────────────────────────────────────────────────────────

export function scoreQuizAttempt(
  questions: ScoringQuestion[],
  answers: UserAnswer[],
  options: { submittedAt?: string } = {},
): QuizAttemptResult {
  const answerByQ = new Map<string, UserAnswer>();
  for (const a of answers) answerByQ.set(a.questionId, a);

  const results = questions.map((q) => scoreQuestion(q, answerByQ.get(q.id)));

  const totalPoints = results.reduce((acc, r) => acc + r.points, 0);
  const autoGradedPoints = results
    .filter((r) => !r.needsManualGrading)
    .reduce((acc, r) => acc + r.earned, 0);
  const pendingManualPoints = results
    .filter((r) => r.needsManualGrading)
    .reduce((acc, r) => acc + r.points, 0);
  const earnedPoints = autoGradedPoints;
  const needsManualGrading = results.some((r) => r.needsManualGrading);
  const percentage =
    totalPoints > 0 && !needsManualGrading
      ? Math.round((earnedPoints / totalPoints) * 10000) / 100
      : totalPoints > 0
      ? Math.round((earnedPoints / totalPoints) * 10000) / 100
      : null;

  return {
    totalPoints: Math.round(totalPoints * 100) / 100,
    earnedPoints: Math.round(earnedPoints * 100) / 100,
    autoGradedPoints: Math.round(autoGradedPoints * 100) / 100,
    pendingManualPoints: Math.round(pendingManualPoints * 100) / 100,
    percentage,
    needsManualGrading,
    questionResults: results,
    submittedAt: options.submittedAt ?? new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────
// 人工評分補回
// ─────────────────────────────────────────────────────────

/**
 * 教師對 essay 題給分後，把分數補回 QuizAttemptResult。
 * 不會超過該題滿分，不會低於 0。
 */
export function applyManualGrade(
  result: QuizAttemptResult,
  manualGrades: Record<string, number>,
): QuizAttemptResult {
  const questionResults = result.questionResults.map((qr) => {
    if (qr.needsManualGrading && Object.prototype.hasOwnProperty.call(manualGrades, qr.questionId)) {
      const raw = Number(manualGrades[qr.questionId]);
      const safe = Number.isFinite(raw) ? Math.max(0, Math.min(raw, qr.points)) : 0;
      return { ...qr, earned: Math.round(safe * 100) / 100, needsManualGrading: false };
    }
    return qr;
  });

  const totalPoints = questionResults.reduce((acc, r) => acc + r.points, 0);
  const earnedPoints = questionResults
    .filter((r) => !r.needsManualGrading)
    .reduce((acc, r) => acc + r.earned, 0);
  const autoGradedPoints = result.autoGradedPoints;
  const pendingManualPoints = questionResults
    .filter((r) => r.needsManualGrading)
    .reduce((acc, r) => acc + r.points, 0);
  const needsManualGrading = questionResults.some((r) => r.needsManualGrading);
  const percentage =
    totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 10000) / 100 : null;

  return {
    ...result,
    questionResults,
    totalPoints: Math.round(totalPoints * 100) / 100,
    earnedPoints: Math.round(earnedPoints * 100) / 100,
    autoGradedPoints: Math.round(autoGradedPoints * 100) / 100,
    pendingManualPoints: Math.round(pendingManualPoints * 100) / 100,
    needsManualGrading,
    percentage,
  };
}
