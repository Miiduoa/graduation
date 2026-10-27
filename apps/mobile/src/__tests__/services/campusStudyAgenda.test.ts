import {
  buildCampusStudyAgenda, formatCampusStudyAgenda, inspectCoursePeriods,
  resolveStudyWindow, type AgendaCourse,
} from '../../services/campusStudyAgenda';
import { buildOfflineCampusPlan } from '../../services/offlineCampusPlanner';
import type { OnDeviceSchoolContext } from '../../services/onDeviceSchoolContext';
import type { CampusSenseSnapshot } from '../../services/campusSenseSnapshot';

const now = Date.parse('2026-10-27T07:00:00Z'); // Tuesday, 15:00 in Taiwan.
const course = (name: string, day: number, start: number, end: number): AgendaCourse => ({ name, day, start, end });
const context: OnDeviceSchoolContext = {
  checkedAt: new Date(now).toISOString(), schoolId: 'pu', schoolName: '靜宜大學',
  timetable: { source: 'saved-device-copy', updatedAt: '2026-10-26T00:00:00Z', courses: [
    course('星期二課程', 2, 1, 3), course('星期三課程', 3, 2, 4), course('下週一課程', 1, 4, 5),
  ] },
};
const snapshot: CampusSenseSnapshot = {
  userId: 'A', schoolId: 'pu', checkedAt: context.checkedAt,
  schedule: { status: 'unavailable', count: null },
  assignments: { status: 'available', count: 5, items: Array.from({ length: 5 }, (_, i) => ({
    title: '任務' + (i + 1), groupName: '課程' + i, dueAt: '2026-10-28T' + String(1 + i).padStart(2, '0') + ':00:00Z',
  })) },
  announcements: { status: 'unavailable', items: [] },
};

function agenda(question = '未來七天') {
  return buildCampusStudyAgenda({ window: resolveStudyWindow(question, now)!, now,
    courses: context.timetable.courses, assignments: snapshot.assignments.items });
}

test('retains all seven calendar dates and more than the first day with classes', () => {
  const result = agenda();
  expect(result.days.map((day) => day.date)).toEqual([
    '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
  ]);
  expect(result.days[1].courses[0].name).toBe('星期三課程');
  expect(result.days[6].courses[0].name).toBe('下週一課程');
  expect(formatCampusStudyAgenda(result).join('\n')).toContain('下週一課程');
});

test.each([
  ['今日讀書計畫', 1, '2026-10-27'],
  ['明天的學習計畫', 1, '2026-10-28'],
  ['本週剩餘時間', 6, '2026-10-27'],
  ['未來七天', 7, '2026-10-27'],
  ['規劃下週', 7, '2026-11-02'],
])('interprets %s as its actual calendar range', (question, length, firstDate) => {
  const result = agenda(question);
  expect(result.days).toHaveLength(length);
  expect(result.days[0].date).toBe(firstDate);
});

test.each([
  ['2026-11-01T04:00:00Z', '2026-11-02'],
  ['2026-11-02T04:00:00Z', '2026-11-09'],
])('next week always begins next Monday for %s', (iso, expected) => {
  const window = resolveStudyWindow('下週', Date.parse(iso))!;
  expect(new Date(window.startDay * 86400000).toISOString().slice(0, 10)).toBe(expected);
});

test('nested and overlapping classes are unioned before free periods are calculated', () => {
  const result = inspectCoursePeriods([
    course('A', 1, 1, 7), course('B', 1, 2, 3), course('C', 1, 6, 8), course('D', 1, 10, 11),
  ]);
  expect(result.gaps).toEqual([{ start: 9, end: 9 }]);
  expect(result.conflicts).toEqual([{ start: 2, end: 3 }, { start: 6, end: 7 }]);
});

test('adjacent classes are not a gap and equal boundary periods are a conflict', () => {
  expect(inspectCoursePeriods([course('A', 1, 1, 3), course('B', 1, 4, 5)]))
    .toEqual({ gaps: [], conflicts: [] });
  expect(inspectCoursePeriods([course('A', 1, 1, 3), course('B', 1, 3, 5)]).conflicts)
    .toEqual([{ start: 3, end: 3 }]);
});

test('Taiwan midnight determines due date rather than the UTC date string', () => {
  const result = buildCampusStudyAgenda({ window: resolveStudyWindow('未來七天', now)!, now,
    courses: [], assignments: [{ title: '跨日任務', groupName: '', dueAt: '2026-10-27T16:30:00Z' }] });
  expect(result.days[0].deadlines).toHaveLength(0);
  expect(result.days[1].deadlines[0]).toMatchObject({ title: '跨日任務', timeLabel: '00:30' });
});

test('ambiguous dates are shown as unconfirmed, never invented as midnight deadlines', () => {
  const result = buildCampusStudyAgenda({ window: resolveStudyWindow('未來七天', now)!, now,
    courses: [], assignments: [null, 'invalid', '2026-10-28', '2026-10-28T10:00:00'].map((dueAt) => ({ title: '待確認', groupName: '', dueAt })) });
  expect(result.days.every((day) => day.deadlines.length === 0)).toBe(true);
  expect(result.outsideWindow).toHaveLength(4);
  expect(result.outsideWindow.every((task) => task.reason === 'undated')).toBe(true);
});

