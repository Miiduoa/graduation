import { serializePersonalImportsCsv } from './imports/csv';
import type { PublicCatalogCourse, PublicCatalogMeeting } from './publicCourseCatalog';

// Official course-code diagram, weekday codes and complete period table, checked 2026-11-06.
// https://curricul.site.nthu.edu.tw/p/406-1208-290466,r7880.php?Lang=zh-tw
// The padded four-character department code is part of the 15-character identity.
export function nthuCourseIdentity(code: string) {
  const match = /^(\d{3})([123])0([A-Z]{1,4} *)(\d{4})(\d{2})$/.exec(code);
  if (!match || code.length !== 15 || match[3].length !== 4) return null;
  return {
    academicYear: match[1],
    semester: match[1] + match[2],
    term: match[2],
    departmentCode: match[3].trim(),
    section: match[5],
  };
}

const clocks: Record<string, readonly [string, string]> = {
  '1': ['08:00', '08:50'], '2': ['09:00', '09:50'],
  '3': ['10:10', '11:00'], '4': ['11:10', '12:00'], n: ['12:10', '13:00'],
  '5': ['13:20', '14:10'], '6': ['14:20', '15:10'], '7': ['15:30', '16:20'],
  '8': ['16:30', '17:20'], '9': ['17:30', '18:20'],
  a: ['18:30', '19:20'], b: ['19:30', '20:20'], c: ['20:30', '21:20'], d: ['21:30', '22:20'],
};
const periodOrder = '1234n56789abcd';
const weekdays = 'MTWRFSU';

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export type NthuCourseMeeting = {
  dayOfWeek: number;
  periodLabel: string;
  label: string;
  room: string;
  startTime?: string;
  endTime?: string;
};

export function nthuCourseMeetings(
  meetings: readonly PublicCatalogMeeting[],
  semester?: string,
): NthuCourseMeeting[] | null {
  if (!meetings.length || meetings.some(meeting => !/^(?:[MTWRFSU][1-9nabcd])+$/.test(meeting.time))) return null;
  // The published table was verified for the feed's 115-1 semester. Other terms
  // retain their own raw labels until their clock table has been checked.
  const verified = semester === '1151';
  return meetings.flatMap(meeting => {
    const runs: { dayOfWeek: number; periodLabel: string }[] = [];
    for (const [, day, period] of meeting.time.matchAll(/([MTWRFSU])([1-9nabcd])/g)) {
      const dayOfWeek = weekdays.indexOf(day) + 1;
      const previous = runs[runs.length - 1];
      const previousPeriod = previous?.periodLabel.slice(-1);
      // Some consecutive official period numbers still have a 20-minute break.
      // Only 115-1 has a verified clock table: keep longer breaks free instead
      // of stretching a single timetable block across them.
      const longVerifiedBreak = verified && previousPeriod !== undefined &&
        clockMinutes(clocks[period][0]) - clockMinutes(clocks[previousPeriod][1]) > 10;
      if (previous && previousPeriod && previous.dayOfWeek === dayOfWeek &&
        periodOrder.indexOf(period) === periodOrder.indexOf(previousPeriod) + 1 &&
        !longVerifiedBreak) {
        previous.periodLabel += period;
      } else {
        runs.push({ dayOfWeek, periodLabel: period });
      }
    }
    return runs.map(({ dayOfWeek, periodLabel }) => {
      const startTime = verified ? clocks[periodLabel[0]][0] : undefined;
      const endTime = verified ? clocks[periodLabel.slice(-1)][1] : undefined;
      return {
        dayOfWeek,
        periodLabel,
        room: meeting.room,
        label: `星期${'一二三四五六日'[dayOfWeek - 1]} ${[...periodLabel].join('、')} 節` +
          (startTime ? ` · ${startTime}–${endTime}` : ''),
        ...(startTime && { startTime, endTime }),
      };
    });
  });
}

export function nthuTimetableImportCsv(course: PublicCatalogCourse): string | null {
  const identity = nthuCourseIdentity(course.code);
  const meetings = nthuCourseMeetings(course.meetings ?? [], course.semester);
  if (!identity || !meetings || identity.semester !== course.semester || identity.section !== course.section) return null;
  // Multiple official room/time pairs may describe one course. A repeated
  // weekday/period would duplicate or overlap the student's imported timetable;
  // require manual verification rather than silently importing both rooms.
  const occupied = new Set<string>();
  for (const meeting of course.meetings ?? []) {
    for (const [, day, period] of meeting.time.matchAll(/([MTWRFSU])([1-9nabcd])/g)) {
      const slot = `${day}:${period}`;
      if (occupied.has(slot)) return null;
      occupied.add(slot);
    }
  }
  return serializePersonalImportsCsv(meetings.map((meeting, index) => ({
    id: [course.semester, course.code, course.section, index].join('-'),
    kind: 'timetable',
    title: course.title,
    schoolId: 'nthu',
    academicYear: identity.academicYear,
    semester: identity.term,
    courseCode: course.code,
    teacher: course.teacher,
    className: course.section,
    location: meeting.room,
    dayOfWeek: meeting.dayOfWeek,
    periodLabel: meeting.periodLabel,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    credits: /^\d+(\.\d+)?$/.test(course.credits) ? Number(course.credits) : undefined,
    source: { type: 'paste', line: index + 1, rawText: course.time },
  })), ['schoolId', 'academicYear', 'semester', 'courseCode', 'className', 'title', 'teacher', 'location', 'credits', 'dayOfWeek', 'periodLabel', 'startTime', 'endTime']);
}
