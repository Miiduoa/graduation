type SchoolSearchFields = { id?: string; name: string; shortName?: string; code?: string };

export function normalizeSchoolQuery(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/臺/g, '台').trim();
}

function withoutWhitespace(value: string) {
  return normalizeSchoolQuery(value).replace(/\s+/g, '');
}

export function filterSchools<T extends SchoolSearchFields>(schools: readonly T[], query: string): T[] {
  const needle = withoutWhitespace(query);
  const terms = normalizeSchoolQuery(query).split(/\s+/).filter(Boolean);
  const exact: T[] = [];
  const partial: T[] = [];
  for (const school of schools) {
    const fields = [school.name, school.shortName, school.code, school.id]
      .filter((field): field is string => Boolean(field))
      .map(withoutWhitespace);
    const exactCode = needle && [school.code, school.id].some(
      (code) => code && withoutWhitespace(code) === needle,
    );
    if (exactCode) exact.push(school);
    else if (fields.some((field) => field.includes(needle)) ||
      terms.every((term) => fields.some((field) => field.includes(term)))) {
      partial.push(school);
    }
  }
  return [...exact, ...partial];
}
