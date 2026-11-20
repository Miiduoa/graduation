import { describe, expect, it } from 'vitest';
import type { HomeTask } from './homeOverview';
import {
  assignmentSubmitHref,
  courseWeekHref,
  resolveTimetableCourseWorkHref,
  TIMETABLE_COURSE_WORK_FALLBACK,
  todayTodosFromHomeTasks,
} from './todayScreen';

const task: HomeTask = {
  id: 'work', courseId: 'course', courseName: '資料庫', title: '期末報告', dueAt: null,
};

describe('today task destinations', () => {
  it('keeps undated assignments and quizzes while rejecting invalid timestamps', () => {
    const rows = todayTodosFromHomeTasks([
      task,
      { ...task, id: 'quiz', kind: 'quiz', href: '/classroom/course/course#quiz-quiz' },
      { ...task, id: 'bad-date', dueAt: 'invalid-date' },
    ]);
    expect(rows.map((row) => [row.id, row.dueAt])).toEqual([
      ['course:work', null], ['course:quiz', null],
    ]);
    expect(rows[1].href).toBe('/classroom/course/course#quiz-quiz');
  });

  it('only adds a submission anchor on school courses that provide that form', () => {
    const [row] = todayTodosFromHomeTasks([task]);
    expect(assignmentSubmitHref(row)).toBe('/course/course#assignment-work-submit');
    for (const kind of ['assignment', 'quiz']) {
      const href = `/classroom/course/cw_123#${kind}-work`;
      expect(assignmentSubmitHref({ ...row, href })).toBe(href);
    }
  });

  it('routes course shells with the same courseWorkLanding path rules', () => {
    expect(courseWeekHref('cs-db')).toBe('/course/cs-db#week');
    expect(
      courseWeekHref('cw_12345678-1234-1234-1234-123456789abc'),
    ).toBe('/classroom/course/cw_12345678-1234-1234-1234-123456789abc#week');
    expect(courseWeekHref(undefined)).toBe('/timetable');
  });

  it('resolves timetable course-work exits only from linked ids, never by course name', () => {
    expect(
      resolveTimetableCourseWorkHref({
        linkedCourseId: 'cs-db',
        courseName: '資料庫',
      }),
    ).toBe('/course/cs-db');
    expect(
      resolveTimetableCourseWorkHref({
        courseName: '資料庫系統',
        courses: [{ id: 'cw_12345678-1234-1234-1234-123456789abc', name: '資料庫系統' }],
      }),
    ).toBe(TIMETABLE_COURSE_WORK_FALLBACK);
    expect(
      resolveTimetableCourseWorkHref({
        courseName: '未連結課程',
      }),
    ).toBe(TIMETABLE_COURSE_WORK_FALLBACK);
  });
});
