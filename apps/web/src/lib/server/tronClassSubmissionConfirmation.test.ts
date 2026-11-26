import { describe, expect, it } from 'vitest';
import {
  mapTronClassSubmissionConfirmation,
  type TronClassConfirmedCandidateReadback,
} from './tronClassSubmissionConfirmation';
import { tronClassFinalCandidateDigest, type TronClassFinalCandidateAttempt } from './tronClassFinalSubmissionCandidate';
import { buildTronClassNewSubmission, parseTronClassSubmissionAcknowledgment } from './tronClassSubmissionProtocol';
import { verifyTronClassSubmissionReadback } from './tronClassSubmissionReadback';

// Synthetic acknowledgments and history only. No session, HTTP or school write.
const OWNER = 'platform:pa_synthetic_student';
const OPERATION = 'operation_123456789';
const CONFIRMED_AT = '2026-11-18T08:00:00.700Z';

function fixture(createdAt: unknown = '2026-11-17T08:00:00Z') {
  const comment = buildTronClassNewSubmission({ activityId: 20, content: '本人 <作業>\n第二行', uploadIds: [40] }).body.comment as string;
  const row = { id: 90, course_id: 10, activity_id: 20, created_by: { id: 30 },
    is_draft: false, is_redo: false, submit_by_instructor: false, is_latest_version: true,
    comment, uploads: [{ id: 40, name: '報告.pdf', size: 12 }], created_at: createdAt };
  const acknowledgment = parseTronClassSubmissionAcknowledgment({ student: { id: 30 }, submission: row },
    { courseId: 10, activityId: 20, studentId: 30, priorSubmissionIds: [] });
  if (acknowledgment.state !== 'acknowledged') throw new Error('invalid synthetic acknowledgment');
  const attempt: TronClassFinalCandidateAttempt = {
    ownerKey: OWNER, operationId: OPERATION, revision: 'a'.repeat(32), courseId: 10, homeworkId: 20,
    studentId: 30, payloadDigest: '', comment, uploads: [{ id: 40, name: '報告.pdf', size: 12 }],
    priorHistoryComplete: true, priorSubmissionIds: [], acknowledgment,
  };
  attempt.payloadDigest = tronClassFinalCandidateDigest(attempt);
  const result = verifyTronClassSubmissionReadback({ list: [row] }, {
    acknowledgment, comment, uploads: attempt.uploads, priorHistoryComplete: true, priorSubmissionIds: [],
  }, Date.parse(CONFIRMED_AT));
  if (result.state !== 'verified-new-version') throw new Error('invalid synthetic readback');
  const readback: TronClassConfirmedCandidateReadback = { ...result, operationId: OPERATION, confirmedAt: CONFIRMED_AT };
  return { attempt, readback };
}

describe('durable attempt to public school-version confirmation', () => {
  it('maps an actual verifier result against the stored acknowledgment without fabricating submittedAt', () => {
    const { attempt, readback } = fixture();
    const before = JSON.stringify({ attempt, readback });
    const result = mapTronClassSubmissionConfirmation(OWNER, attempt, readback);
    expect(result).toEqual({
      status: 'confirmed', operationId: OPERATION, receipt: null,
      confirmation: { kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu',
        operationId: OPERATION, submissionId: 90, courseId: 10, homeworkId: 20,
        confirmedAt: CONFIRMED_AT, sourceRecordedAt: '2026-11-17T08:00:00.000Z' },
    });
    expect(JSON.stringify(result)).not.toMatch(/submittedAt|studentId|ownerKey|revision|payloadDigest|comment|uploads|cookies/);
    expect(JSON.stringify({ attempt, readback })).toBe(before);
  });

  it.each([undefined, null, '', 'bad-time'])('allows verified versions with no usable source record time: %j', createdAt => {
    const { attempt, readback } = fixture(createdAt === undefined ? null : createdAt);
    expect(mapTronClassSubmissionConfirmation(OWNER, attempt, readback).confirmation)
      .toMatchObject({ confirmedAt: CONFIRMED_AT, sourceRecordedAt: null });
  });

  it('requires the authenticated owner and a durable attempt', () => {
    const { attempt, readback } = fixture();
    expect(() => mapTronClassSubmissionConfirmation('platform:another-owner', attempt, readback))
      .toThrowError('TRONCLASS_OPERATION_CONFLICT');
    expect(() => mapTronClassSubmissionConfirmation(OWNER, null, readback)).toThrowError('TRONCLASS_OPERATION_CONFLICT');
  });

  it.each([
    { operationId: 'another_operation_1234' }, { studentId: 31 }, { courseId: 11 }, { homeworkId: 21 },
    { revision: 'b'.repeat(32) }, { payloadDigest: 'b'.repeat(64) }, { comment: 'changed content' },
    { uploads: [{ id: 41, name: '報告.pdf', size: 12 }] },
    { priorHistoryComplete: false }, { priorSubmissionIds: [90] }, { acknowledgment: null },
  ])('refuses altered, incomplete or unacknowledged attempts: %j', change => {
    const { attempt, readback } = fixture();
    expect(() => mapTronClassSubmissionConfirmation(OWNER,
      { ...attempt, ...change } as TronClassFinalCandidateAttempt, readback)).toThrowError('TRONCLASS_OPERATION_CONFLICT');
  });

  it.each([
    { state: 'unconfirmed' }, { submissionId: 91 }, { courseId: 11 }, { activityId: 21 }, { studentId: 31 },
  ])('requires acknowledgment version and scope to match the durable operation: %j', change => {
    const { attempt, readback } = fixture();
    const changed = { ...attempt, acknowledgment: { ...attempt.acknowledgment, ...change } };
    expect(() => mapTronClassSubmissionConfirmation(OWNER,
      changed as TronClassFinalCandidateAttempt, readback)).toThrowError('TRONCLASS_OPERATION_CONFLICT');
  });

  it.each([
    { state: 'awaiting-confirmation' }, { operationId: 'another_operation_1234' },
    { submissionId: 91 }, { courseId: 11 }, { activityId: 21 }, { studentId: 31 },
    { confirmedAt: 'not-a-time' }, { sourceRecordedAt: '2026-11-17 16:00:00' },
  ])('refuses an unmatched, pending or malformed candidate result: %j', change => {
    const { attempt, readback } = fixture();
    expect(() => mapTronClassSubmissionConfirmation(OWNER, attempt,
      { ...readback, ...change } as TronClassConfirmedCandidateReadback)).toThrowError('TRONCLASS_OPERATION_CONFLICT');
  });

  it('does not project unrelated server fields or raw exceptions', () => {
    const { attempt, readback } = fixture();
    const result = mapTronClassSubmissionConfirmation(OWNER, { ...attempt,
      privateData: 'do-not-expose', canSubmit: true } as TronClassFinalCandidateAttempt,
    { ...readback, submittedAt: CONFIRMED_AT } as TronClassConfirmedCandidateReadback);
    expect(JSON.stringify(result)).not.toMatch(/privateData|do-not-expose|canSubmit|submittedAt/);
    expect(() => mapTronClassSubmissionConfirmation(OWNER, { ...attempt,
      get comment(): string { throw new Error('private-upstream-error'); } }, readback))
      .toThrowError('TRONCLASS_OPERATION_CONFLICT');
  });
});