test('unscheduled, invalid and noninteger periods do not invent available time', () => {
  const result = buildCampusStudyAgenda({ window: resolveStudyWindow('未來七天', now)!, now,
    courses: [course('未排', 0, 0, 0), course('負數', 2, -1, 3), course('小數', 2, 2.5, 4), course('無限', 2, 1, Infinity)], assignments: [] });
  expect(result.ignoredCourses).toBe(4);
  expect(result.days.every((day) => day.courses.length === 0 && day.gaps.length === 0)).toBe(true);
});

test('missing sources are distinct from valid but empty sources', () => {
  const result = buildCampusStudyAgenda({ window: resolveStudyWindow('今日', now)!, now, courses: null, assignments: null });
  expect(result.timetableAvailable).toBe(false);
  expect(result.assignmentsAvailable).toBe(false);
  expect(formatCampusStudyAgenda(result).join()).toContain('課表來源不可用');
  expect(formatCampusStudyAgenda(result).join()).not.toContain('未排課');
});

test('assignments outside the period remain accounted for and are not silently discarded', () => {
  const result = buildCampusStudyAgenda({ window: resolveStudyWindow('今天', now)!, now, courses: [], assignments: [
    { title: '先前', groupName: '', dueAt: '2026-10-26T01:00:00Z' },
    { title: '未來', groupName: '', dueAt: '2026-10-28T01:00:00Z' },
    { title: '未知', groupName: '', dueAt: null },
  ] });
  expect(result.outsideWindow.map((task) => task.reason)).toEqual(['before-window', 'after-window', 'undated']);
});

test('today keeps elapsed deadlines labeled as needing verification, not as pending executable work', () => {
  const result = buildCampusStudyAgenda({ window: resolveStudyWindow('今天', now)!, now, courses: [], assignments: [
    { title: '上午截止', groupName: '', dueAt: '2026-10-27T01:00:00Z' },
  ] });
  expect(result.days[0].deadlines[0].overdue).toBe(true);
  expect(formatCampusStudyAgenda(result)[0]).toContain('期限已過，需核對');
});

test('keeps source objects unchanged', () => {
  const before = JSON.stringify(context);
  const result = agenda();
  result.days[0].courses[0].name = 'changed output';
  expect(JSON.stringify(context)).toBe(before);
});

test('all fetched deadlines survive the planner three-card priority limit', () => {
  const result = buildOfflineCampusPlan({ question: '安排未來七天', context, snapshot, uid: 'A' })!;
  expect(result.steps.filter((step) => step.evidence === 'authorized-assignments')).toHaveLength(3);
  expect(result.agenda?.days.flatMap((day) => day.deadlines)).toHaveLength(5);
  expect(result.content).toContain('任務5');
});

test.each(['other-user', 'other-school', 'expired'])('agenda does not expose unauthorized snapshot: %s', (kind) => {
  const changed = { ...snapshot };
  if (kind === 'other-user') changed.userId = 'B';
  if (kind === 'other-school') changed.schoolId = 'other';
  if (kind === 'expired') changed.checkedAt = new Date(now - 3600000).toISOString();
  const result = buildOfflineCampusPlan({ question: '安排未來七天', context, snapshot: changed, uid: 'A' })!;
  expect(result.agenda?.assignmentsAvailable).toBe(false);
  expect(JSON.stringify(result)).not.toContain('任務1');
  expect(result.agenda?.days[1].courses[0].name).toBe('星期三課程');
});

test('rejects invalid or unbounded calendar windows', () => {
  expect(resolveStudyWindow('本週', NaN)).toBeNull();
  expect(() => buildCampusStudyAgenda({ window: { startDay: 0, endDay: 1000, title: '' }, now, courses: [], assignments: [] }))
    .toThrow('Invalid study window');
});

test('interval results agree with an independent occupancy reference over 200 deterministic cases', () => {
  let seed = 71321;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let run = 0; run < 200; run += 1) {
    const rows = Array.from({ length: 1 + Math.floor(random() * 10) }, (_, i) => {
      const start = 1 + Math.floor(random() * 14);
      return course('C' + i, 1, start, start + Math.floor(random() * 6));
    });
    const counts = Array<number>(25).fill(0);
    for (const row of rows) for (let i = row.start; i <= row.end; i += 1) counts[i] += 1;
    const result = inspectCoursePeriods(rows);
    const min = Math.min(...rows.map((row) => row.start));
    const max = Math.max(...rows.map((row) => row.end));
    for (let i = min; i <= max; i += 1) {
      expect(result.gaps.some((gap) => gap.start <= i && gap.end >= i)).toBe(counts[i] === 0);
      expect(result.conflicts.some((gap) => gap.start <= i && gap.end >= i)).toBe(counts[i] >= 2);
    }
  }
});
