import { serializePersonalImportsCsv } from './imports/csv';
import type { PublicCatalogCourse } from './publicCourseCatalog';

// NCNU uses a weekday digit followed by its own period letters. Keep the letters
// because the university changed its afternoon hours starting with 114-2.
export function ncnuCourseMeetings(time: string) {
  if (!/^(?:[1-7][a-mxyz]+)+$/.test(time)) return null;
  return Array.from(time.matchAll(/([1-7])([a-mxyz]+)/g), ([, day, periods]) => ({
    dayOfWeek: Number(day),
    periodLabel: periods,
    label: `星期${'一二三四五六日'[Number(day) - 1]} ${[...periods].join('、')} 節`,
  }));
}

export function ncnuTimetableImportCsv(course: PublicCatalogCourse): string | null {
  const meetings = ncnuCourseMeetings(course.time);
  const term = /^(\d{3})([12])$/.exec(course.semester);
  if (!meetings || !term) return null;
  return serializePersonalImportsCsv(meetings.map((meeting, index) => ({
    id: [course.semester, course.code, course.section, index].join('-'),
    kind: 'timetable',
    title: course.title,
    schoolId: 'ncnu',
    academicYear: term[1],
    semester: term[2],
    courseCode: course.code,
    teacher: course.teacher,
    className: course.section,
    location: course.room,
    dayOfWeek: meeting.dayOfWeek,
    periodLabel: meeting.periodLabel,
    credits: /^\d+(\.\d+)?$/.test(course.credits) ? Number(course.credits) : undefined,
    source: { type: 'paste', line: index + 1, rawText: course.time },
  })), ['schoolId', 'academicYear', 'semester', 'courseCode', 'className', 'title', 'teacher', 'location', 'credits', 'dayOfWeek', 'periodLabel']);
}
