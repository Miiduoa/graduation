import type { StudyMode, StudyPassage } from '@/lib/studyTutor';
import { STUDY_SESSION_LIMITS, type StudyPassageMemory } from './courseStudySession';
import { courseStudyNotesFilename } from './courseStudyNotes';

export type StudyPracticeCard = {
  id: string;
  /** Zero-based source positions; the original PDF/page label is kept in label. */
  sectionNumber: number;
  partNumber: number;
  mode: StudyMode;
  lessonId: number;
  label: string;
  question: string;
  answer: string;
  sourceQuote: string;
  sourceText: string;
};

export type StudyPracticeResponse = {
  attempt: string;
  answerVisible: boolean;
  hintVisible: boolean;
  outcome: 'again' | 'understood' | 'skipped' | null;
};

export type StudyPracticeRound = {
  revision: number;
  mode: StudyMode;
  cards: StudyPracticeCard[];
  /** Original source-ordered question set, even when cards is a retry subset. */
  allCards: StudyPracticeCard[];
  index: number;
  finished: boolean;
  responses: Record<string, StudyPracticeResponse>;
};

export type StudyPracticeAction =
  | { type: 'attempt'; value: string }
  | { type: 'toggle_answer' }
  | { type: 'toggle_hint' }
  | { type: 'go'; index: number }
  | { type: 'decide'; outcome: 'again' | 'understood' }
  | { type: 'skip' }
  | { type: 'restart'; scope: 'all' | 'pending' };

export type StudyPracticeSummary = {
  total: number;
  answered: number;
  understood: number;
  again: number;
  skipped: number;
  unreviewed: number;
  pending: number;
};

const modeLabels: Record<StudyMode, string> = {
  understand: '理解概念',
  exam: '考前複習',
  practice: '練習思路',
};

const outcomeLabels: Record<Exclude<StudyPracticeResponse['outcome'], null>, string> = {
  again: '還要再練一次',
  understood: '我已理解',
  skipped: '本輪略過',
};

function emptyResponse(): StudyPracticeResponse {
  return { attempt: '', answerVisible: false, hintVisible: false, outcome: null };
}

/** Read actual source order and only the selected lesson of the requested mode. */
export function buildStudyPracticeDeck(
  sectionPassages: readonly (readonly StudyPassage[])[],
  memories: Record<string, StudyPassageMemory>,
  mode: StudyMode,
): { cards: StudyPracticeCard[]; markedCount: number; missingCount: number } {
  const cards: StudyPracticeCard[] = [];
  let markedCount = 0;
  for (const [sectionIndex, passages] of sectionPassages.entries()) {
    for (const [passageIndex, passage] of passages.entries()) {
      const passageKey = `${sectionIndex}:${passageIndex}`;
      const memory = memories[passageKey];
      if (!memory?.needsReview) continue;
      markedCount += 1;
      const modeMemory = memory.modes[mode];
      const lesson = modeMemory.lessons.find((item) => item.id === modeMemory.selectedLessonId);
      if (!lesson) continue;
      cards.push({
        id: `${passageKey}:${mode}:${lesson.id}`,
        sectionNumber: sectionIndex,
        partNumber: passageIndex,
        mode,
        lessonId: lesson.id,
        label: passage.label,
        question: lesson.response.question,
        answer: lesson.response.answer,
        sourceQuote: lesson.response.sourceQuote,
        sourceText: passage.text,
      });
    }
  }
  return { cards, markedCount, missingCount: markedCount - cards.length };
}

/** A round owns primitive snapshots and never borrows a lecture's attempt or reveal state. */
export function startStudyPracticeRound(
  revision: number,
  mode: StudyMode,
  cards: readonly StudyPracticeCard[],
): StudyPracticeRound | null {
  if (!cards.length) return null;
  const snapshots = cards.map((card): StudyPracticeCard => ({
    id: card.id,
    sectionNumber: card.sectionNumber,
    partNumber: card.partNumber,
    mode: card.mode,
    lessonId: card.lessonId,
    label: card.label,
    question: card.question,
    answer: card.answer,
    sourceQuote: card.sourceQuote,
    sourceText: card.sourceText,
  }));
  return {
    revision,
    mode,
    cards: snapshots,
    allCards: snapshots.map((card) => ({ ...card })),
    index: 0,
    finished: false,
    responses: Object.fromEntries(snapshots.map((card) => [card.id, emptyResponse()])),
  };
}

function withResponse(round: StudyPracticeRound, response: StudyPracticeResponse): StudyPracticeRound {
  return { ...round, responses: { ...round.responses, [round.cards[round.index].id]: response } };
}

function advance(round: StudyPracticeRound): StudyPracticeRound {
  if (round.index === round.cards.length - 1) return { ...round, finished: true };
  return { ...round, index: round.index + 1 };
}

