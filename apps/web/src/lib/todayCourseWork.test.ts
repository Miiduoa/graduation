import { expect, it } from 'vitest';
import type { HomeTask } from './homeOverview';
import {
  CALENDAR_DUE_TITLE,
  LATER_WORK_TITLE,
  TODAY_WORK_EMPTY,
  TODAY_WORK_NO_CLASS,
  TODAY_WORK_UNSIGNED,
  calendarDueItemsFromTasks,
  calendarDueItemsInMonth,
  calendarDueItemsOnDate,
  courseTaskHref,
  selectLaterCourseWork,
  selectTodayCourseWork,
} from './todayCourseWork';

const now = new Date('2026-10-22T04:00:00.000Z');

function task(overrides: Partial<HomeTask>): HomeTask {
  return {
    id: 'hw-1',
    courseId: 'cs101',
    courseName: '資料結構',
    title: '習題一',
    dueAt: '2026-10-22T10:00:00.000Z',
    ...overrides,
  };
}

it('keeps every course item due today or overdue, including undated open work', () => {
  const overdue = task({
    id: 'late',
    courseId: 'zh',
    courseName: '國文',
    title: '作文',
    dueAt: '2026-10-21T15:00:00.000Z',
    href: '/classroom/course/zh#assignment-late',
  });
  const todayQuiz = task({
    kind: 'quiz',
    id: 'quiz-1',
    courseId: 'phys',
    courseName: '普物',
    title: '小考',
    dueAt: '2026-10-22T10:00:00.000Z',
    href: '/classroom/course/phys#quiz-quiz-1',
  });
  const undated = task({
    id: 'open',
    courseId: 'design',
    title: '隨堂練習',
    dueAt: null,
    href: '/classroom/course/design#assignment-open',
  });
  const tomorrow = task({
    id: 'later',
    title: '期末報告',
    dueAt: '2026-10-23T04:00:00.000Z',
    href: '/classroom/course/cs101#assignment-later',
  });
  const input = [overdue, todayQuiz, undated, tomorrow];
  const today = selectTodayCourseWork(input, now);
  expect(today.map((item) => item.id)).toEqual(['late', 'quiz-1', 'open']);
  expect(today[0]).toBe(overdue);
  expect(today[1]).toBe(todayQuiz);
  expect(today[2]).toBe(undated);
  expect(today.map((item) => item.dueAt)).toEqual([
    '2026-10-21T15:00:00.000Z',
    '2026-10-22T10:00:00.000Z',
    null,
  ]);
  expect(selectLaterCourseWork(input, now).map((item) => item.id)).toEqual(['later']);
});

it('does not invent sample work or rewrite deadlines when the list is empty', () => {
  expect(selectTodayCourseWork([], now)).toEqual([]);
  expect(TODAY_WORK_EMPTY).toBe('今天沒有要交的');
  expect(TODAY_WORK_NO_CLASS).toBe('尚未加入課班，可以先匯入課表');
  expect(TODAY_WORK_UNSIGNED).toContain('登入後');
  expect(LATER_WORK_TITLE).toBe('稍後要交');
});

it('drops a due timestamp that cannot be read instead of filling a fake day', () => {
  const broken = task({ dueAt: 'not-a-date' });
  expect(selectTodayCourseWork([broken], now)).toEqual([]);
  expect(selectLaterCourseWork([broken], now)).toEqual([]);
  expect(broken.dueAt).toBe('not-a-date');
});

it('lists more than five today items from different courses without capping', () => {
  const input = Array.from({ length: 6 }, (_, index) =>
    task({
      id: `hw-${index}`,
      courseId: `course-${index}`,
      courseName: `課程 ${index}`,
      title: `作業 ${index}`,
      href: `/classroom/course/course-${index}#assignment-hw-${index}`,
    }),
  );
  const today = selectTodayCourseWork(input, now);
  expect(today).toHaveLength(6);
  expect(today.map((item) => item.href)).toEqual(input.map((item) => item.href));
});

it('opens the real assignment or quiz hash and never swaps a quiz onto an assignment panel', () => {
  const assignment = task({
    href: '/classroom/course/cs101#assignment-hw-1',
  });
  const quiz = task({
    kind: 'quiz',
    id: 'quiz-1',
    href: '/classroom/course/phys#quiz-quiz-1',
  });
  expect(courseTaskHref(assignment)).toBe('/classroom/course/cs101#assignment-hw-1');
  expect(courseTaskHref(quiz)).toBe('/classroom/course/phys#quiz-quiz-1');
  expect(
    courseTaskHref({
      kind: 'quiz',
      id: 'q1',
      courseId: 'phys',
      courseName: '普物',
      title: '小考',
      dueAt: null,
    }),
  ).toBe('/course/phys#quiz-q1');
});

it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/login?returnUrl=https://evil.test'])(
  'does not open an off-site or login path from a task href: %s',
  (href) => {
    expect(
      courseTaskHref(
        task({
          href,
        }),
      ),
    ).toBe('/course/cs101#assignment-hw-1');
    expect(
      courseTaskHref(
        task({
          kind: 'quiz',
          id: 'q1',
          courseId: 'phys',
          href,
        }),
      ),
    ).toBe('/course/phys#quiz-q1');
  },
);

it('builds calendar due items for dated work and filters by day or month', () => {
  const input = [
    task({ id: 'a', dueAt: '2026-10-22T10:00:00.000Z', href: '/course/cs101#assignment-a' }),
    task({
      id: 'b',
      courseId: 'zh',
      courseName: '國文',
      dueAt: '2026-10-28T02:00:00.000Z',
      href: '/course/zh#assignment-b',
    }),
    task({ id: 'open', dueAt: null }),
    task({ id: 'bad', dueAt: 'not-a-date' }),
  ];
  const dues = calendarDueItemsFromTasks(input);
  expect(CALENDAR_DUE_TITLE).toBe('作業截止');
  expect(dues.map((item) => item.id)).toEqual(['cs101:a', 'zh:b']);
  expect(dues[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(calendarDueItemsOnDate(dues, dues[0].dueDate).map((item) => item.id)).toEqual(['cs101:a']);
  expect(calendarDueItemsInMonth(dues, dues[0].dueDate.slice(0, 7)).map((item) => item.id)).toEqual([
    'cs101:a',
    'zh:b',
  ]);
  expect(calendarDueItemsInMonth(dues, '2026-11')).toEqual([]);
});
