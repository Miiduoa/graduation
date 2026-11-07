import {
  parseTutorExplanation,
  splitStudySection,
  STUDY_TUTOR_LIMITS,
  type StudyMode,
  type StudyPassage,
  type StudySource,
  type TutorExplanation,
} from '@/lib/studyTutor';
import { STUDY_SESSION_LIMITS, type StudyLesson, type StudyModeMemory, type StudyPassageMemory } from './courseStudySession';

const FORMAT = 'campus-one-study-progress';
const VERSION = 2;
type ProgressVersion = 1 | typeof VERSION;
const MODES: StudyMode[] = ['understand', 'exam', 'practice'];

export const COURSE_STUDY_PROGRESS_LIMITS = {
  bytes: 8 * 1024 * 1024,
  sections: STUDY_TUTOR_LIMITS.pdfPages,
  // The PDF reader can supply 100 warnings per page plus document-level warnings.
  warnings: 2_200,
  warningCharacters: 1_400,
  lessonId: 1_000_000_000,
} as const;

export type CourseStudyProgressScope = { platformAccountId: string; workspaceId: string };
export type CourseStudyProgressData = {
  scope: CourseStudyProgressScope;
  source: StudySource;
  position: { sectionIndex: number; passageIndex: number; mode: StudyMode };
  passages: Record<string, StudyPassageMemory>;
};

function invalid(message = '閱讀進度檔的內容不完整或格式不符，原本的白板內容尚未變更。'): never {
  throw new Error(message);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value as Record<string, unknown>;
}

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const result = object(value);
  if (Reflect.ownKeys(result).length !== fields.length || fields.some((field) => !Object.hasOwn(result, field))) invalid();
  return result;
}

function text(value: unknown, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) invalid();
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid();
  return value === 0 ? 0 : value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function readScope(value: unknown): CourseStudyProgressScope {
  const scope = exactObject(value, ['platformAccountId', 'workspaceId']);
  return {
    platformAccountId: text(scope.platformAccountId, 200, true),
    workspaceId: text(scope.workspaceId, 200, true),
  };
}

function readSource(value: unknown): StudySource {
  const source = exactObject(value, ['id', 'title', 'sections', 'warnings']);
  if (!Array.isArray(source.sections) || !source.sections.length ||
    source.sections.length > COURSE_STUDY_PROGRESS_LIMITS.sections ||
    !Array.isArray(source.warnings) || source.warnings.length > COURSE_STUDY_PROGRESS_LIMITS.warnings) invalid();
  let characters = 0;
  const ids = new Set<string>();
  const sections = Array.from(source.sections, (value) => {
    const section = exactObject(value, ['id', 'label', 'text']);
    const id = text(section.id, 1_000, true);
    if (ids.has(id)) invalid('閱讀進度檔含有重複的頁面來源，請重新選擇檔案。');
    ids.add(id);
    const body = text(section.text, STUDY_TUTOR_LIMITS.textCharacters, true);
    characters += body.length;
    if (characters > STUDY_TUTOR_LIMITS.textCharacters)
      invalid('進度檔的教材超過 60,000 字元，請改用較小份的閱讀進度。');
    return { id, label: text(section.label, 300, true), text: body };
  });
  return {
    // PDF sources prefix the original filename with "document:".
    id: text(source.id, 1_100, true),
    title: text(source.title, 1_000, true),
    sections,
    warnings: Array.from(source.warnings, (warning) => text(warning, COURSE_STUDY_PROGRESS_LIMITS.warningCharacters)),
  };
}

