import { splitStudySection, type StudyMode } from '@/lib/studyTutor';
import { STUDY_SESSION_LIMITS } from './courseStudySession';
import {
  COURSE_STUDY_PROGRESS_LIMITS,
  parseCourseStudyProgress,
  serializeCourseStudyProgress,
  type CourseStudyProgressData,
  type CourseStudyProgressScope,
} from './courseStudyProgress';
import {
  buildStudyPracticeDeck,
  startStudyPracticeRound,
  type StudyPracticeResponse,
  type StudyPracticeRound,
} from './courseStudyPractice';

export const STUDY_PRACTICE_CHECKPOINT_FORMAT = 'campus-one-study-practice';
const CHECKPOINT_VERSION = 1;
const MODES: StudyMode[] = ['understand', 'exam', 'practice'];

export type StudyPracticeCheckpoint = {
  progress: CourseStudyProgressData;
  round: StudyPracticeRound;
};

function invalid(message = '練習進度檔格式不符，目前的學習內容沒有變更。'): never {
  throw new Error(message);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value as Record<string, unknown>;
}

function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const data = record(value);
  if (Reflect.ownKeys(data).length !== fields.length || fields.some((field) => !Object.hasOwn(data, field))) invalid();
  return data;
}

function integer(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) invalid();
  return value;
}

function bytes(raw: string): void {
  if (raw.length > COURSE_STUDY_PROGRESS_LIMITS.bytes ||
    new TextEncoder().encode(raw).byteLength > COURSE_STUDY_PROGRESS_LIMITS.bytes) {
    invalid('練習進度檔超過 8 MiB，請分批保存或先下載文字練習紀錄。');
  }
}

function readRound(value: unknown, progress: CourseStudyProgressData): StudyPracticeRound {
  const data = exact(value, ['mode', 'index', 'finished', 'cardIds', 'responses']);
  if (typeof data.mode !== 'string' || !MODES.includes(data.mode as StudyMode)) invalid();
  const mode = data.mode as StudyMode;
  if (mode !== progress.position.mode) invalid('練習模式與儲存的閱讀位置不一致，無法還原。');
  const available = buildStudyPracticeDeck(
    progress.source.sections.map(splitStudySection), progress.passages, mode,
  ).cards;
  if (!Array.isArray(data.cardIds) || data.cardIds.length === 0 || data.cardIds.length > available.length) invalid();
  const byId = new Map(available.map((card, index) => [card.id, { card, index }] as const));
  let lastIndex = -1;
  const cards = data.cardIds.map((id) => {
    if (typeof id !== 'string') invalid();
    const found = byId.get(id);
    if (!found || found.index <= lastIndex) invalid('練習題目與這份教材的講解紀錄不一致，無法還原。');
    lastIndex = found.index;
    return found.card;
  });
  const index = integer(data.index, cards.length - 1);
  if (typeof data.finished !== 'boolean' || (data.finished && index !== cards.length - 1)) invalid();
  const stored = record(data.responses);
  if (Reflect.ownKeys(stored).length !== cards.length ||
    cards.some((card) => !Object.hasOwn(stored, card.id))) invalid();

  const responses: Record<string, StudyPracticeResponse> = {};
  for (const card of cards) {
    const response = exact(stored[card.id], ['attempt', 'answerVisible', 'hintVisible', 'outcome']);
    if (typeof response.attempt !== 'string' || response.attempt.length > STUDY_SESSION_LIMITS.attemptCharacters ||
      typeof response.answerVisible !== 'boolean' || typeof response.hintVisible !== 'boolean' ||
      ![null, 'again', 'understood', 'skipped'].includes(response.outcome as string | null)) invalid();
    const outcome = response.outcome as StudyPracticeResponse['outcome'];
    if ((response.answerVisible && !response.attempt.trim()) ||
      // A learner may hide a once-read reference answer after self-assessing.
      // Preserve the rating in the v1 checkpoint without disclosing the answer.
      ((outcome === 'again' || outcome === 'understood') && !response.attempt.trim()) ||
      (outcome === 'skipped' && response.answerVisible)) invalid('練習的試答、揭答與自評狀態不一致，無法還原。');
    responses[card.id] = {
      attempt: response.attempt as string,
      answerVisible: response.answerVisible as boolean,
      hintVisible: response.hintVisible as boolean,
      outcome,
    };
  }
  // A finished round is reached only by deciding or skipping its last card.
  // A forged finished flag must not hide an unreviewed last question.
  if (data.finished && responses[cards[index].id].outcome === null) {
    invalid('練習摘要缺少最後一題的自評或略過紀錄，無法還原。');
  }
  const restored = startStudyPracticeRound(0, mode, cards);
  const full = startStudyPracticeRound(0, mode, available);
  if (!restored || !full) invalid();
  // Old v1 checkpoints only store the active subset. The validated reading
  // snapshot reconstructs the original full deck without changing the format.
  return { ...restored, allCards: full.allCards, index, finished: data.finished as boolean, responses };
}

