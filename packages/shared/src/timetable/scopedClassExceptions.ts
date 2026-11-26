import { courseScope } from '../courseAccess';
import type { ClassException, PersonalImportRecord } from '../imports/types';
import { matchesClassException } from './classExceptions';

function comparisonRecord(row: PersonalImportRecord, schoolId: string): PersonalImportRecord {
  const scoped = row.schoolId === schoolId ? row : { ...row, schoolId };
  try {
    const { academicYear, semester } = courseScope(scoped);
    return { ...scoped, academicYear, semester };
  } catch {
    return scoped;
  }
}

/** Match equivalent term labels without changing the original exception or its persisted course key. */
export function withScopedClassExceptions(
  rows: readonly PersonalImportRecord[],
  exceptions: readonly ClassException[] | undefined,
  schoolId: string,
  sameSchool: (source: string, selected: string) => boolean = (source, selected) => source === selected,
): PersonalImportRecord[] {
  const comparisons = exceptions?.filter(item => sameSchool(item.original.schoolId, schoolId))
    .map(item => ({ item, original: comparisonRecord(item.original, schoolId) }));
  return rows.filter(row => sameSchool(row.schoolId, schoolId)).map(row => {
    const scoped = row.schoolId === schoolId ? row : { ...row, schoolId };
    if (row.kind !== 'timetable' || !comparisons) return scoped;
    const meeting = comparisonRecord(scoped, schoolId);
    return { ...scoped, classExceptions: comparisons
      .filter(({ original }) => matchesClassException(meeting, original))
      .map(({ item }) => item) };
  });
}