function readMode(value: unknown, passage: StudyPassage, version: ProgressVersion): StudyModeMemory {
  const memory = exactObject(value, ['question', 'lessons', 'selectedLessonId']);
  if (!Array.isArray(memory.lessons) || memory.lessons.length > STUDY_SESSION_LIMITS.lessonsPerMode) invalid();
  let previousId = 0;
  const lessons = Array.from(memory.lessons, (value): StudyLesson => {
    const lesson = exactObject(value, ['id', 'previousLessonId', 'question', 'response', 'attempt', 'answerVisible']);
    const id = integer(lesson.id, 1, COURSE_STUDY_PROGRESS_LIMITS.lessonId);
    if (id <= previousId) invalid('進度檔的講解編號重複或順序不正確，請重新選擇檔案。');
    previousId = id;
    const parentId = lesson.previousLessonId === null ? null : integer(lesson.previousLessonId, 1, id - 1);
    const attempt = text(lesson.attempt, STUDY_SESSION_LIMITS.attemptCharacters);
    const answerVisible = boolean(lesson.answerVisible);
    if (answerVisible && !attempt.trim()) invalid('進度檔的試答與參考回答狀態不一致，無法還原。');
    let response: TutorExplanation;
    try {
      // A matching quote confirms a relationship to this copy, not its authenticity or teaching quality.
      const savedResponse = object(lesson.response);
      const responseFields = ['title', 'explanation', 'sourceQuote', 'question', 'answer'];
      // Version 1 stays a five-field format even after the tutor learns new fields.
      if (version === 2 && Object.hasOwn(savedResponse, 'steps')) responseFields.push('steps');
      exactObject(savedResponse, responseFields);
      response = parseTutorExplanation(JSON.stringify(savedResponse), passage);
    } catch {
      invalid('進度檔中的講解無法對照該段原文，請重新選擇完整的進度檔。');
    }
    return { id, previousLessonId: parentId, question: text(lesson.question, STUDY_TUTOR_LIMITS.questionCharacters), response, attempt, answerVisible };
  });
  const ids = new Set(lessons.map((lesson) => lesson.id));
  for (const lesson of lessons) {
    // Keeping the last six lessons can legitimately discard an older ancestor.
    if (lesson.previousLessonId !== null && lesson.previousLessonId >= lessons[0].id && !ids.has(lesson.previousLessonId))
      invalid('進度檔的追問記錄有缺漏，無法確認講解的前後關係。');
  }
  const selectedLessonId = memory.selectedLessonId === null ? null
    : integer(memory.selectedLessonId, 1, COURSE_STUDY_PROGRESS_LIMITS.lessonId);
  if (lessons.length ? selectedLessonId === null || !ids.has(selectedLessonId) : selectedLessonId !== null)
    invalid('進度檔所選取的講解不存在，請重新選擇完整的進度檔。');
  return { question: text(memory.question, STUDY_TUTOR_LIMITS.questionCharacters), lessons, selectedLessonId };
}

