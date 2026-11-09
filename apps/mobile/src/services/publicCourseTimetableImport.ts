import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import { ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import { nthuTimetableImportCsv } from '@campus/shared/src/nthuCourseSchedule';
import type { PublicCatalogCourse, PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import type { PersonalImportRow, PersonalImportRecord } from '@campus/shared';

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

export type CatalogTimetableOverlap = {
  dayOfWeek: number;
  incomingTitle: string;
  existingTitle: string;
  startTime: string;
  endTime: string;
};

/** Only compares verified weekday clocks in the same owner-scoped school and term. */
export function findCatalogTimetableOverlaps(
  incoming: PersonalImportRow[],
  existing: PersonalImportRecord[],
): CatalogTimetableOverlap[] {
  const minutes = (clock?: string) => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock || '');
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const normalize = (value?: string) => (value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const overlaps: CatalogTimetableOverlap[] = [];
  for (const next of incoming) {
    if (next.kind !== 'timetable' || !next.dayOfWeek) continue;
    const start = minutes(next.startTime), end = minutes(next.endTime);
    if (start === null || end === null || start >= end) continue;
    for (const saved of existing) {
      if (saved.kind !== 'timetable' || saved.schoolId !== next.schoolId ||
        saved.academicYear !== next.academicYear || saved.semester !== next.semester ||
        saved.dayOfWeek !== next.dayOfWeek) continue;
      const savedStart = minutes(saved.startTime), savedEnd = minutes(saved.endTime);
      if (savedStart === null || savedEnd === null || savedStart >= savedEnd ||
        savedStart >= end || start >= savedEnd) continue;
      // Skip only an identical class slot. If the official teacher or room has
      // changed, flag the existing personal copy for review instead of silently
      // treating the updated offering as a harmless duplicate.
      if (normalize(next.courseCode) !== '' &&
        normalize(saved.courseCode) === normalize(next.courseCode) &&
        normalize(saved.className) === normalize(next.className) &&
        normalize(saved.teacher) === normalize(next.teacher) &&
        normalize(saved.location) === normalize(next.location) &&
        savedStart === start && savedEnd === end) continue;
      overlaps.push({
        dayOfWeek: next.dayOfWeek,
        incomingTitle: next.title,
        existingTitle: saved.title,
        // Show the intersection, not the existing class's entire session.
        // All four clocks were validated as canonical HH:mm above.
        startTime: (start > savedStart ? next.startTime : saved.startTime) || '',
        endTime: (end < savedEnd ? next.endTime : saved.endTime) || '',
      });
      if (overlaps.length >= 10) return overlaps;
    }
  }
  return overlaps;
}

export type PublicCourseTimetablePreview = NonNullable<ReturnType<typeof preparePublicCourseTimetableImport>>;
