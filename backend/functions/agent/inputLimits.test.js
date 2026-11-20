'use strict';

const {
  MAX_ARRAY_ITEMS,
  MAX_OBJECT_KEYS,
  MAX_DEPTH,
  MAX_TOTAL_NODES,
  MAX_TOTAL_UTF8_BYTES,
  assertToolInputBounds,
} = require('./inputLimits');

function expectLimit(fn) {
  try {
    fn();
    throw new Error('expected resource-exhausted');
  } catch (error) {
    expect(error).toMatchObject({ code: 'resource-exhausted' });
    expect(String(error.message).length).toBeLessThan(200);
  }
}

function expectInvalid(fn) {
  try {
    fn();
    throw new Error('expected invalid-argument');
  } catch (error) {
    expect(error).toMatchObject({ code: 'invalid-argument' });
    expect(String(error.message).length).toBeLessThan(200);
  }
}

describe('assertToolInputBounds', () => {
  test('allows normal quiz answers and optional undefined', () => {
    expect(() =>
      assertToolInputBounds({
        quizId: 'q1',
        courseSpaceId: 'c1',
        answers: [
          { questionId: 'a', value: 'x' },
          { questionId: 'b', value: ['1', '2'] },
        ],
        submittedBy: undefined,
      }),
    ).not.toThrow();
  });

  test('allows food-draft shaped proposeOrder input', () => {
    expect(() =>
      assertToolInputBounds({
        cafeteriaId: 'cafe',
        items: [{ menuItemId: 'rice', quantity: 1, note: '少飯' }],
        paymentMethod: 'campus_card',
      }),
    ).not.toThrow();
  });

  test('allows null-prototype records', () => {
    const input = Object.assign(Object.create(null), {
      quizId: 'q1',
      courseSpaceId: 'c1',
      answers: [],
    });
    expect(() => assertToolInputBounds(input)).not.toThrow();
  });

  test('allows 500 question-bank-shaped records with 4 options each', () => {
    const entries = Array.from({ length: 500 }, (_, index) => ({
      id: `q${index}`,
      type: 'single_choice',
      prompt: `題目 ${index}`,
      options: [
        { id: 'a', label: 'A', value: 'a' },
        { id: 'b', label: 'B', value: 'b' },
        { id: 'c', label: 'C', value: 'c' },
        { id: 'd', label: 'D', value: 'd' },
      ],
    }));
    expect(() =>
      assertToolInputBounds({
        bankId: 'bank1',
        schoolId: 'pu',
        title: '期中題庫',
        entries,
      }),
    ).not.toThrow();
  });

  test('rejects oversized arrays before walking children', () => {
    let childReads = 0;
    const answers = Array.from({ length: MAX_ARRAY_ITEMS + 1 }, (_, index) => ({
      get questionId() {
        childReads += 1;
        return String(index);
      },
      value: 'x',
    }));
    expectLimit(() =>
      assertToolInputBounds({
        quizId: 'q',
        courseSpaceId: 'c',
        answers,
      }),
    );
    expect(childReads).toBe(0);
  });

  test('rejects oversized object key counts', () => {
    const input = {};
    for (let i = 0; i < MAX_OBJECT_KEYS + 1; i += 1) {
      input[`k${i}`] = 1;
    }
    expectLimit(() => assertToolInputBounds(input));
  });

  test('rejects excessive depth', () => {
    let nested = { leaf: true };
    for (let i = 0; i < MAX_DEPTH; i += 1) {
      nested = { child: nested };
    }
    expectLimit(() => assertToolInputBounds(nested));
  });

  test('rejects excessive total nodes', () => {
    const items = Array.from({ length: MAX_ARRAY_ITEMS }, () =>
      Array.from({ length: 100 }, () => 1),
    );
    expectLimit(() => assertToolInputBounds({ items }));
    // Sanity: this shape exceeds MAX_TOTAL_NODES when walked.
    expect(1 + 1 + MAX_ARRAY_ITEMS + MAX_ARRAY_ITEMS * 100).toBeGreaterThan(MAX_TOTAL_NODES);
  });

  test('rejects excessive UTF-8 budget without JSON.stringify of attacker payload', () => {
    const huge = '中'.repeat(Math.ceil(MAX_TOTAL_UTF8_BYTES / 3) + 8);
    expectLimit(() => assertToolInputBounds({ payload: huge }));
  });

  test('rejects cycles, accessors, and unsupported types', () => {
    const cyclic = { quizId: 'q', courseSpaceId: 'c', answers: [] };
    cyclic.self = cyclic;
    expectInvalid(() => assertToolInputBounds(cyclic));

    const withGetter = {
      quizId: 'q',
      courseSpaceId: 'c',
      get answers() {
        return [];
      },
    };
    expectInvalid(() => assertToolInputBounds(withGetter));

    expectInvalid(() => assertToolInputBounds({ when: new Date() }));
    expectInvalid(() => assertToolInputBounds({ tags: new Set(['a']) }));
    expectInvalid(() => assertToolInputBounds({ map: new Map() }));
    expectInvalid(() => assertToolInputBounds({ fn: () => 1 }));
    expectInvalid(() => assertToolInputBounds({ n: 1n }));
    expectInvalid(() => assertToolInputBounds([]));
  });
});