/** Finite, local self-check state. No model calls, grading, or changes to review marks. */
export function updateStudyPracticeRound(
  round: StudyPracticeRound,
  action: StudyPracticeAction,
): StudyPracticeRound {
  if (action.type === 'go') {
    if (!Number.isInteger(action.index) || action.index < 0 || action.index >= round.cards.length) return round;
    if (action.index === round.index && !round.finished) return round;
    return { ...round, index: action.index, finished: false };
  }
  if (action.type === 'restart') {
    if (action.scope !== 'all' && action.scope !== 'pending') return round;
    const cards = action.scope === 'all'
      ? round.allCards
      : round.cards.filter((card) => round.responses[card.id]?.outcome !== 'understood');
    const next = startStudyPracticeRound(round.revision, round.mode, cards);
    // Retrying a subset must not make the original full set unreachable.
    return next ? { ...next, allCards: round.allCards.map((card) => ({ ...card })) } : round;
  }
  if (round.finished) return round;
  const card = round.cards[round.index];
  const response = card && round.responses[card.id];
  if (!response) return round;

  switch (action.type) {
    case 'attempt':
      if (typeof action.value !== 'string' || action.value.length > STUDY_SESSION_LIMITS.attemptCharacters ||
        action.value === response.attempt) return round;
      return withResponse(round, { ...response, attempt: action.value, answerVisible: false, outcome: null });
    case 'toggle_answer':
      if (!response.attempt.trim()) return round;
      // Hiding a reference answer is a disclosure choice, not a new self-rating.
      // Only changing the attempt or explicitly reassessing should clear/replace it.
      return withResponse(round, { ...response, answerVisible: !response.answerVisible });
    case 'toggle_hint':
      return withResponse(round, { ...response, hintVisible: !response.hintVisible });
    case 'decide':
      if ((action.outcome !== 'again' && action.outcome !== 'understood') ||
        !response.attempt.trim() || !response.answerVisible) return round;
      return advance(withResponse(round, { ...response, outcome: action.outcome }));
    case 'skip':
      return advance(withResponse(round, { ...response, answerVisible: false, outcome: 'skipped' }));
    default:
      return round;
  }
}

/**
 * Find another not-yet-self-assessed card in source order, wrapping at the end.
 * A written draft is still unreviewed until the learner explicitly decides;
 * visiting another card must never mark the current one skipped.
 */
function adjacentUnreviewedStudyPracticeIndex(round: StudyPracticeRound, direction: 1 | -1): number | null {
  for (let offset = 1; offset < round.cards.length; offset += 1) {
    const index = (round.index + direction * offset + round.cards.length) % round.cards.length;
    const response = round.responses[round.cards[index].id];
    if (!response || response.outcome === null) return index;
  }
  return null;
}

/** Find another not-yet-self-assessed card forward in the active deck, wrapping once. */
export function nextUnreviewedStudyPracticeIndex(round: StudyPracticeRound): number | null {
  return adjacentUnreviewedStudyPracticeIndex(round, 1);
}

/** Find a previous unfinished card without changing any response or skipping the current card. */
export function previousUnreviewedStudyPracticeIndex(round: StudyPracticeRound): number | null {
  return adjacentUnreviewedStudyPracticeIndex(round, -1);
}

export function getStudyPracticeSummary(round: StudyPracticeRound): StudyPracticeSummary {
  const summary: StudyPracticeSummary = {
    total: round.cards.length, answered: 0, understood: 0, again: 0, skipped: 0, unreviewed: 0, pending: 0,
  };
  for (const card of round.cards) {
    const response = round.responses[card.id];
    if (response?.attempt.trim()) summary.answered += 1;
    if (response?.outcome === 'understood') summary.understood += 1;
    else {
      summary.pending += 1;
      if (response?.outcome === 'again') summary.again += 1;
      else if (response?.outcome === 'skipped') summary.skipped += 1;
      else summary.unreviewed += 1;
    }
  }
  return summary;
}

/** Export only this round's attempts and the answer/source disclosures the learner made. */
export function buildCourseStudyPracticeNotes(
  courseTitle: string,
  sourceTitle: string,
  round: StudyPracticeRound,
): string {
  const summary = getStudyPracticeSummary(round);
  const lines = [
    'nuni 讀書白板・本輪逐題複習',
    `課程：${courseTitle}`,
    `講義：${sourceTitle}`,
    `讀法：${modeLabels[round.mode]}`,
    `本輪狀態：${round.finished ? '本輪結束' : '進行中'}；共 ${summary.total} 題`,
    '',
    '以下自評由本人選擇，沒有自動評分，也不代表正式成績或已掌握教材。',
    'AI 題目與參考回答可能有誤，請對照教材。原本的筆記與待複習標記不會自動變更。',
    `本人自評：已理解 ${summary.understood} 題、再練一次 ${summary.again} 題、略過 ${summary.skipped} 題、尚未自評 ${summary.unreviewed} 題。`,
  ];
  round.cards.forEach((card, index) => {
    const response = round.responses[card.id] ?? emptyResponse();
    const canRevealAnswer = response.answerVisible && !!response.attempt.trim();
    lines.push(
      '', '────────────────────',
      `第 ${index + 1} 題／共 ${round.cards.length} 題`,
      `原文位置：${card.label}`,
      `讀法：${modeLabels[card.mode]}・第 ${card.lessonId} 次講解`,
      '自我檢查題：', card.question,
      '', '本輪試答：', response.attempt.trim() ? response.attempt : '（尚未作答）',
      `本人自評：${response.outcome ? outcomeLabels[response.outcome] : '尚未自評'}`,
      `原文提示：${response.hintVisible ? '已展開' : '未展開'}`,
    );
    if (canRevealAnswer) lines.push('', '參考回答（本輪已展開）：', card.answer);
    if (response.hintVisible || canRevealAnswer)
      lines.push('', '原文引句：', card.sourceQuote, '本段原文：', card.sourceText);
  });
  return `${lines.join('\n')}\n`;
}

export function courseStudyPracticeFilename(sourceTitle: string): string {
  return courseStudyNotesFilename(sourceTitle).replace(/-學習筆記\.txt$/u, '-逐題複習.txt');
}
