import { describe, expect, it } from 'vitest';
import { decodeTronClassPreparationCancellation } from '@campus/shared/src/tronClassSubmissionCancellation';

const scope = { operationId: 'cancellation_fixture_01', courseId: 101, homeworkId: 202 };
const stopped = { status: 'cancelled' as const, ...scope };

describe('preparation cancellation response boundary', () => {
  it.each(['cancelled', 'unknown'])('preserves the separate %s verdict and creates a public copy', status => {
    const input = { ...stopped, status };
    const result = decodeTronClassPreparationCancellation(input, scope);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result).not.toHaveProperty('receipt');
  });

  it.each([
    null, [], {}, { ...stopped, status: ['cancelled'] }, { ...stopped, status: 'submitted' },
    { ...stopped, receipt: null }, { ...stopped, ownerKey: 'firebase:secret' },
    { ...stopped, operationId: 'other_cancellation_01' }, { ...stopped, courseId: 999 },
    { ...stopped, homeworkId: 999 }, { ...stopped, courseId: '101' },
    { ...stopped, homeworkId: 1.5 }, { ...stopped, operationId: 'short' },
  ])('does not unlock editing for malformed or mismatched verdicts: %j', value => {
    expect(decodeTronClassPreparationCancellation(value, scope)).toBeNull();
  });
});
