import { describe, expect, it } from 'vitest';
import type { TodayClass, TodayTodo } from '@campus/shared/src/pickNextAction';
import { isCurrentPriorityTerm, pickTodayPriority } from '@campus/shared/src/todayPriority';

const at = (clock: string) => Date.parse('2026-11-24T' + clock + ':00+08:00');
const now = new Date(at('09:50'));
const course: TodayClass = {
  id: 'class-1', title: '統計學', location: 'B203', startAt: at('10:00'), endAt: at('12:00'),
};
const quiz: TodayTodo = {
  id: 'quiz-1', title: '隨堂測驗', courseName: '經濟學', dueAt: at('11:00'),
};

describe('today priority', () => {
  it('accepts equivalent academic year formats and switches semesters at Taipei midnight', () => {
    expect(isCurrentPriorityTerm('2026學年度|上學期', now)).toBe(true);
    expect(isCurrentPriorityTerm('115|1', new Date('2027-01-31T15:59:59Z'))).toBe(true);
    expect(isCurrentPriorityTerm('115|1', new Date('2027-01-31T16:00:00Z'))).toBe(false);
    for (const term of ['116|1', '114|1', '115|暑期', '115', '115|1|2', undefined]) {
      expect(isCurrentPriorityTerm(term, now)).toBe(false);
    }
  });

  it('uses records and Taipei clocks from two different courses and retains the exact target', () => {
    const laterCopy = { ...quiz, id: 'quiz-2', dueAt: at('11:30') };
    const result = pickTodayPriority([course], [laterCopy, quiz], now);
    expect(result?.kind).toBe('deadline-during-class');
    expect(result?.todo).toBe(quiz);
    expect(result?.reason).toContain('「統計學」10:00–12:00');
    expect(result?.reason).toContain('11:00 截止');
    expect(result?.reason).toContain('上課前');
  });

  it('includes the start instant but excludes the end of class and expired deadlines', () => {
    const priorityAt = (dueAt: number, time = at('09:50')) =>
      pickTodayPriority([course], [{ ...quiz, dueAt }], new Date(time));
    expect(priorityAt(course.startAt)?.kind).toBe('deadline-during-class');
    expect(priorityAt(course.endAt)?.kind).toBe('class');
    expect(priorityAt(at('11:00'), at('10:30'))?.reason).toContain('課已經開始');
    expect(priorityAt(at('11:00'), at('11:01'))?.kind).toBe('class');
  });

  it('does not let a later conflict displace an earlier deadline', () => {
    const early = { ...quiz, id: 'earlier', dueAt: at('09:55') };
    const result = pickTodayPriority([course], [quiz, early], now);
    expect(result?.kind).toBe('todo');
    expect(result?.todo).toBe(early);
  });

  it('drops malformed, undated and other-day rows, including tomorrow in Taipei', () => {
    const tomorrow = Date.parse('2026-11-24T16:00:00Z');
    const tasks = [tomorrow, at('00:00') - 1, null, NaN].map(dueAt => ({ ...quiz, dueAt }));
    expect(pickTodayPriority([{ ...course, endAt: NaN }], tasks, now)).toBeNull();
    expect(pickTodayPriority([course], [quiz], new Date(NaN))).toBeNull();
    expect(pickTodayPriority([{ ...course, endAt: course.startAt }], [], now)).toBeNull();
  });

  it('keeps an overnight class that is still under way after Taipei midnight', () => {
    const overnight = { ...course, startAt: at('00:00') - 60 * 60_000, endAt: at('02:00') };
    const afterMidnight = new Date(at('00:15'));
    expect(pickTodayPriority([overnight], [], afterMidnight)?.course).toBe(overnight);
    const result = pickTodayPriority([overnight], [{ ...quiz, dueAt: at('01:00') }], afterMidnight);
    expect(result?.kind).toBe('deadline-during-class');
  });

  it('distinguishes an overdue item from an actionable future deadline', () => {
    const result = pickTodayPriority([], [quiz], new Date(at('15:00')));
    expect(result?.kind).toBe('todo');
    expect(result?.reason).toContain('今天 11:00 已截止');
  });
});
