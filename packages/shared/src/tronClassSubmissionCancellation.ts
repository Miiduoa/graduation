/** Stops only nuni preparation before its durable final claim. Never retracts school work. */
export type TronClassPreparationCancellation = {
  status: 'cancelled' | 'unknown';
  operationId: string;
  courseId: number;
  homeworkId: number;
};

export type TronClassPreparationCancellationScope = {
  operationId: string;
  courseId: number;
  homeworkId: number;
};

/** Validate this distinct response without treating it as a submission receipt. */
export function decodeTronClassPreparationCancellation(
  value: unknown,
  expected: TronClassPreparationCancellationScope,
): TronClassPreparationCancellation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = ['status', 'operationId', 'courseId', 'homeworkId'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key)) ||
    (row.status !== 'cancelled' && row.status !== 'unknown') ||
    typeof row.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(row.operationId) ||
    typeof row.courseId !== 'number' || !Number.isSafeInteger(row.courseId) || row.courseId <= 0 ||
    typeof row.homeworkId !== 'number' || !Number.isSafeInteger(row.homeworkId) || row.homeworkId <= 0 ||
    row.operationId !== expected.operationId || row.courseId !== expected.courseId || row.homeworkId !== expected.homeworkId) return null;
  return { status: row.status, operationId: row.operationId, courseId: row.courseId, homeworkId: row.homeworkId };
}
