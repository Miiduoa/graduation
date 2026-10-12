type SchoolSearchFields = { name: string; shortName?: string; code?: string };

export function normalizeSchoolQuery(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/臺/g, '台').trim();
}

export function filterSchools<T extends SchoolSearchFields>(schools: readonly T[], query: string): T[] {
  const terms = normalizeSchoolQuery(query).split(/\s+/).filter(Boolean);
  return schools.filter((school) => {
    const fields = normalizeSchoolQuery([school.name, school.shortName, school.code].filter(Boolean).join(' '));
    return terms.every((term) => fields.includes(term));
  });
}
