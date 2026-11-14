import {
  convertPuPercentScoreToGradePoint,
  PU_GRADE_POINT_POLICY,
} from '../data/apiAdapters/puGradePointPolicy';

/** 依《成績試算-規格-v1.md》第 2 節，所有學校一律逐科使用靜宜 4.3 制後加權。 */
export function calculateLearningAnalyticsGpa(
  grades: ReadonlyArray<{ grade?: unknown; credits: number; semester: string }>,
  _schoolId: string,
) {
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
