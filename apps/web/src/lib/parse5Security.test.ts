import { expect, it } from 'vitest';
import { parse, serialize } from 'parse5';

it('keeps parsing malformed surrogate pairs without throwing', () => {
  const input = '<a\uDC00\uDC00\uD83D\uDE00\uDFFF>';
  expect(() => parse(input)).not.toThrow();
});

it('does not let an SVG select element corrupt HTML table parsing', () => {
  const input = '<table><td><svg><select><desc><table></table><td>x';
  expect(serialize(parse(input))).toContain('<td>x</td>');
});
