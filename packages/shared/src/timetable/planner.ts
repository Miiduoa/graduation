import { PERIOD_COUNT, periodEnd, periodStart, timeToMinutes, weekdayLabel } from './periods';
import type { PersonalCourse } from './course';

export type FreeBlock = {
  day: number;
  start: number;
  end: number;
};

export type NextClassResult =
  | { kind: 'now'; course: PersonalCourse; minutes: number }
  | { kind: 'next'; course: PersonalCourse; minutes: number }
  | { kind: 'future'; course: PersonalCourse }
  | null;

export type PlannerFriend = {
  id: string;
  name: string;
  courses: PersonalCourse[];
};

function scheduledCourses(courses: PersonalCourse[]): PersonalCourse[] {
  return courses.filter(
    (course) =>
      Number(course.day) >= 1 &&
      Number(course.day) <= 5 &&
      Number(course.start) >= 1 &&
      Number(course.end) >= Number(course.start),
  );
}

function cleanQuery(value: string): string {
  return String(value || '')
    .replace(/[\s，,。.!！?？：:「」『』()（）]/g, '')
    .toLowerCase();
}

function blockMinutes(block: FreeBlock): number {
  return Math.max(50, timeToMinutes(periodEnd(block.end)) - timeToMinutes(periodStart(block.start)));
}

function blockLabel(block: FreeBlock): string {
  return `${weekdayLabel(block.day)} ${periodStart(block.start)}–${periodEnd(block.end)}`;
}

export function nextClass(courses: PersonalCourse[], now = new Date()): NextClassResult {
  const list = scheduledCourses(courses);
  const day = now.getDay();
  const minute = now.getHours() * 60 + now.getMinutes();
  if (day >= 1 && day <= 5) {
    for (const course of list.filter((item) => item.day === day).sort((a, b) => a.start - b.start)) {
      const start = timeToMinutes(periodStart(course.start));
      const end = timeToMinutes(periodEnd(course.end));
      if (minute >= start && minute < end) return { kind: 'now', course, minutes: end - minute };
      if (minute < start) return { kind: 'next', course, minutes: start - minute };
    }
  }
  for (let plus = 1; plus <= 7; plus += 1) {
    const nextDay = ((day + plus - 1) % 7) + 1;
    if (nextDay > 5) continue;
    const course = list.filter((item) => item.day === nextDay).sort((a, b) => a.start - b.start)[0];
    if (course) return { kind: 'future', course };
  }
  return null;
}

export function freeBlocks(courses: PersonalCourse[], day: number | null = null, minPeriods = 1): FreeBlock[] {
  const list = scheduledCourses(courses);
  const out: FreeBlock[] = [];
  for (let current = day || 1; current <= (day || 5); current += 1) {
    const busy = new Set<number>();
    list
      .filter((course) => course.day === current)
      .forEach((course) => {
        for (let period = course.start; period <= course.end; period += 1) busy.add(period);
      });
    let start: number | null = null;
    for (let period = 1; period <= PERIOD_COUNT; period += 1) {
      if (!busy.has(period) && start === null) start = period;
      if ((busy.has(period) || period === PERIOD_COUNT) && start !== null) {
        const end = busy.has(period) ? period - 1 : period;
        if (end - start + 1 >= minPeriods) out.push({ day: current, start, end });
        start = null;
      }
    }
  }
  return out;
}

