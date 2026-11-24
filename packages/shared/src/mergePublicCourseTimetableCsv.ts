import type { PublicCatalogCourse, PublicCourseCatalogResponse } from './publicCourseCatalog';
import { normalizePersonalImportText } from './imports/validation';
import { ncnuTimetableImportCsv } from './ncnuCourseSchedule';
import { nthuTimetableImportCsv } from './nthuCourseSchedule';

export const MAX_PUBLIC_COURSE_BULK_SELECTION = 10;

/**
 * Join public course cards from the same semester into one personal-import review.
 * Require credits for every card and let the school converter validate the CSV fields.
 */
export function mergePublicCourseTimetableCsv(
  schoolId: PublicCourseCatalogResponse['schoolId'],
  courses: readonly PublicCatalogCourse[],
): string | null {
  if (!['nthu', 'ncnu'].includes(schoolId) ||
      courses.length < 2 || courses.length > MAX_PUBLIC_COURSE_BULK_SELECTION) return null;

  const semester = courses[0]?.semester;
  if (!semester || !/^\d{3}[123]$/.test(semester)) return null;

  const seen = new Set<string>();
  let header: string | null = null;
  const rows: string[] = [];
  for (const course of courses) {
    if (!course || course.semester !== semester ||
        typeof course.code !== 'string' || !course.code.trim() ||
        typeof course.section !== 'string' ||
        typeof course.credits !== 'string' || !course.credits.trim()) return null;

    // Match the personal import deduplication rules for class names.
    const identity = JSON.stringify([
      normalizePersonalImportText(course.code),
      normalizePersonalImportText(course.section).replace(/\s+/g, ' ').toLowerCase(),
    ]);
    if (seen.has(identity)) return null;
    seen.add(identity);

    const csv = schoolId === 'nthu'
      ? nthuTimetableImportCsv(course)
      : ncnuTimetableImportCsv(course);
    if (!csv) return null;
    const boundary = csv.indexOf('\r\n');
    if (boundary === -1 || boundary + 2 >= csv.length) return null;
    const fields = csv.slice(0, boundary);
    if (header && header !== fields) return null;
    header = fields;
    // Do not split data rows: a quoted teacher or classroom may contain newlines.
    rows.push(csv.slice(boundary + 2));
  }
  return header && rows.length === courses.length
    ? header + '\r\n' + rows.join('\r\n') : null;
}
