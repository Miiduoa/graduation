import { schoolTimetableTermLabel } from '../../services/schoolTimetableTermLabel';

describe('school timetable term labels', () => {
  test.each([
    ['115|1', '115 學年度 · 第 1 學期'],
    ['115|2', '115 學年度 · 第 2 學期'],
    ['115|3', '115 學年度 · 第 3 學期'],
    ['99|1', '99 學年度 · 第 1 學期'],
    ['0115|1', '0115 學年度 · 第 1 學期'],
  ])('formats the complete canonical key %s without altering its year', (key, label) => {
    expect(schoolTimetableTermLabel(key, '原始學期')).toBe(label);
  });

  test.each([
    null, '', '|', '115|1|2', '115||1', '115|1|', '|115|1',
    '115|0', '115|4', '1|1', '12345|1', '115|11',
    '115|1\n', '115|1\r\n', '115|1 trailing', 'prefix 115|1',
  ])('does not format an incomplete or ambiguous key: %j', (key) => {
    expect(schoolTimetableTermLabel(key, '來源待核對')).toBe('來源學期：來源待核對');
  });

  test('preserves unknown source text as text instead of guessing a semester', () => {
    expect(schoolTimetableTermLabel('115|1|2', '115|1|2')).toBe('來源學期：115|1|2');
  });
  test.each([null, ''])('reports a missing source without inventing a term: %j', (source) => {
    expect(schoolTimetableTermLabel(null, source)).toBe('來源學期：未提供');
  });
});
