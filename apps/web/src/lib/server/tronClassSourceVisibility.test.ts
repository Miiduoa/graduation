// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';

describe('TronClass source visibility boundary', () => {
  it.each([
    {},
    { is_hidden: false, hidden: 0, published: true },
    { is_hidden: 0, hidden: false, published: 1 },
    { is_closed: true, submitted: true },
  ])('keeps older responses and visible completed work available: %j', (row) => {
    expect(isTronClassSourceVisible(row)).toBe(true);
  });

  it.each([
    { hidden: true, published: true },
    { is_hidden: 1, hidden: false, published: 1 },
    { is_hidden: false, hidden: 1 },
    { is_hidden: 0, published: false },
    { published: 0 },
    { hidden: 'false' },
    { is_hidden: '0' },
    { published: 'true' },
    { published: null },
    { is_hidden: 2 },
    null,
    [],
  ])('does not let contradictory or unrecognised visibility grant access: %j', (row) => {
    expect(isTronClassSourceVisible(row)).toBe(false);
  });
});
