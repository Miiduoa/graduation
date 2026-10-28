import type { AcademicGrade } from './academicRecords';

export type TranscriptReviewReason = 'missing' | 'unrecognized' | 'invalid';

// 只判斷資料是否需要核對，不決定及格門檻、重修採計或畢業資格。
export function transcriptReviewReason(score: unknown): TranscriptReviewReason | null {
  if (typeof score === 'number') {
    return Number.isFinite(score) && score >= 0 && score <= 100 ? null : 'invalid';
  }
  if (typeof score !== 'string') return 'invalid';
  const text = score.trim();
  if (!text) return 'missing';
  if (/^-(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return 'invalid';
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? null : 'invalid';
  }
  if (/^(?:pass|通過)(?:\(pass\))?$/i.test(text) || /^(?:fail|未通過|不及格)$/i.test(text)) return null;
  // SAT、抵免、等第及其他代碼保留原文；沒有來源規則時不猜測含義。
  return 'unrecognized';
}

export function transcriptReviewLabel(reason: TranscriptReviewReason): string {
  if (reason === 'missing') return '成績尚未提供';
  if (reason === 'invalid') return '數值或格式需核對';
  return '文字結果需核對';
}

export function summarizeTranscriptReview(grades: readonly AcademicGrade[]) {
  const counts: Record<TranscriptReviewReason, number> = { missing: 0, unrecognized: 0, invalid: 0 };
  let count = 0;
  let affectedCredits: number | null = 0;
  for (const grade of grades) {
    const reason = transcriptReviewReason(grade.score);
    if (reason === null) continue;
    counts[reason] += 1;
    count += 1;
    if (typeof grade.credits !== 'number' || !Number.isFinite(grade.credits) || grade.credits < 0) {
      affectedCredits = null;
    } else if (affectedCredits !== null) {
      const next: number = affectedCredits + grade.credits;
      affectedCredits = Number.isFinite(next) ? next : null;
    }
  }
  return { count, counts, affectedCredits };
}
