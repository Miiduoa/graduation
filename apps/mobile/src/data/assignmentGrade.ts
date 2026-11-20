import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';

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
  let publishedAt: number | null = null;
  try {
    const value = row.gradePublishedAt;
    const source = value && typeof value === 'object' && 'toDate' in value
      && typeof value.toDate === 'function' ? value.toDate() : value;
    if (typeof source === 'string' || source instanceof Date) {
      publishedAt = parseTaipeiInstant(source);
    }
  } catch {
    publishedAt = null;
  }
  return {
    score: row.gradeScore,
    feedback: typeof row.gradeFeedback === 'string' ? row.gradeFeedback : '',
    publishedAt: publishedAt === null ? null : new Date(publishedAt).toISOString(),
    revisionCount:
      Number.isInteger(row.gradeRevisionCount) && (row.gradeRevisionCount as number) >= 0
        ? (row.gradeRevisionCount as number)
        : 0,
  };
}
