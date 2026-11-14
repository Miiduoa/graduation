import {
  convertPuPercentScoreToGradePoint,
  PU_GRADE_POINT_POLICY,
} from '../data/apiAdapters/puGradePointPolicy';

/** 逐科換算後依學分加權；文字成績只保留在原始學分紀錄，不納入平均。 */
export function calculateLearningAnalyticsGpa(
  grades: ReadonlyArray<{ grade?: unknown; credits: number; semester: string }>,
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
