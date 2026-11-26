import { describe, expect, it } from 'vitest';
import {
  decodeTronClassAcknowledgedReadbackResult,
  isTronClassAcknowledgedReadbackResult,
  type TronClassAcknowledgedReadbackResult,
} from '@campus/shared/src/tronClassSubmissionConfirmation';

const result: TronClassAcknowledgedReadbackResult = {
  status: 'confirmed', operationId: 'operation_123456789', receipt: null,
  confirmation: {
    kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu',
    operationId: 'operation_123456789', submissionId: 90, courseId: 10, homeworkId: 20,
    confirmedAt: '2026-11-18T08:00:00.700Z', sourceRecordedAt: '2026-11-17T08:00:00.000Z',
  },
};

describe('shared acknowledged readback wire contract', () => {
  it('preserves separate system confirmation and older source record time without creating a submitted-at receipt', () => {
    const decoded = decodeTronClassAcknowledgedReadbackResult(result,
      { operationId: result.operationId, courseId: 10, homeworkId: 20 });
    expect(decoded).toEqual(result);
    expect(decoded).not.toBe(result);
    expect(decoded?.confirmation).not.toBe(result.confirmation);
    expect(decoded?.receipt).toBeNull();
    expect(decoded?.confirmation).not.toHaveProperty('submittedAt');
    expect(decoded?.confirmation).not.toHaveProperty('canSubmit');
    expect(isTronClassAcknowledgedReadbackResult({ ...result,
      confirmation: { ...result.confirmation, sourceRecordedAt: null } })).toBe(true);
  });

  it.each([
    { operationId: 'another_operation_1234' }, { courseId: 11 }, { homeworkId: 21 },
  ])('rejects a result outside the expected operation or homework: %j', expected => {
    expect(isTronClassAcknowledgedReadbackResult(result, expected)).toBe(false);
    expect(decodeTronClassAcknowledgedReadbackResult(result, expected)).toBeNull();
  });

  it.each([
    null, [], {},
    { ...result, status: ['confirmed'] },
    { ...result, status: 'submitted' },
    { ...result, operationId: 'short' },
    { ...result, operationId: 'another_operation_1234' },
    { ...result, receipt: { status: 'submitted' } },
    { ...result, submittedAt: '2026-11-18T08:00:00.700Z' },
    { ...result, canSubmit: true },
  ])('rejects mixed, unprojected or malformed envelopes: %j', value => {
    expect(isTronClassAcknowledgedReadbackResult(value)).toBe(false);
    expect(decodeTronClassAcknowledgedReadbackResult(value)).toBeNull();
  });

  it.each([
    { kind: ['acknowledged-readback'] }, { kind: 'history' }, { schoolId: 'other' }, { source: 'nuni' },
    { operationId: 'another_operation_1234' }, { submissionId: '90' }, { submissionId: 0 },
    { submissionId: Number.MAX_SAFE_INTEGER + 1 }, { courseId: -1 }, { homeworkId: 2.5 },
    { confirmedAt: null }, { confirmedAt: '2026-11-18T08:00:00Z' }, { confirmedAt: '2026-02-30T08:00:00.000Z' },
    { confirmedAt: '2026-11-18T16:00:00.700+08:00' }, { confirmedAt: ['2026-11-18T08:00:00.700Z'] },
    { sourceRecordedAt: undefined }, { sourceRecordedAt: '' }, { sourceRecordedAt: 1794902400000 },
    { submittedAt: '2026-11-18T08:00:00.700Z' }, { studentId: 303 }, { ownerKey: 'private-owner' },
    { content: 'private-content' }, { attachments: [] }, { permissions: { submit: true } },
  ])('rejects malformed or private confirmation fields: %j', change => {
    expect(decodeTronClassAcknowledgedReadbackResult({ ...result,
      confirmation: { ...result.confirmation, ...change } })).toBeNull();
  });

  it('does not expose raw getter exceptions', () => {
    expect(decodeTronClassAcknowledgedReadbackResult({ ...result,
      get confirmation() { throw new Error('private-upstream-error'); } })).toBeNull();
  });
});
