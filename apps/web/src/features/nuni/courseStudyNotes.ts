import { courseStudyBackupFilenameStem } from './courseStudyBackupFilename';
import { splitStudySection, type StudyMode, type StudySource } from '@/lib/studyTutor';
import type { StudyPassageMemory } from './courseStudySession';

const modes: { value: StudyMode; label: string }[] = [
  { value: 'understand', label: '理解概念' },
  { value: 'exam', label: '考前複習' },
  { value: 'practice', label: '練習思路' },
];

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
      if (!memory || (!memory.note.trim() && !memory.needsReview &&
        !modes.some((mode) => memory.modes[mode.value].lessons.length))) return;
      included += 1;
      lines.push('', '────────────────────', passage.label);
      if (memory.needsReview) lines.push('複習標記：待複習');
      if (memory.note.trim()) lines.push('', '我的筆記：', memory.note);
      lines.push('', '原文：', passage.text);

      for (const mode of modes) {
        for (const lesson of memory.modes[mode.value].lessons) {
          lines.push('', `${mode.label}・第 ${lesson.id} 次講解`);
          if (lesson.question.trim()) lines.push('我的問題：', lesson.question);
          lines.push(
            `講解標題：${lesson.response.title}`,
            'AI 講解：', lesson.response.explanation,
            '', '引用原文：', lesson.response.sourceQuote,
          );
          if (lesson.response.steps?.length) {
            lines.push('', '分步講解：');
            lesson.response.steps.forEach((step, index) => {
              lines.push('', `第 ${index + 1} 步：${step.title}`,
                '本步講解：', step.explanation,
                '本步引用原文：', step.sourceQuote);
              if (step.formula) lines.push('原文公式：', step.formula);
            });
          }
          lines.push('', '自我檢查題：', lesson.response.question);
          if (lesson.attempt.trim()) lines.push('', '我的試答：', lesson.attempt);
          // Downloading must not bypass the same self-check condition as the panel.
          if (lesson.answerVisible && lesson.attempt.trim())
            lines.push('', '參考回答（已展開）：', lesson.response.answer);
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
