import type { AcademicGradeResponse } from './academicRecords';

export interface TranscriptSemesterCoverage {
  semester: string;
  rowCount: number;
  missingScoreCount: number;
}

/** Only source-mentioned semesters; no guessed enrollment period or completion claim. */
export function transcriptSemesterCoverage(records: AcademicGradeResponse): TranscriptSemesterCoverage[] {
  const semesters = new Map<string, TranscriptSemesterCoverage>();
  const include = (semester: string) => {
    if (!semester.trim()) return;
    if (!semesters.has(semester)) semesters.set(semester, { semester, rowCount: 0, missingScoreCount: 0 });
  };
  [...records.semesters, ...records.allSemesters, ...Object.keys(records.summary)].forEach(include);
  for (const grade of records.grades) {
    include(grade.semester);
    const entry = semesters.get(grade.semester);
    if (!entry) continue;
    entry.rowCount += 1;
    if (typeof grade.score === 'string' && !grade.score.trim()) entry.missingScoreCount += 1;
  }
  return [...semesters.values()].sort((a, b) => b.semester.localeCompare(a.semester, 'zh-TW', { numeric: true }));
}
