import type { PersonalCourse } from './course';
import {
  periodEnd,
  periodStart,
  periodTimes,
  timeToMinutes,
  weekdayLabel,
  type PeriodProfileId,
} from './periods';

export type MeetupKindName = 'meal' | 'study';

export type MeetupWindow = {
  day: number;
  /** 分鐘（從 0:00 算） */
  start: number;
  end: number;
  /** 這段裡有午餐或晚餐時間 */
  meal: 'lunch' | 'dinner' | null;
};

export const MEETUP_DURATION_MINUTES = 60;
const LUNCH = { start: timeToMinutes('12:00'), end: timeToMinutes('13:10') };
const DINNER = { start: timeToMinutes('17:10'), end: timeToMinutes('18:05') };

function dayBounds(profile: PeriodProfileId) {
  const times = periodTimes(profile);
  return {
    start: timeToMinutes(times[0][0]),
    end: timeToMinutes(times[times.length - 1][1]),
  };
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function minutesLabel(total: number): string {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function busyIntervals(
  courses: PersonalCourse[],
  day: number,
  profile: PeriodProfileId,
): Array<[number, number]> {
  return courses
    .filter((course) => course.day === day && course.start > 0 && course.end >= course.start)
    .map((course) => [timeToMinutes(periodStart(course.start, profile)), timeToMinutes(periodEnd(course.end, profile))] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

function mealOf(start: number, end: number): MeetupWindow['meal'] {
  if (start <= LUNCH.start && end >= LUNCH.start + MEETUP_DURATION_MINUTES) return 'lunch';
  if (start <= DINNER.start && end >= DINNER.start + MEETUP_DURATION_MINUTES) return 'dinner';
  return null;
}

/**
 * 兩個人都沒課、至少一小時的時段（用實際時間算，所以午休 12:00–13:10 也算得到）。
 * 有午餐、晚餐時間的排前面。
 */
export function meetupWindows(
  mine: PersonalCourse[],
  theirs: PersonalCourse[],
  profile: PeriodProfileId = 'pu',
): MeetupWindow[] {
  const out: MeetupWindow[] = [];
  const bounds = dayBounds(profile);
  for (let day = 1; day <= 5; day += 1) {
    const busy = [...busyIntervals(mine, day, profile), ...busyIntervals(theirs, day, profile)].sort((a, b) => a[0] - b[0]);
    let cursor = bounds.start;
    const push = (start: number, end: number) => {
      if (end - start >= MEETUP_DURATION_MINUTES) out.push({ day, start, end, meal: mealOf(start, end) });
    };
    for (const [start, end] of busy) {
      if (start > cursor) push(cursor, Math.min(start, bounds.end));
      cursor = Math.max(cursor, end);
    }
    if (cursor < bounds.end) push(cursor, bounds.end);
  }
  return out.sort((a, b) => {
    const rank = (w: MeetupWindow) => (w.meal ? 0 : 1);
    return rank(a) - rank(b) || a.day - b.day || a.start - b.start;
  });
}

/** 可以選的開始時間，每 30 分一格；有午餐、晚餐時間的，那個時間排第一個（也是預設）。 */
export function meetupStartOptions(window: MeetupWindow): number[] {
  const options: number[] = [];
  for (let at = window.start; at + MEETUP_DURATION_MINUTES <= window.end; at += 30) options.push(at);
  const preferred = window.meal === 'lunch' ? LUNCH.start : window.meal === 'dinner' ? DINNER.start : null;
  if (preferred !== null) return [preferred, ...options.filter((at) => at !== preferred)];
  return options;
}

export function meetupWindowLabel(window: MeetupWindow): string {
  const meal = window.meal === 'lunch' ? '（午餐時間）' : window.meal === 'dinner' ? '（晚餐時間）' : '';
  return `${weekdayLabel(window.day)} ${minutesLabel(window.start)}–${minutesLabel(window.end)}${meal}`;
}

/** 同一個人、同一位朋友、同一個時間、同一件事只會有一筆邀約（連按也一樣）。 */
export function meetupDocId(creatorUid: string, inviteeUid: string, day: number, startMinute: number, kind: MeetupKindName) {
  return `m_${creatorUid}_${inviteeUid}_${day}_${startMinute}_${kind}`;
}

/** 「星期一 12:00 吃飯（1 小時）」；舊的邀約沒有開始時間，就寫整段。 */
export function meetupLabel(meetup: {
  day: number;
  kind: string;
  startMinute?: number | null;
  durationMinutes?: number | null;
  startPeriod?: number;
  endPeriod?: number;
}): string {
  const what = meetup.kind === 'study' ? '讀書' : '吃飯';
  if (typeof meetup.startMinute === 'number') {
    const hours = Math.round(((meetup.durationMinutes || MEETUP_DURATION_MINUTES) / 60) * 10) / 10;
    return `${weekdayLabel(meetup.day)} ${minutesLabel(meetup.startMinute)} ${what}（${hours} 小時）`;
  }
  return `${weekdayLabel(meetup.day)} ${periodStart(meetup.startPeriod || 0)}–${periodEnd(meetup.endPeriod || 0)} ${what}`;
}

/** 開始時間落在哪一節（給還只看節次的舊版畫面用）。 */
export function periodAt(minute: number, profile: PeriodProfileId = 'pu'): number {
  const times = periodTimes(profile);
  for (let index = 0; index < times.length; index += 1) {
    if (minute < timeToMinutes(times[index][1])) return index + 1;
  }
  return times.length;
}