/** Self-contained backup: an existing v2 reading snapshot plus a separately validated round. */
export function serializeStudyPracticeCheckpoint(checkpoint: StudyPracticeCheckpoint): string {
  const progress = JSON.parse(serializeCourseStudyProgress(checkpoint.progress)) as unknown;
  const round = checkpoint.round;
  const raw = JSON.stringify({
    format: STUDY_PRACTICE_CHECKPOINT_FORMAT,
    version: CHECKPOINT_VERSION,
    progress,
    practice: {
      mode: round.mode,
      index: round.index,
      finished: round.finished,
      cardIds: round.cards.map((card) => card.id),
      responses: round.responses,
    },
  });
  bytes(raw);
  // Validate the whole document before offering a file to the browser.
  parseStudyPracticeCheckpoint(raw, checkpoint.progress.scope);
  return raw;
}

export function parseStudyPracticeCheckpoint(
  raw: string, expectedScope: CourseStudyProgressScope,
): StudyPracticeCheckpoint {
  if (typeof raw !== 'string' || !raw.trim()) invalid();
  bytes(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    invalid('無法讀取練習進度檔，請選擇讀書白板儲存的 JSON 檔。');
  }
  const envelope = exact(parsed, ['format', 'version', 'progress', 'practice']);
  if (envelope.format !== STUDY_PRACTICE_CHECKPOINT_FORMAT || envelope.version !== CHECKPOINT_VERSION) {
    invalid('這不是目前支援的逐題練習進度檔。');
  }
  // Reuse the v1/v2 reader's source, quote, scope and passage-boundary checks.
  const progress = parseCourseStudyProgress(JSON.stringify(envelope.progress), expectedScope);
  return { progress, round: readRound(envelope.practice, progress) };
}

export function isStudyPracticeCheckpoint(raw: string): boolean {
  // Probe the file type without parsing arbitrarily large pasted content.
  // Full byte-accurate checks still run in the selected backup parser.
  if (typeof raw !== 'string' || raw.length > COURSE_STUDY_PROGRESS_LIMITS.bytes) return false;
  try {
    const parsed: unknown = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    return !!parsed && typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).format === STUDY_PRACTICE_CHECKPOINT_FORMAT;
  } catch {
    return false;
  }
}

export function courseStudyPracticeCheckpointFilename(sourceTitle: string): string {
  // Reuse the same sanitization / Unicode boundary as the reading progress backup.
  const safe = sourceTitle.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/gu, ' ')
    .replace(/\s+/g, ' ').trim().replace(/\.(pdf|txt|md)$/i, '').replace(/^[. ]+|[. ]+$/g, '');
  const title = Array.from(safe).slice(0, 48).join('').trim();
  return (title || '讀書白板') + '-逐題練習.campus-practice.json';
}
