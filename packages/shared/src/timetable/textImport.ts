import { cleanCourse, createCourseId, type PersonalCourse } from './course';
import { WEEKDAYS } from './periods';

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

function parsePeriods(value: string): { start: number; end: number } | null {
  const range = value.match(/第?\s*(\d{1,2})\s*[-–~到至]\s*第?\s*(\d{1,2})\s*節?/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start >= 1 && end >= start && end <= 13) return { start, end };
  }
  const single = value.match(/第?\s*(\d{1,2})\s*節/);
  if (single) {
    const start = Number(single[1]);
    if (start >= 1 && start <= 13) return { start, end: start };
  }
  return null;
}

/** 把貼上的課表文字變成待確認草稿。不會寫入現有課表。 */
export function parseTimetableText(text: string): PersonalCourse[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/[｜|]/g, '/').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const courses: PersonalCourse[] = [];
  for (const line of lines) {
    const day = parseDay(line);
    const periods = parsePeriods(line);
    if (!periods && /^(星期|節次|課表|注意|學年度)/.test(line) && line.length < 12) continue;
    let rest = line
      .replace(/(?:星期|週|禮拜)?[一二三四五]/, ' ')
      .replace(/第?\s*\d{1,2}\s*(?:[-–~到至]\s*第?\s*\d{1,2})?\s*節?/g, ' ')
      .replace(/\b\d{1,2}:\d{2}\s*[-–~]\s*\d{1,2}:\d{2}\b/g, ' ')
      .trim();
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
