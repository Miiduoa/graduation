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

  it('rechecks the same loaded work as time passes without removing reference deadlines', () => {
    const dueAt = '2026-11-02T10:00:00+08:00';
    const tasks: HomeTask[] = [
      { ...task, id: 'strict', dueAt, acceptsLate: false },
      { ...task, id: 'late-allowed', dueAt, acceptsLate: true },
      {
        ...task,
        id: 'nuni',
        dueAt,
        acceptsLate: true,
        href: '/classroom/course/cw_123#assignment-nuni',
      },
      { ...task, id: 'unknown-policy', dueAt },
      { ...task, id: 'no-deadline', acceptsLate: false },
    ];

    const before = todayTodosFromHomeTasks(tasks, new Date('2026-11-02T09:59:59+08:00'));
    const atDeadline = todayTodosFromHomeTasks(tasks, new Date(dueAt));
    const after = todayTodosFromHomeTasks(tasks, new Date('2026-11-02T10:00:00.001+08:00'));

    expect(before.map((row) => row.id)).toEqual(tasks.map((row) => `course:${row.id}`));
    expect(atDeadline).toEqual(before);
    expect(after.map((row) => row.id)).toEqual([
      'course:late-allowed',
      'course:nuni',
      'course:unknown-policy',
      'course:no-deadline',
    ]);
    expect(after.find((row) => row.id === 'course:nuni')?.href).toBe(
      '/classroom/course/cw_123#assignment-nuni',
    );
    expect(tasks).toHaveLength(5);
  });

  it('uses the accepted Taipei wall-time contract when rechecking deadlines', () => {
    const work = { ...task, dueAt: '2026-11-02T10:00:00', acceptsLate: false };
    expect(todayTodosFromHomeTasks([work], new Date('2026-11-02T01:59:59Z'))).toHaveLength(1);
    expect(todayTodosFromHomeTasks([work], new Date('2026-11-02T02:00:01Z'))).toEqual([]);
  });

  it.each([undefined, null, new Date(NaN)])(
    'does not guess deadline eligibility without a valid reference clock (%s)',
    (now) => {
      const work = { ...task, dueAt: '2000-01-01T00:00:00Z', acceptsLate: false };
      expect(todayTodosFromHomeTasks([work], now)).toHaveLength(1);
      expect(todayTodosFromHomeTasks([work])).toHaveLength(1);
    },
  );

  it('only adds a submission anchor on school courses that provide that form', () => {
    const [row] = todayTodosFromHomeTasks([task]);
    expect(assignmentSubmitHref(row)).toBe('/course/course#assignment-work-submit');
    for (const kind of ['assignment', 'quiz']) {
      const href = `/classroom/course/cw_123#${kind}-work`;
      expect(assignmentSubmitHref({ ...row, href })).toBe(href);
    }
  });
});
