export type PublishedAssignmentGrade = {
  score: number;
  feedback: string;
  publishedAt: string | null;
  revisionCount: number;
};

export function publishedAssignmentGrade(
  row: Record<string, unknown> | null | undefined,
): PublishedAssignmentGrade | null {
  if (!row || row.gradePublished !== true) return null;
  if (typeof row.gradeScore !== 'number' || !Number.isFinite(row.gradeScore)) return null;
  return {
    score: row.gradeScore,
    feedback: typeof row.gradeFeedback === 'string' ? row.gradeFeedback : '',
    publishedAt: typeof row.gradePublishedAt === 'string' ? row.gradePublishedAt : null,
    revisionCount:
      Number.isInteger(row.gradeRevisionCount) && (row.gradeRevisionCount as number) >= 0
        ? (row.gradeRevisionCount as number)
        : 0,
  };
}
