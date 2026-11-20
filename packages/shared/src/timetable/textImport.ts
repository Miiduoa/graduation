import { cleanCourse, createCourseId, type PersonalCourse } from './course';
import {
  WEEKDAYS,
  parsePeriodRange,
  type PeriodProfileId,
} from './periods';

const DAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
};

function parseDay(value: string): number {
  const match = value.match(/(?:星期|週|禮拜)?([一二三四五1-5])/);
  if (!match) return 0;
  return DAY_MAP[match[1]] || 0;
}

/** 把貼上的課表文字變成待確認草稿。不會寫入現有課表。 */
export function parseTimetableText(
  text: string,
  profile: PeriodProfileId = 'pu',
): PersonalCourse[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/[｜|]/g, '/').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const courses: PersonalCourse[] = [];
  for (const line of lines) {
    const day = parseDay(line);
    const ncku = profile === 'ncku'
      ? line.match(
          /第\s*(?:0|[1-9]|[NABCD])(?:\s*節)?\s*[-–~到至]\s*(?:第\s*)?(?:0|[1-9]|[NABCD])\s*節?|第\s*(?:0|[1-9]|[NABCD])\s*節|\[(?:0|[1-9]|[NABCD])\](?:\s*\[(?:0|[1-9]|[NABCD])\])+/i,
        )
      : line.match(/第?\s*\d{1,2}\s*[-–~到至]\s*第?\s*\d{1,2}\s*節?|第?\s*\d{1,2}\s*節/);
    const periods = ncku ? parsePeriodRange(ncku[0], profile) : parsePeriodRange(line, profile);
    if (!periods && /^(星期|節次|課表|注意|學年度)/.test(line) && line.length < 12) continue;
    let rest = line.replace(/\b\d{1,2}:\d{2}\s*[-–~]\s*\d{1,2}:\d{2}\b/g, ' ');
    if (periods) rest = rest.replace(periods.text, ' ');
    rest = rest.replace(/(?:星期|週|禮拜)?[一二三四五]/, ' ').trim();
    const parts = rest
      .split(/\s*\/\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    const name = (parts[0] || rest).replace(/^\d+[.、]\s*/, '').trim();
    if (!name || WEEKDAYS.includes(name as (typeof WEEKDAYS)[number])) continue;
    courses.push(
      cleanCourse({
        id: createCourseId(),
        name,
        day,
        start: periods?.start || (day ? 1 : 0),
        end: periods?.end || (day ? 1 : 0),
        teacher: parts[1] || '',
        room: parts[2] || '',
      }),
    );
  }
  return courses.slice(0, 80);
}
