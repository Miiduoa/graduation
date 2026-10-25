import { describe, expect, it } from 'vitest';
import type { HomeTask } from './homeOverview';
import { assignmentSubmitHref, todayTodosFromHomeTasks } from './todayScreen';

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
});
