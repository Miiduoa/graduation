import type { AcademicGrade, AcademicGradeResponse } from './academicRecords';

export type TranscriptScoreKind = 'all' | 'numeric' | 'text' | 'missing';
export type TranscriptSort = 'semester' | 'name' | 'score';
export type TranscriptFilters = {
  semester: string;
  search: string;
  courseType: string;
  scoreKind: TranscriptScoreKind;
  sort: TranscriptSort;
};

function searchable(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, ' ').trim();
}

export function transcriptScoreKind(grade: AcademicGrade): Exclude<TranscriptScoreKind, 'all'> {
  if (typeof grade.score === 'number' && Number.isFinite(grade.score)) return 'numeric';
  return typeof grade.score === 'string' && grade.score.trim() ? 'text' : 'missing';
}

export function selectTranscriptRows(
  grades: readonly AcademicGrade[],
  filters: TranscriptFilters,
): AcademicGrade[] {
  const terms = searchable(filters.search).split(' ').filter(Boolean);
  return grades.filter((grade) => {
    if (filters.semester && grade.semester !== filters.semester) return false;
    if (filters.courseType && grade.courseType !== filters.courseType) return false;
    if (filters.scoreKind !== 'all' && transcriptScoreKind(grade) !== filters.scoreKind) return false;
    const haystack = searchable([
      grade.courseName, grade.courseNameEn, grade.class, grade.courseType, grade.semester,
    ].join(' '));
    return terms.every((term) => haystack.includes(term));
  }).sort((a, b) => {
    const byName = a.courseName.localeCompare(b.courseName, 'zh-TW');
    const bySemester = b.semester.localeCompare(a.semester, undefined, { numeric: true });
    if (filters.sort === 'name') return byName || bySemester || a.id.localeCompare(b.id);
    if (filters.sort === 'score') {
      const aNumeric = typeof a.score === 'number' && Number.isFinite(a.score);
      const bNumeric = typeof b.score === 'number' && Number.isFinite(b.score);
      if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
      if (aNumeric && bNumeric && a.score !== b.score) return (b.score as number) - (a.score as number);
    }
    return bySemester || byName || a.id.localeCompare(b.id);
  });
}

// 文字欄位即使以空白、控制字元或 BOM 開頭，也不得被試算表當成公式執行。
function csvCell(value: string | number): string {
  let text = String(value);
  const significant = text.replace(/^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]+/u, '');
  if (typeof value === 'string' && /^[=+@-]/.test(significant.normalize('NFKC'))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildTranscriptCsv({
  rows,
  fetchedAt,
  coverage,
}: {
  rows: readonly AcademicGrade[];
  fetchedAt: string;
  coverage?: AcademicGradeResponse['coverage'];
}): string {
  const date = new Date(fetchedAt);
  if (!rows.length || !Number.isFinite(date.getTime())) {
    throw new Error('沒有可匯出的成績，或讀取時間無法確認。');
  }
  const scope = coverage?.status === 'partial'
    ? `部分讀取；${coverage.skippedRows} 筆來源資料未能辨識；非正式成績單或畢業審核`
    : '僅本次已讀取的成績，未確認歷年完整性；非正式成績單或畢業審核';
  const header = ['學期', '科目名稱', '英文名稱', '班級', '修別', '學分', '成績', '來源', '讀取時間', '資料範圍'];
  const lines: (string | number)[][] = [header, ...rows.map((grade) => [
    grade.semester, grade.courseName, grade.courseNameEn, grade.class, grade.courseType,
    grade.credits, grade.score, '靜宜 e 校園', date.toISOString(), scope,
  ])];
  return '\uFEFF' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