function minutesToTime(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** 在某一天的空堂裡找放得下指定時數的時段，從空堂開始時間往後排。 */
export function studySlots(courses: PersonalCourse[], day: number, hours: number): string[] {
  const need = Math.max(1, Math.round(hours * 60));
  return freeBlocks(courses, day, 1)
    .filter((block) => blockMinutes(block) >= need)
    .map((block) => {
      const start = timeToMinutes(periodStart(block.start));
      return `${weekdayLabel(block.day)} ${minutesToTime(start)}–${minutesToTime(start + need)}`;
    });
}

export function commonFree(
  mine: PersonalCourse[],
  theirs: PersonalCourse[],
  day: number | null = null,
  minPeriods = 2,
): FreeBlock[] {
  const out: FreeBlock[] = [];
  for (let current = day || 1; current <= (day || 5); current += 1) {
    const busy = new Set<number>();
    [...scheduledCourses(mine), ...scheduledCourses(theirs)]
      .filter((course) => course.day === current)
      .forEach((course) => {
        for (let period = course.start; period <= course.end; period += 1) busy.add(period);
      });
    let start: number | null = null;
    for (let period = 1; period <= PERIOD_COUNT; period += 1) {
      if (!busy.has(period) && start === null) start = period;
      if ((busy.has(period) || period === PERIOD_COUNT) && start !== null) {
        const end = busy.has(period) ? period - 1 : period;
        if (end - start + 1 >= minPeriods) out.push({ day: current, start, end });
        start = null;
      }
    }
  }
  return out;
}

function resolveDay(text: string, remembered: number | null): number | null {
  const query = String(text);
  const match = query.match(/(?:星期|週|禮拜)\s*([一二三四五1-5])/);
  if (match) {
    const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
    return map[match[1]] || Number(match[1]);
  }
  const today = new Date().getDay();
  if (query.includes('今天') && today >= 1 && today <= 5) return today;
  if (query.includes('明天') && today + 1 >= 1 && today + 1 <= 5) return today + 1;
  if (/那天|那一天|那星期|那週/.test(query)) return remembered;
  return null;
}

function resolveCourse(text: string, courses: PersonalCourse[], rememberedId: string): PersonalCourse | null {
  const query = cleanQuery(text);
  const list = scheduledCourses(courses);
  let found = list.find((course) => {
    const name = cleanQuery(course.name);
    return name.length >= 2 && query.includes(name);
  });
  if (!found) {
    found = list.find((course) => {
      const name = cleanQuery(course.name);
      return name.length >= 4 && query.includes(name.slice(0, 4));
    });
  }
  if (!found && /那堂|那門|這堂|這門|剛剛那/.test(text) && rememberedId) {
    found = list.find((course) => course.id === rememberedId);
  }
  return found || null;
}

function parseDuration(text: string): number {
  let match = String(text).match(/(\d+(?:\.\d+)?)\s*小時/);
  if (match) return Math.max(30, Math.round(Number(match[1]) * 60));
  match = String(text).match(/(\d+)\s*分鐘/);
  if (match) return Math.max(20, Number(match[1]));
  match = String(text).match(/(\d+)\s*節/);
  if (match) return Math.max(1, Number(match[1])) * 50;
  return 100;
}

function describeNext(result: NextClassResult): string {
  if (!result) return '目前找不到下一堂課。';
  const room = result.course.room ? `，在 ${result.course.room}` : '';
  if (result.kind === 'now') return `現在是「${result.course.name}」，約 ${result.minutes} 分鐘後下課${room}。`;
  if (result.kind === 'next') return `下一堂是「${result.course.name}」，約 ${result.minutes} 分鐘後開始${room}。`;
  return `下一堂是${weekdayLabel(result.course.day)}的「${result.course.name}」，${periodStart(result.course.start)} 開始${room}。`;
}

export class SchedulePlanner {
  private day: number | null = null;
  private courseId = '';
  private plan: { subject: string; duration: number } | null = null;
  private advanced = false;

  constructor(
    private courses: PersonalCourse[] = [],
    private friends: PlannerFriend[] = [],
    private selectedFriendId: string | null = null,
  ) {}

  setCourses(courses: PersonalCourse[]) {
    this.courses = courses;
  }

  setFriends(friends: PlannerFriend[]) {
    this.friends = friends;
  }

  setSelectedFriend(id: string | null) {
    this.selectedFriendId = id;
  }

  setAdvanced(value: boolean) {
    this.advanced = value;
  }

  isAdvanced() {
    return this.advanced;
  }

  ask(text: string, now = new Date()): string {
    const query = String(text || '').trim();
    if (!query) return '';
    if (this.plan && /改到|改成|換到|分兩段|分段|不要太晚/.test(query)) {
      return this.planWeek(`${this.plan.subject} ${this.plan.duration}分鐘 ${query}`);
    }
    const day = resolveDay(query, this.day);
    const course = resolveCourse(query, this.courses, this.courseId);
    if (day) this.day = day;
    if (course) {
      this.courseId = course.id;
      this.day = course.day;
    }
    if (/下一堂|下一節|等等上|現在上|正在上/.test(query)) {
      const result = nextClass(this.courses, now);
      if (result) {
        this.courseId = result.course.id;
        this.day = result.course.day;
      }
      return describeNext(result);
    }
    if (course && /老師|誰教|教授|授課/.test(query)) {
      return `「${course.name}」的老師是 ${course.teacher || '課表沒有填老師'}。`;
    }
    if (course && /教室|哪裡|在哪|地點/.test(query)) {
      return course.room ? `「${course.name}」在 ${course.room}。` : `「${course.name}」目前沒有填教室。`;
    }
    if (course && /幾點|時間|第幾節|什麼時候/.test(query)) {
      return `「${course.name}」是${weekdayLabel(course.day)}第 ${course.start}${course.end > course.start ? `–${course.end}` : ''} 節，${periodStart(course.start)}–${periodEnd(course.end)}。`;
    }
    if (day && /(有什麼課|有哪些課|上什麼|幾堂|課表|課程)/.test(query)) {
      const list = scheduledCourses(this.courses)
        .filter((item) => item.day === day)
        .sort((a, b) => a.start - b.start);
      if (!list.length) return `${weekdayLabel(day)}沒有排課。`;
      return `${weekdayLabel(day)}有 ${list.length} 門課：\n${list
        .map((item, index) => `${index + 1}. ${periodStart(item.start)}–${periodEnd(item.end)}｜${item.name}${item.room ? `｜${item.room}` : ''}`)
        .join('\n')}`;
    }
    if (/最忙|最累|哪天.*忙|哪天.*累/.test(query)) {
      const load = [1, 2, 3, 4, 5]
        .map((item) => {
          const list = scheduledCourses(this.courses).filter((courseItem) => courseItem.day === item);
          return {
            day: item,
            count: list.length,
            periods: list.reduce((sum, courseItem) => sum + courseItem.end - courseItem.start + 1, 0),
          };
        })
        .sort((a, b) => b.periods - a.periods || b.count - a.count)[0];
      return `${weekdayLabel(load.day)}課最多，共 ${load.count} 門、${load.periods} 節。`;
    }
    if (/共同空堂|跟.*(?:好友|朋友).*空|一起有空/.test(query)) {
      const friend = this.friends.find((item) => item.id === this.selectedFriendId);
      if (!friend) return '先選一位朋友，才能比較你們兩個的課表。';
      const blocks = commonFree(this.courses, friend.courses, day).slice(0, 5);
      if (!blocks.length) return '目前沒有找到至少兩節連續的共同空堂。';
      return `你們比較好約的時間：\n${blocks.map((block, index) => `${index + 1}. ${blockLabel(block)}`).join('\n')}`;
    }
    if (/空堂|空檔|有空|自由時間/.test(query)) {
      const blocks = freeBlocks(this.courses, day, 2)
        .sort((a, b) => blockMinutes(b) - blockMinutes(a))
        .slice(0, 5);
      if (!blocks.length) return '目前沒有找到兩節以上的連續空堂。';
      return `${day ? weekdayLabel(day) : '這週'}比較長的空檔：\n${blocks.map((block, index) => `${index + 1}. ${blockLabel(block)}`).join('\n')}`;
    }
    if (/安排|規劃|排.*(?:讀書|作業|複習|準備)|\d+\s*(?:小時|分鐘|節)/.test(query)) {
      return this.planWeek(query);
    }
    if (this.advanced && /條件|晚上|不要太晚|分段/.test(query)) return this.planWeek(query);
    if (course) return `你問的是「${course.name}」嗎？我可以接著查老師、教室、時間，或幫你排這門課的準備時間。`;
    if (this.day) return `剛剛在看${weekdayLabel(this.day)}。可以接著問那天的課、空堂，或叫我排一段讀書時間。`;
    return '我直接讀你的課表。試著問「星期三有什麼課」、「下一堂在哪」，或「星期五幫我排兩小時讀書」。';
  }

  private planWeek(text: string): string {
    const day = resolveDay(text, this.day);
    const duration = parseDuration(text);
    const course = resolveCourse(text, this.courses, this.courseId);
    const subject = (
      course?.name ||
      (String(text).match(/(?:準備|複習|讀|寫|做)\s*([^，。,.！？!?]{2,16})/) || [])[1] ||
      this.plan?.subject ||
      '要完成的事'
    ).trim();
    const evening = /晚上|傍晚/.test(text);
    const avoidLate = /不要太晚|別太晚|早點/.test(text);
    const split = /分段|拆開|分兩/.test(text);
    let blocks = freeBlocks(this.courses, day, 1);
    if (evening) blocks = blocks.filter((block) => timeToMinutes(periodStart(block.start)) >= 17 * 60);
    if (avoidLate) blocks = blocks.filter((block) => timeToMinutes(periodEnd(block.end)) <= 20 * 60 + 45);
    blocks.sort((a, b) =>
      split ? a.day - b.day || a.start - b.start : blockMinutes(b) - blockMinutes(a) || a.day - b.day,
    );
    if (!blocks.length) return '目前課表裡找不到符合這些條件的空檔。可以換一天或把時間限制放寬一點。';
    let remain = duration;
    const picks: Array<FreeBlock & { use: number }> = [];
    for (const block of blocks) {
      if (remain <= 0) break;
      const use = Math.min(remain, blockMinutes(block));
      picks.push({ ...block, use });
      remain -= use;
      if (!split && picks.length >= 3) break;
    }
    this.plan = { subject, duration };
    this.day = day || this.day;
    const lines = picks.map((block, index) => `${index + 1}. ${blockLabel(block)}｜${subject}，約 ${block.use} 分鐘`);
    return `我會先這樣排：\n${lines.join('\n')}${remain > 0 ? `\n還差約 ${remain} 分鐘，可以再補一段課後時間。` : ''}`;
  }
}
