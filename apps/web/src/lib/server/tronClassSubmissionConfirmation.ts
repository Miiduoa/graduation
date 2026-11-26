import { NuniError } from '@campus/shared/src/nuni';
import {
  decodeTronClassAcknowledgedReadbackResult,
  type TronClassAcknowledgedReadbackResult,
} from '@campus/shared/src/tronClassSubmissionConfirmation';
import {
  tronClassFinalCandidateDigest,
  type TronClassFinalCandidateAttempt,
} from './tronClassFinalSubmissionCandidate';
import { buildTronClassUploadMetadata } from './tronClassSubmissionProtocol';
import type { TronClassSubmissionReadback } from './tronClassSubmissionReadback';

export type TronClassConfirmedCandidateReadback = Extract<
  TronClassSubmissionReadback, { state: 'verified-new-version' }
> & { operationId: string; confirmedAt: string };

const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const conflict = (): never => { throw new NuniError(409, 'TRONCLASS_OPERATION_CONFLICT'); };

/**
 * Server-only projection after the current binding and authenticated readback
 * have been checked. The attempt must come from the durable v2 journal; the
 * readback must come from the acknowledged-version verifier. Neither accepts an HTTP body.
 * Scope and version are recovered from that attempt's stored acknowledgment.
 * This mapper does not alter v1 receipt freshness, journal locks or write grants.
 */
export function mapTronClassSubmissionConfirmation(
  ownerKey: string,
  attempt: TronClassFinalCandidateAttempt | null,
  readback: TronClassConfirmedCandidateReadback,
): TronClassAcknowledgedReadbackResult {
  try {
    if (typeof ownerKey !== 'string' || !ownerKey || ownerKey.length > 300 ||
      !attempt || attempt.ownerKey !== ownerKey ||
      typeof attempt.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(attempt.operationId) ||
      typeof attempt.revision !== 'string' || !/^[a-f0-9]{32}$/.test(attempt.revision) ||
      !id(attempt.studentId) || !id(attempt.courseId) || !id(attempt.homeworkId) ||
      attempt.priorHistoryComplete !== true || !Array.isArray(attempt.priorSubmissionIds) ||
      attempt.priorSubmissionIds.length !== 0 ||
      typeof attempt.comment !== 'string' || attempt.comment.length > 120_000 ||
      !Array.isArray(attempt.uploads) || attempt.uploads.length > 4 ||
      !Array.from(attempt.uploads).every(file => !!file && id(file.id)) ||
      new Set(attempt.uploads.map(file => file.id)).size !== attempt.uploads.length ||
      (!attempt.comment.trim() && attempt.uploads.length === 0) ||
      typeof attempt.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(attempt.payloadDigest)) return conflict();
    for (const file of attempt.uploads) buildTronClassUploadMetadata({ name: file.name, size: file.size });
    if (tronClassFinalCandidateDigest(attempt) !== attempt.payloadDigest) return conflict();
    const ack = attempt.acknowledgment;
    if (!ack || ack.state !== 'acknowledged' || !id(ack.submissionId) ||
      ack.courseId !== attempt.courseId || ack.activityId !== attempt.homeworkId || ack.studentId !== attempt.studentId ||
      !readback || readback.state !== 'verified-new-version' ||
      readback.operationId !== attempt.operationId || readback.submissionId !== ack.submissionId ||
      readback.courseId !== attempt.courseId || readback.activityId !== attempt.homeworkId ||
      readback.studentId !== attempt.studentId) return conflict();
    const result = decodeTronClassAcknowledgedReadbackResult({
      status: 'confirmed', operationId: attempt.operationId, receipt: null,
      confirmation: {
        kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu',
        operationId: attempt.operationId, submissionId: ack.submissionId,
        courseId: attempt.courseId, homeworkId: attempt.homeworkId,
        confirmedAt: readback.confirmedAt, sourceRecordedAt: readback.sourceRecordedAt,
      },
    });
    if (!result) return conflict();
    return result;
  } catch {
    // Never expose raw attempts, private content or an upstream exception.
    return conflict();
  }
}