function readData(value: unknown, version: ProgressVersion, expectedScope?: CourseStudyProgressScope, passageLengths?: unknown): CourseStudyProgressData {
  const data = exactObject(value, ['scope', 'source', 'position', 'passages']);
  const scope = readScope(data.scope);
  if (expectedScope) {
    const expected = readScope(expectedScope);
    if (scope.platformAccountId !== expected.platformAccountId || scope.workspaceId !== expected.workspaceId)
      invalid('這份進度標示的帳號或課程與目前不同，請回到原帳號與課程還原。');
  }
  const source = readSource(data.source);
  const sections = source.sections.map(splitStudySection);
  // Boundaries are part of the saved format. A later splitter must not silently move a note.
  if (passageLengths !== undefined) {
    if (!Array.isArray(passageLengths) || passageLengths.length !== sections.length ||
      sections.some((parts, index) => {
        const lengths: unknown = passageLengths[index];
        return !Array.isArray(lengths) || lengths.length !== parts.length ||
          parts.some((part, partIndex) => lengths[partIndex] !== part.text.length);
      })) invalid('進度檔的分段記錄與教材不符，無法還原；原本的白板內容尚未變更。');
  }
  const position = exactObject(data.position, ['sectionIndex', 'passageIndex', 'mode']);
  const sectionIndex = integer(position.sectionIndex, 0, sections.length - 1);
  const passageIndex = integer(position.passageIndex, 0, sections[sectionIndex].length - 1);
  if (typeof position.mode !== 'string' || !MODES.includes(position.mode as StudyMode)) invalid();

  const validPassages = new Map<string, StudyPassage>();
  sections.forEach((parts, section) => parts.forEach((part, index) => validPassages.set(`${section}:${index}`, part)));
  const saved = object(data.passages);
  const keys = Reflect.ownKeys(saved);
  if (keys.length > validPassages.size || keys.some((key) => typeof key !== 'string' || !validPassages.has(key)))
    invalid('進度檔的筆記包含不存在的教材段落，無法還原。');
  const passages: Record<string, StudyPassageMemory> = {};
  for (const [key, passage] of validPassages) {
    if (!Object.hasOwn(saved, key)) continue;
    const memory = exactObject(saved[key], ['note', 'needsReview', 'modes']);
    const modes = exactObject(memory.modes, MODES);
    passages[key] = {
      note: text(memory.note, STUDY_SESSION_LIMITS.noteCharacters),
      needsReview: boolean(memory.needsReview),
      modes: {
        understand: readMode(modes.understand, passage, version),
        exam: readMode(modes.exam, passage, version),
        practice: readMode(modes.practice, passage, version),
      },
    };
  }
  return { scope, source, position: { sectionIndex, passageIndex, mode: position.mode as StudyMode }, passages };
}

function checkBytes(value: string) {
  if (value.length > COURSE_STUDY_PROGRESS_LIMITS.bytes || new TextEncoder().encode(value).byteLength > COURSE_STUDY_PROGRESS_LIMITS.bytes)
    invalid('閱讀進度檔上限為 8 MiB，請改用較小份的進度，或先下載文字筆記保留內容。');
}

/** Explicit, unencrypted local backup; no session token or automatic storage is involved. */
export function serializeCourseStudyProgress(data: CourseStudyProgressData): string {
  const canonical = readData(data, VERSION);
  const passageLengths = canonical.source.sections.map((section) => splitStudySection(section).map((part) => part.text.length));
  const serialized = JSON.stringify({ format: FORMAT, version: VERSION, ...canonical, passageLengths });
  checkBytes(serialized);
  return serialized;
}

/** Scope matching prevents accidental loading; it is not proof of ownership or encryption. */
export function parseCourseStudyProgress(raw: string, expectedScope: CourseStudyProgressScope): CourseStudyProgressData {
  if (typeof raw !== 'string' || !raw.trim()) invalid('這個閱讀進度檔沒有內容，請重新選擇。');
  checkBytes(raw);
  const expected = readScope(expectedScope);
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    invalid('無法讀取這個進度檔，請選擇由讀書白板儲存的閱讀進度 JSON 檔。');
  }
  const envelope = object(decoded);
  if (envelope.format !== FORMAT) invalid('這不是讀書白板的閱讀進度檔，請選擇正確的檔案。');
  if (envelope.version !== 1 && envelope.version !== VERSION)
    invalid('目前不支援這個閱讀進度檔的版本，請使用相容版本的進度檔。');
  exactObject(envelope, ['format', 'version', 'scope', 'source', 'position', 'passages', 'passageLengths']);
  return readData({ scope: envelope.scope, source: envelope.source, position: envelope.position, passages: envelope.passages },
    envelope.version, expected, envelope.passageLengths);
}

export function courseStudyProgressFilename(sourceTitle: string): string {
  const safe = sourceTitle.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/gu, ' ')
    .replace(/\s+/g, ' ').trim().replace(/\.(pdf|txt|md)$/i, '').replace(/^[. ]+|[. ]+$/g, '');
  const title = Array.from(safe).slice(0, 48).join('').trim();
  return `${title || '讀書白板'}-閱讀進度.campus-study.json`;
}
