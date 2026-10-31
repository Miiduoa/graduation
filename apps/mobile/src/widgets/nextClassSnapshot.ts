import { buildPersonalToday, type PersonalImportRecord } from '@campus/shared';
import { taipeiInstantOnClock } from '@campus/shared/src/pickNextAction';

export type WidgetClass = {
  id: string;
  title: string;
  location: string;
  startAt: number;
  endAt: number;
  url: string;
  conflict: boolean;
};
export type NextClassSnapshot = {
  version: 1;
  updatedAt: number;
  expiresAt: number;
  classes: WidgetClass[];
  incomplete: boolean;
};
const DAY = 86400000;
/** Seven days of the same confirmed weekly plan; no background network is required. */
export function buildNextClassSnapshot(
  records: readonly PersonalImportRecord[],
  schoolId: string,
  now = new Date(),
): NextClassSnapshot {
  const classes: WidgetClass[] = [];
  let incomplete = false;
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(now.getTime() + offset * DAY);
    const plan = buildPersonalToday(records, { schoolId, now: date });
    incomplete ||= plan.unplacedCount > 0;
    for (const entry of plan.today) {
      const startAt = taipeiInstantOnClock(date, entry.startTime);
      const endAt = taipeiInstantOnClock(date, entry.endTime);
      if (startAt === null || endAt === null || endAt <= startAt) continue;
      const params = new URLSearchParams({
        courseId: entry.row.id,
        term: plan.termKey,
        schoolId,
      });
      classes.push({
        id: entry.row.id,
        title: entry.row.title,
        location: entry.row.location?.trim() || '教室未填',
        startAt,
        endAt,
        conflict: entry.conflict,
        url: `campus://personal-timetable?${params.toString()}`,
      });
    }
  }
  return {
    version: 1,
    updatedAt: now.getTime(),
    expiresAt: taipeiInstantOnClock(new Date(now.getTime() + 7 * DAY), '00:00')!,
    classes: classes.sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id)),
    incomplete,
  };
}

export function nextClassState(snapshot: NextClassSnapshot | null, now: number) {
  if (!snapshot) return { status: 'unavailable' as const };
  if (now >= snapshot.expiresAt || now < snapshot.updatedAt) return { status: 'stale' as const };
  const course = snapshot.classes.find((entry) => entry.endAt > now);
  if (course)
    return { status: course.startAt <= now ? ('ongoing' as const) : ('upcoming' as const), course };
  return { status: snapshot.incomplete ? ('incomplete' as const) : ('empty' as const) };
}
