import { courseStudyBackupFilenameStem } from './courseStudyBackupFilename';
import { locateStudyEvidence } from './studyEvidence';
import { splitStudySection, type StudyMode, type StudySource } from '@/lib/studyTutor';
import { hasVisibleStudyAttempt, hasVisibleStudyContent, type StudyPassageMemory } from './courseStudySession';

const modes: { value: StudyMode; label: string }[] = [
  { value: 'understand', label: '理解概念' },
  { value: 'exam', label: '考前複習' },
  { value: 'practice', label: '練習思路' },
];

/**
 * Never label an AI-generated quotation as source text unless the same
 * grapheme-safe evidence locator used by the reader finds it in this passage.
 * This proves literal presence, not correctness or relevance of the explanation.
 */
function txtCitationLabel(passageText: string, quote: string, step = false): string {
  if (locateStudyEvidence(passageText, quote)) return step ? '本步引用原文：' : '引用原文：';
  return step ? '本步 AI 引句（無法在本段逐字定位）：' : 'AI 引句（無法在本段逐字定位）：';
}

/**
 * A generated formula is only a literal source formula when all of its
 * graphemes occur in the current passage. Matching does not certify that the
 * AI explanation or mathematical transformation is correct.
 */
function txtFormulaLabel(passageText: string, formula: string): string {
  return locateStudyEvidence(passageText, formula)
    ? '原文公式：'
    : 'AI 公式（無法在本段逐字定位）：';
}

/**
 * Saved model responses may contain invisible-only quotations. Do not export
 * a blank-looking citation or hidden controls as though they were source text.
 */
function appendTxtCitation(lines: string[], passageText: string, quote: string, step = false): void {
  if (!hasVisibleStudyContent(quote)) {
    lines.push(step ? '本步 AI 引句：未提供可讀引句' : 'AI 引句：未提供可讀引句');
    return;
  }
  lines.push(txtCitationLabel(passageText, quote, step), quote);
}

/** Plain text only. Source/session ownership is maintained by CourseStudyPanel. */
export function buildCourseStudyNotes(
  courseTitle: string,
  source: StudySource,
  passages: Record<string, StudyPassageMemory>,
): string {
  const lines = [
    'nuni 讀書白板・本次學習筆記',
    `課程：${courseTitle}`,
    `講義：${source.title}`,
    '',
    'AI 講解與參考回答可能有誤，請對照原文。以下內容是自我檢查，非正式評分。',
    '待複習由自己標記；沒有標記不代表已學會。只匯出這次保留的筆記與講解。',
  ];
  if (source.warnings.length) lines.push('', '來源注意事項：', ...source.warnings);

  let included = 0;
  // Enumerate actual source passages, never arbitrary saved keys or their insertion order.
  source.sections.forEach((section, sectionIndex) => {
    splitStudySection(section).forEach((passage, passageIndex) => {
      const memory = passages[`${sectionIndex}:${passageIndex}`];
      if (!memory) return;
      // Invisible-only drafts stay editable in the study session, but must not
      // count as completed notes or create a misleading TXT export entry.
      const hasNote = hasVisibleStudyContent(memory.note);
      if (!hasNote && !memory.needsReview &&
        !modes.some((mode) => memory.modes[mode.value].lessons.length)) return;
      included += 1;
      lines.push('', '────────────────────', passage.label);
      if (memory.needsReview) lines.push('複習標記：待複習');
      if (hasNote) lines.push('', '我的筆記：', memory.note);
      lines.push('', '原文：', passage.text);

      for (const mode of modes) {
        for (const lesson of memory.modes[mode.value].lessons) {
          lines.push('', `${mode.label}・第 ${lesson.id} 次講解`);
          // Zero-width or detached-mark questions can survive trim(), but
          // should not create an apparently blank question in a student TXT.
          if (hasVisibleStudyContent(lesson.question)) lines.push('我的問題：', lesson.question);
          lines.push(
            `講解標題：${lesson.response.title}`,
            'AI 講解：', lesson.response.explanation, '',
          );
          appendTxtCitation(lines, passage.text, lesson.response.sourceQuote);
          if (lesson.response.steps?.length) {
            lines.push('', '分步講解：');
            lesson.response.steps.forEach((step, index) => {
              lines.push('', `第 ${index + 1} 步：${step.title}`,
                '本步講解：', step.explanation);
              appendTxtCitation(lines, passage.text, step.sourceQuote, true);
              if (step.formula && hasVisibleStudyContent(step.formula))
                lines.push(txtFormulaLabel(passage.text, step.formula), step.formula);
            });
          }
          // A stored model response can have a blank or invisible self-check.
          // Keep the entry, but never pretend an unreadable prompt or answer exists.
          if (hasVisibleStudyContent(lesson.response.question))
            lines.push('', '自我檢查題：', lesson.response.question);
          else
            lines.push('', '自我檢查題：AI 未提供可讀題目，請對照原文自行練習');
          const hasRevealedAnswer = lesson.answerVisible && !!lesson.attempt.trim();
          if (hasVisibleStudyAttempt(lesson.attempt) || hasRevealedAnswer)
            lines.push('', '我的試答：', lesson.attempt);
          if (hasRevealedAnswer) {
            if (hasVisibleStudyContent(lesson.response.answer))
              lines.push('', '參考回答（已展開）：', lesson.response.answer);
            else
              lines.push('', '參考回答：AI 未提供可讀回答，請對照原文');
          }
        }
      }
    });
  });
  if (!included) lines.push('', '本次尚未留下筆記、待複習標記或 AI 講解。');
  return `${lines.join('\n')}\n`;
}

/** A short UTF-8 filename, with no path separators or display-direction controls. */
export function courseStudyNotesFilename(sourceTitle: string): string {
  return `${courseStudyBackupFilenameStem(sourceTitle)}-學習筆記.txt`;
}
