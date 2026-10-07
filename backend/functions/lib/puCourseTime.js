'use strict';

// PU's existing period timetable. Unknown periods must not acquire a default time.
const PERIOD_TIMES = {
  1: ['08:10', '09:00'],
  2: ['09:10', '10:00'],
  3: ['10:10', '11:00'],
  4: ['11:10', '12:00'],
  5: ['13:10', '14:00'],
  6: ['14:10', '15:00'],
  7: ['15:10', '16:00'],
  8: ['16:10', '17:00'],
  9: ['17:10', '18:00'],
  10: ['18:30', '19:20'],
  11: ['19:25', '20:15'],
  12: ['20:20', '21:10'],
  13: ['21:15', '22:05'],
};
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const ENGLISH_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * Parse one complete meeting in the source's bilingual weekday format.
 * The course contract has one weekday and one room. Multiple meetings return
 * null so callers retain timePlaceRaw instead of displaying just one meeting.
 */
function parsePuCourseTime(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const source = raw.replace(/\u3000/g, ' ').trim();
  const match = /^([一二三四五六日])\s*[（(]([A-Za-z]+)[)）]\s*(\d+(?:\s*[,，]\s*\d+)*)(?:\s*[:：]\s*(.*))?$/s.exec(source);
  if (!match) return null;
  const dayIndex = WEEKDAYS.indexOf(match[1]);
  if (ENGLISH_WEEKDAYS[dayIndex] !== match[2].toLowerCase()) return null;

  const periods = [...new Set(match[3].split(/[,，]/).map((value) => Number(value.trim())))].sort((a, b) => a - b);
  if (!periods.length || periods.some((period) => !Object.hasOwn(PERIOD_TIMES, period))) return null;

  const location = (match[4] || '').trim();
  // Table extraction flattens <br> to whitespace. Further meeting markers must
  // not be swallowed as a room, even after that conversion.
  if (
    /[一二三四五六日]\s*[（(]|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|(?:星期|週)[一二三四五六日]/i.test(location) ||
    /\d\s*[:：]/.test(location) ||
    /[;；\r\n]/.test(location)
  ) return null;

  return {
    dayOfWeek: dayIndex + 1,
    periods,
    location,
    startTime: PERIOD_TIMES[periods[0]][0],
    endTime: PERIOD_TIMES[periods[periods.length - 1]][1],
  };
}

module.exports = { parsePuCourseTime };
