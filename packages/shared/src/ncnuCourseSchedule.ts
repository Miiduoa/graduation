import { serializePersonalImportsCsv } from './imports/csv';
import type { PublicCatalogCourse } from './publicCourseCatalog';

// Verified against page 7 of the 115-1 course selection guide, including the
// afternoon change effective in 114-2. Other terms retain their original labels.
// https://curriculum.ncnu.edu.tw/p/404-1049-35240.php?Lang=zh-tw
const clocks: Record<string, readonly [string, string]> = {
  x: ['06:10', '07:00'], y: ['07:10', '08:00'],
  a: ['08:10', '09:00'], b: ['09:10', '10:00'],
  c: ['10:10', '11:00'], d: ['11:10', '12:00'], z: ['12:10', '13:00'],
  e: ['13:30', '14:20'], f: ['14:30', '15:20'],
  g: ['15:30', '16:20'], h: ['16:30', '17:20'],
  i: ['17:30', '18:20'], j: ['18:30', '19:20'],
  k: ['19:30', '20:20'], l: ['20:30', '21:20'], m: ['21:30', '22:20'],
};
const periodOrder = 'xyabcdzefghijklm';
type NcnuCourseMeeting = {
  dayOfWeek: number;
  periodLabel: string;
  label: string;
  startTime?: string;
  endTime?: string;
};

export function ncnuCourseMeetings(time: string, semester?: string): NcnuCourseMeeting[] | null {
  if (!/^(?:[1-7][a-mxyz]+)+$/.test(time)) return null;
  const verified = semester === '1142' || semester === '1151';
  return Array.from(time.matchAll(/([1-7])([a-mxyz]+)/g)).flatMap(([, day, periods]) => {
    const runs: string[] = [];
    if (!verified) {
      runs.push(periods);
    } else {
      for (const period of periods) {
        const previous = runs[runs.length - 1];
        // Preserve breaks between nonadjacent classes and the longer lunch break.
        if (previous && period !== 'e' && periodOrder.indexOf(period) === periodOrder.indexOf(previous.slice(-1)) + 1) {
          runs[runs.length - 1] += period;
        } else {
          runs.push(period);
        }
      }
    }
    return runs.map((periodLabel) => {
      const startTime = verified ? clocks[periodLabel[0]][0] : undefined;
      const endTime = verified ? clocks[periodLabel.slice(-1)][1] : undefined;
      return {
        dayOfWeek: Number(day),
        periodLabel,
        label: `星期${'一二三四五六日'[Number(day) - 1]} ${[...periodLabel].join('、')} 節` +
          (startTime ? ` · ${startTime}–${endTime}` : ''),
        ...(startTime && { startTime, endTime }),
      };
    });
  });
}

export function ncnuTimetableImportCsv(course: PublicCatalogCourse): string | null {
  const meetings = ncnuCourseMeetings(course.time, course.semester);
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
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    credits: /^\d+(\.\d+)?$/.test(course.credits) ? Number(course.credits) : undefined,
    source: { type: 'paste', line: index + 1, rawText: course.time },
  })), ['schoolId', 'academicYear', 'semester', 'courseCode', 'className', 'title', 'teacher', 'location', 'credits', 'dayOfWeek', 'periodLabel', 'startTime', 'endTime']);
}
