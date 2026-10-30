import { describe, expect, it } from 'vitest';
import { normalizePuCreditOverview, PU_CREDIT_OVERVIEW_FIELDS } from '@campus/shared/src/puCreditOverview';

function sample() {
  return {
    version: 1, source: 'pu-credit-review',
    totals: { required: 51.5, elective: 17.5, externalElective: 3, generalOld: 0, generalNew: 12, subtotal: 84, totalRequired: 128, minorDouble: 0 },
    coverage: { status: 'complete', missingFields: [] },
  };
}

it('preserves school-reported decimal values and explicit zero without summing overlapping categories', () => {
  expect(normalizePuCreditOverview({ ...sample(), cookies: 'private', totalEarned: 999 }))
    .toEqual(sample());
});

it('keeps unavailable fields null and normalizes their coverage in a stable order', () => {
  const input = sample();
  const result = normalizePuCreditOverview({ ...input,
    totals: { ...input.totals, subtotal: null, totalRequired: null },
    coverage: { status: 'partial', missingFields: ['totalRequired', 'subtotal'] },
  });
  expect(result?.totals.subtotal).toBeNull();
  expect(result?.coverage.missingFields).toEqual(['subtotal', 'totalRequired']);
});

describe('rejects misleading or incomplete source contracts', () => {
  it.each(['12', undefined, Number.NaN, Infinity, -1, 1001])('rejects invalid credit amount %s', (amount) => {
    expect(normalizePuCreditOverview({ ...sample(), totals: { ...sample().totals, required: amount } })).toBeNull();
  });
  it.each([
    { source: 'derived-from-grade-rows' }, { version: 2 },
    { coverage: { status: 'partial', missingFields: [] } },
    { coverage: { status: 'complete', missingFields: ['subtotal'] } },
  ])('rejects wrong provenance or contradictory coverage %j', (change) => {
    expect(normalizePuCreditOverview({ ...sample(), ...change })).toBeNull();
  });
  it('rejects all-null records and duplicate missing fields', () => {
    expect(normalizePuCreditOverview({ ...sample(), totals: Object.fromEntries(PU_CREDIT_OVERVIEW_FIELDS.map((f) => [f, null])),
      coverage: { status: 'partial', missingFields: [...PU_CREDIT_OVERVIEW_FIELDS] } })).toBeNull();
    expect(normalizePuCreditOverview({ ...sample(), totals: { ...sample().totals, subtotal: null, required: null },
      coverage: { status: 'partial', missingFields: ['subtotal', 'subtotal'] } })).toBeNull();
  });
});
