import {
  buildCatalogSemesters,
  getCurrentCatalogSemester,
  getDefaultCatalogFilter,
} from '../data/courseCatalogConstants';

test.each([
  ['2026-10-25T02:00:00Z', '1151'],
  ['2026-12-31T16:00:00Z', '1151'],
  ['2027-01-31T15:59:59Z', '1151'],
  ['2027-01-31T16:00:00Z', '1152'],
  ['2027-07-31T15:59:59Z', '1152'],
  ['2027-07-31T16:00:00Z', '1161'],
])('chooses the current semester at Taipei calendar boundary %s', (instant, expected) => {
  const date = new Date(instant);
  expect(getCurrentCatalogSemester(date).code).toBe(expected);
  expect(getDefaultCatalogFilter(date).semester).toBe(expected);
});

test('semester options include the current year, summer study and historical choices', () => {
  const options = buildCatalogSemesters(new Date('2026-10-25T02:00:00Z'));
  expect(options.map((option) => option.code)).toEqual(
    expect.arrayContaining(['1151', '1152', '1153', '1154', '1142', '981', '982', '983', '984']),
  );
  expect(new Set(options.map((option) => option.code)).size).toBe(options.length);
  expect(options.find((option) => option.code === '1151')?.label).toBe('115-1學期');
});

test('the next academic year can be selected during second-semester preregistration', () => {
  const date = new Date('2027-06-01T00:00:00+08:00');
  expect(buildCatalogSemesters(date).some((option) => option.code === '1161')).toBe(true);
  expect(getDefaultCatalogFilter(date).semester).toBe('1152');
});

test('defaults update without reloading the module after the semester changes', () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date('2027-01-31T15:59:59Z'));
    expect(getDefaultCatalogFilter().semester).toBe('1151');
    jest.setSystemTime(new Date('2027-01-31T16:00:00Z'));
    expect(getDefaultCatalogFilter().semester).toBe('1152');
  } finally {
    jest.useRealTimers();
  }
});
