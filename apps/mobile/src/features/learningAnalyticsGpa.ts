import { isProvidenceSchoolId } from '../data/schoolIds';
import {
  convertPuPercentScoreToGradePoint,
  PU_GRADE_POINT_POLICY,
} from '../data/apiAdapters/puGradePointPolicy';

/** 靜宜逐科換算 4.3 績點；其他學校維持原有百分制加權後除以 25。 */
export function calculateLearningAnalyticsGpa(
  grades: ReadonlyArray<{ grade?: unknown; credits: number; semester: string }>,
  schoolId: string,
) {
  if (!isProvidenceSchoolId(schoolId)) {
    // 保留原有篩選、計算順序及上限行為（學期 GPA 不設上限）。
    const graded = grades.filter((grade) => grade.grade != null && grade.credits > 0);
    if (graded.length === 0) return null;
    const average = (rows: typeof graded) =>
      rows.reduce((sum, row) => sum + (row.grade as number) * row.credits, 0) /
      rows.reduce((sum, row) => sum + row.credits, 0) /
      25;
    return {
      overall: Math.min(average(graded), 4.0),
      semesters: [...new Set(graded.map((grade) => grade.semester))].sort().map((sem) => ({
        sem,
        gpa: average(graded.filter((grade) => grade.semester === sem)),
      })),
    };
  }

  const graded = grades.flatMap((grade) => {
    const points =
      typeof grade.grade === 'number' ? convertPuPercentScoreToGradePoint(grade.grade) : null;
    if (points === null || !Number.isFinite(grade.credits) || grade.credits <= 0) return [];
    return [{ ...grade, points }];
  });
  if (graded.length === 0) return null;

  const average = (rows: typeof graded) =>
    Math.min(
      rows.reduce((sum, row) => sum + row.points * row.credits, 0) /
        rows.reduce((sum, row) => sum + row.credits, 0),
      PU_GRADE_POINT_POLICY.gradePointScale,
    );
  return {
    overall: average(graded),
    semesters: [...new Set(graded.map((grade) => grade.semester))].sort().map((sem) => ({
      sem,
      gpa: average(graded.filter((grade) => grade.semester === sem)),
    })),
  };
}
