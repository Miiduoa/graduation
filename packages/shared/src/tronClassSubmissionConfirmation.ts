/**
 * Proof of one acknowledged school version matched by authenticated readback.
 * This is separate from a legacy submitted-at receipt and grants no write authority.
 */
export type TronClassAcknowledgedReadbackConfirmation = {
  kind: 'acknowledged-readback';
  source: 'tronclass';
  schoolId: 'pu';
  operationId: string;
  submissionId: number;
  courseId: number;
  homeworkId: number;
  /** When nuni finished matching this operation's acknowledged version. */
  confirmedAt: string;
  /** The school's record time, never a final-submission timestamp. */
  sourceRecordedAt: string | null;
};

export type TronClassAcknowledgedReadbackResult = {
  status: 'confirmed';
  operationId: string;
  receipt: null;
  confirmation: TronClassAcknowledgedReadbackConfirmation;
};

export type TronClassConfirmationExpectation = {
  operationId?: string;
  courseId?: number;
  homeworkId?: number;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const operationId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value);
const instant = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

/** A wire-shape check, not proof that a school readback took place. */
export function isTronClassAcknowledgedReadbackResult(
  value: unknown,
  expected: TronClassConfirmationExpectation = {},
): value is TronClassAcknowledgedReadbackResult {
  try {
    if (!object(value) || !exactKeys(value, ['status', 'operationId', 'receipt', 'confirmation']) ||
      value.status !== 'confirmed' || !operationId(value.operationId) || value.receipt !== null ||
      (expected.operationId !== undefined && value.operationId !== expected.operationId)) return false;
    const confirmation = value.confirmation;
    return object(confirmation) && exactKeys(confirmation, [
      'kind', 'source', 'schoolId', 'operationId', 'submissionId', 'courseId', 'homeworkId',
      'confirmedAt', 'sourceRecordedAt',
    ]) && confirmation.kind === 'acknowledged-readback' && confirmation.source === 'tronclass' &&
      confirmation.schoolId === 'pu' && confirmation.operationId === value.operationId &&
      id(confirmation.submissionId) && id(confirmation.courseId) && id(confirmation.homeworkId) &&
      (expected.courseId === undefined || confirmation.courseId === expected.courseId) &&
      (expected.homeworkId === undefined || confirmation.homeworkId === expected.homeworkId) &&
      instant(confirmation.confirmedAt) &&
      (confirmation.sourceRecordedAt === null || instant(confirmation.sourceRecordedAt));
  } catch {
    return false;
  }
}

/** Copy only this public variant; never carry private server fields to a client. */
export function decodeTronClassAcknowledgedReadbackResult(
  value: unknown,
  expected: TronClassConfirmationExpectation = {},
): TronClassAcknowledgedReadbackResult | null {
  try {
    if (!isTronClassAcknowledgedReadbackResult(value, expected)) return null;
    const confirmation = value.confirmation;
    return {
      status: 'confirmed', operationId: value.operationId, receipt: null,
      confirmation: {
        kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu',
        operationId: confirmation.operationId, submissionId: confirmation.submissionId,
        courseId: confirmation.courseId, homeworkId: confirmation.homeworkId,
        confirmedAt: confirmation.confirmedAt, sourceRecordedAt: confirmation.sourceRecordedAt,
      },
    };
  } catch {
    return null;
  }
}
