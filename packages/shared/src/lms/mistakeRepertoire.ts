/**
 * Mistake Repertoire — 個人錯題本引擎（TronClass 沒有）
 *
 * 設計：考完試的錯題自動進錯題本，配合間隔重複（spaced repetition）演算法
 * 排程下次該複習哪題。每次練對 ↑ confidence、練錯 ↓ confidence，
 * confidence 高的題目間隔變長，低的會頻繁出現。
 *
 * 演算法：Leitner system 變體
 *  - box 0 (新加入)：1 天後複習
 *  - box 1：3 天後
 *  - box 2：7 天後
 *  - box 3：14 天後
 *  - box 4：30 天後
 *  - 答錯 → box -1（最低 0）
 *  - 答對 → box +1（最高 4）
 *
 * 完全純函式 + AsyncStorage 友善（無循環引用、可序列化）。
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type MistakeQuestionKind = 'mcq' | 'short_answer' | 'essay' | 'numeric' | 'matching' | 'tf';

export interface MistakeEntry {
  /** 唯一 ID（建議 examId_questionId） */
  id: string;
  /** 來源課程 */
  courseId: string;
  courseName: string;
  /** 來源測驗 */
  examId: string;
  examTitle: string;
  /** 題目內容（純文字、可選 markdown） */
  questionText: string;
  /** 題型 */
  kind: MistakeQuestionKind;
  /** 學生的錯誤答案 */
  studentAnswer: string;
  /** 正確答案 */
  correctAnswer: string;
  /** 老師/系統的講解（可選） */
  explanation?: string;
  /** 學生標籤（自訂） */
  tags: string[];
  /** Leitner box: 0-4 */
  box: 0 | 1 | 2 | 3 | 4;
  /** ISO；上次練習時間 */
  lastPracticedAt: string;
  /** 累積答對次數 */
  correctCount: number;
  /** 累積答錯次數 */
  wrongCount: number;
  /** 從錯題本中已 retire（連續對 3 次後）→ 從活躍清單移除 */
  retired: boolean;
}

export interface PracticeAttempt {
  entryId: string;
  isCorrect: boolean;
  /** 學生這次的答案 */
  studentAnswer?: string;
  /** ISO */
  attemptedAt: string;
}

const BOX_INTERVAL_DAYS = [1, 3, 7, 14, 30];

// ─────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────

/** 加入新錯題到本子。已存在則更新 wrong count + reset box to 0。 */
export function addMistake(
  entries: MistakeEntry[],
  newEntry: Omit<MistakeEntry, 'box' | 'correctCount' | 'wrongCount' | 'lastPracticedAt' | 'retired'>,
  now: string,
): MistakeEntry[] {
  const existing = entries.find((e) => e.id === newEntry.id);
  if (existing) {
    return entries.map((e) =>
      e.id === newEntry.id
        ? {
            ...e,
            wrongCount: e.wrongCount + 1,
            box: 0,
            retired: false,
            lastPracticedAt: now,
            // 更新題目最新狀態
            studentAnswer: newEntry.studentAnswer,
            correctAnswer: newEntry.correctAnswer,
            explanation: newEntry.explanation ?? e.explanation,
          }
        : e,
    );
  }
  const created: MistakeEntry = {
    ...newEntry,
    box: 0,
    correctCount: 0,
    wrongCount: 1,
    lastPracticedAt: now,
    retired: false,
  };
  return [...entries, created];
}

/** 記錄一次練習結果，更新 box / counts / retired。 */
export function recordPractice(
  entries: MistakeEntry[],
  attempt: PracticeAttempt,
): MistakeEntry[] {
  return entries.map((e) => {
    if (e.id !== attempt.entryId) return e;
    const newCorrect = e.correctCount + (attempt.isCorrect ? 1 : 0);
    const newWrong = e.wrongCount + (attempt.isCorrect ? 0 : 1);
    const newBox = attempt.isCorrect
      ? (Math.min(4, e.box + 1) as MistakeEntry['box'])
      : 0;
    // 連續答對 3 次 (在 box 4 又答對) → retire
    const retired = e.box === 4 && attempt.isCorrect && newCorrect >= 3;
    return {
      ...e,
      box: newBox,
      correctCount: newCorrect,
      wrongCount: newWrong,
      lastPracticedAt: attempt.attemptedAt,
      retired,
    };
  });
}

