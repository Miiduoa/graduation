import { STUDY_TUTOR_LIMITS, type StudyMode, type StudyTutorTurn } from '@/lib/studyTutor';
import { hasVisibleStudyContent } from './studyEvidence';

export { hasVisibleStudyContent } from './studyEvidence';

export const STUDY_SESSION_LIMITS = {
  lessonsPerMode: 6,
  noteCharacters: 2_000,
  attemptCharacters: 2_000,
} as const;

/**
 * A response made only of whitespace, direction markers, joiners, variation
 * selectors, isolated combining marks or Braille blank is not an actual answer.
 * Require visible content for a new attempt to unlock a reference answer.
 * Keep real letters, mathematics, full emoji and attached accents intact.
 */
export function hasVisibleStudyAttempt(attempt: string): boolean {
  return hasVisibleStudyContent(attempt);
}

// Older backups can contain an expanded answer with a trim()-accepted attempt.
export function hasRevealedStudyAnswer(response: { attempt: string; answerVisible: boolean }): boolean {
  return response.answerVisible && !!response.attempt.trim();
}

export function canReviewStudyAnswer(lesson: StudyLesson): boolean {
  // Backups without an explicit gate used trim() to enable the reference answer.
  return lesson.answerReviewAllowed ?? (lesson.answerVisible || !!lesson.attempt.trim());
}

export type StudyLesson = StudyTutorTurn & {
  id: number;
  previousLessonId: number | null;
  attempt: string;
  answerVisible: boolean;
  answerReviewAllowed?: boolean;
};

export type StudyModeMemory = {
  question: string;
  lessons: StudyLesson[];
  selectedLessonId: number | null;
};

export type StudyPassageMemory = {
  note: string;
  needsReview: boolean;
  modes: Record<StudyMode, StudyModeMemory>;
};

export type StudySessionMemory = {
  revision: number;
  passages: Record<string, StudyPassageMemory>;
};

export function emptyStudyPassage(): StudyPassageMemory {
  const mode = (): StudyModeMemory => ({ question: '', lessons: [], selectedLessonId: null });
  return { note: '', needsReview: false, modes: { understand: mode(), exam: mode(), practice: mode() } };
}

export function updateStudyMode(
  passage: StudyPassageMemory,
  mode: StudyMode,
  update: (previous: StudyModeMemory) => StudyModeMemory,
): StudyPassageMemory {
  return { ...passage, modes: { ...passage.modes, [mode]: update(passage.modes[mode]) } };
}

export function studyLessonHistory(memory: StudyModeMemory, selectedId: number | null): StudyTutorTurn[] {
  const turns: StudyTutorTurn[] = [];
  let selected = memory.lessons.find((lesson) => lesson.id === selectedId);
  // Only follow the selected lesson's ancestry; another follow-up branch is unrelated.
  while (selected && turns.length < STUDY_TUTOR_LIMITS.historyTurns) {
    turns.unshift({ question: selected.question, response: selected.response });
    selected = memory.lessons.find((lesson) => lesson.id === selected?.previousLessonId);
  }
  return turns;
}

export function appendStudyLesson(
  passage: StudyPassageMemory, mode: StudyMode, turn: StudyTutorTurn, previousLessonId: number | null = null,
): StudyPassageMemory {
  return updateStudyMode(passage, mode, (previous) => {
    const id = (previous.lessons.at(-1)?.id ?? 0) + 1;
    return {
      question: '',
      selectedLessonId: id,
      lessons: [...previous.lessons, { ...turn, id, previousLessonId, attempt: '', answerVisible: false }].slice(-STUDY_SESSION_LIMITS.lessonsPerMode),
    };
  });
}
