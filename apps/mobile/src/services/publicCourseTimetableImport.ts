import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import { ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import { nthuTimetableImportCsv } from '@campus/shared/src/nthuCourseSchedule';
import type { PublicCatalogCourse, PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';

/** Public course data is a proposal for a personal record, never proof of enrollment. */
export function preparePublicCourseTimetableImport(
  schoolId: PublicCourseCatalogResponse['schoolId'],
  course: PublicCatalogCourse,
) {
  if (schoolId !== 'nthu' && schoolId !== 'ncnu') return null;
  const csv = schoolId === 'nthu' ? nthuTimetableImportCsv(course) : ncnuTimetableImportCsv(course);
  if (!csv || !/^\d{3}[123]$/.test(course.semester)) return null;
  const academicYear = course.semester.slice(0, -1);
  const semester = course.semester.slice(-1);
  const schoolName = schoolId === 'nthu' ? '國立清華大學' : '國立暨南國際大學';
  const parsed = parsePersonalImport(csv, {
    kind: 'timetable', schoolId, academicYear, semester,
    source: { type: 'paste', name: `${schoolName}公開開課目錄 · ${course.code}` },
  });
  // Only the semesters with verified clock tables can use this direct path.
  // Other terms retain the existing editable CSV/manual-import route.
  if (!parsed.rows.length || parsed.issues.some((issue) => issue.severity === 'error') ||
    parsed.rows.some((row) => row.schoolId !== schoolId || row.kind !== 'timetable' ||
      !row.dayOfWeek || !Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 1 || row.dayOfWeek > 7 ||
      row.academicYear !== academicYear || row.semester !== semester || !row.startTime || !row.endTime)) return null;
  return { ...parsed, schoolName, academicYear, semester, term: `${academicYear}|${semester}`, csv };
}

export type PublicCourseTimetablePreview = NonNullable<ReturnType<typeof preparePublicCourseTimetableImport>>;