/** 今天該複習的題目（box 對應間隔已到）。 */
export function dueToday(entries: MistakeEntry[], now: string): MistakeEntry[] {
  return entries.filter((e) => {
    if (e.retired) return false;
    const daysSince = (new Date(now).getTime() - new Date(e.lastPracticedAt).getTime()) / 86_400_000;
    return daysSince >= BOX_INTERVAL_DAYS[e.box];
  });
}

/** 統計：總題、按 box / 課程分群。 */
export interface MistakeStats {
  total: number;
  active: number; // 未 retired
  retired: number;
  dueTodayCount: number;
  byBox: Record<0 | 1 | 2 | 3 | 4, number>;
  byCourse: Array<{ courseId: string; courseName: string; count: number }>;
  byKind: Record<MistakeQuestionKind, number>;
  /** 整體錯題吸收率：retired / total */
  masteryRate: number;
}

export function statsOf(entries: MistakeEntry[], now: string): MistakeStats {
  const byBox: Record<0 | 1 | 2 | 3 | 4, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  const courseMap = new Map<string, { courseId: string; courseName: string; count: number }>();
  const byKind: Record<MistakeQuestionKind, number> = {
    mcq: 0,
    short_answer: 0,
    essay: 0,
    numeric: 0,
    matching: 0,
    tf: 0,
  };
  let active = 0;
  let retired = 0;
  for (const e of entries) {
    byBox[e.box] += 1;
    byKind[e.kind] += 1;
    if (e.retired) retired += 1;
    else active += 1;
    const c = courseMap.get(e.courseId);
    if (c) c.count += 1;
    else courseMap.set(e.courseId, { courseId: e.courseId, courseName: e.courseName, count: 1 });
  }
  return {
    total: entries.length,
    active,
    retired,
    dueTodayCount: dueToday(entries, now).length,
    byBox,
    byCourse: [...courseMap.values()].sort((a, b) => b.count - a.count),
    byKind,
    masteryRate: entries.length > 0 ? Math.round((retired / entries.length) * 100) / 100 : 0,
  };
}

/** 推薦今日練習集（最多 N 題；優先 box 低的 + 距上次練習越久越前）。 */
export function recommendDailyPracticeSet(
  entries: MistakeEntry[],
  now: string,
  limit: number = 10,
): MistakeEntry[] {
  const candidates = dueToday(entries, now);
  return candidates
    .sort((a, b) => {
      if (a.box !== b.box) return a.box - b.box;
      return new Date(a.lastPracticedAt).getTime() - new Date(b.lastPracticedAt).getTime();
    })
    .slice(0, limit);
}

/** 從 quiz 的 wrong answers 一次性批量加入。 */
export function importFromExamWrongAnswers(
  entries: MistakeEntry[],
  exam: {
    examId: string;
    examTitle: string;
    courseId: string;
    courseName: string;
  },
  wrongs: Array<{
    questionId: string;
    questionText: string;
    kind: MistakeQuestionKind;
    studentAnswer: string;
    correctAnswer: string;
    explanation?: string;
  }>,
  now: string,
): MistakeEntry[] {
  let acc = entries;
  for (const w of wrongs) {
    acc = addMistake(
      acc,
      {
        id: `${exam.examId}_${w.questionId}`,
        courseId: exam.courseId,
        courseName: exam.courseName,
        examId: exam.examId,
        examTitle: exam.examTitle,
        questionText: w.questionText,
        kind: w.kind,
        studentAnswer: w.studentAnswer,
        correctAnswer: w.correctAnswer,
        explanation: w.explanation,
        tags: [],
      },
      now,
    );
  }
  return acc;
}
