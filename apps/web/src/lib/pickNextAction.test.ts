import { describe, expect, it } from 'vitest';
import {
  formatTodayHeaderDate,
  formatTodoDueLine,
  formatUpcomingDueLine,
  pickNextAction,
  sortTodayClasses,
  sortTodayTodos,
  isTodoOverdue,
  isDueWithinHours,
  TODAY_COPY,
  type TodayClass,
  type TodayTodo,
} from '@campus/shared/src/pickNextAction';

const now = new Date('2026-10-25T02:00:00+08:00');

function klass(overrides: Partial<TodayClass> = {}): TodayClass {
  return {
    id: 'class-db',
    title: '資料庫系統',
    location: '管理大樓 M302',
    startAt: Date.parse('2026-10-25T10:10:00+08:00'),
    endAt: Date.parse('2026-10-25T12:00:00+08:00'),
    courseId: 'cs-db',
    ...overrides,
  };
}

function todo(overrides: Partial<TodayTodo> = {}): TodayTodo {
  return {
    id: 'hw-3',
    title: '作業三 繳交',
    courseName: '資料庫系統',
    courseId: 'cs-db',
    dueAt: Date.parse('2026-10-25T23:59:00+08:00'),
    ...overrides,
  };
}

describe('pickNextAction', () => {
  it('30 分鐘內有課時選下一堂課', () => {
    const current = new Date('2026-10-25T09:50:00+08:00');
    const action = pickNextAction([klass()], [todo()], current);
    expect(action).toEqual({ type: 'class', class: klass() });
  });

  it('24 小時內有未交作業截止時選今天截止', () => {
    const current = new Date('2026-10-25T08:00:00+08:00');
    const laterClass = klass({ startAt: Date.parse('2026-10-25T16:10:00+08:00'), endAt: Date.parse('2026-10-25T18:00:00+08:00') });
    const action = pickNextAction([laterClass], [todo()], current);
    expect(action).toEqual({ type: 'assignment', todo: todo() });
  });

  it('今天後面還有課時選下一堂課', () => {
    const current = new Date('2026-10-25T08:00:00+08:00');
    const laterDue = todo({ dueAt: Date.parse('2026-10-27T23:59:00+08:00') });
    const action = pickNextAction([klass()], [laterDue], current);
    expect(action).toEqual({ type: 'class', class: klass() });
  });

  it('都沒有時回傳空狀態', () => {
    const action = pickNextAction([], [], now);
    expect(action).toEqual({ type: 'empty' });
  });

  it('跨午夜後不把已過的日曆日當成今天的課', () => {
    const late = new Date('2026-10-24T23:50:00+08:00');
    const tonightClass = klass({
      startAt: Date.parse('2026-10-24T23:00:00+08:00'),
      endAt: Date.parse('2026-10-24T23:50:00+08:00'),
    });
    const afterMidnight = klass({
      id: 'class-next-day',
      startAt: Date.parse('2026-10-25T00:10:00+08:00'),
      endAt: Date.parse('2026-10-25T02:00:00+08:00'),
    });
    const dueSoon = todo({ dueAt: Date.parse('2026-10-25T00:30:00+08:00') });
    expect(pickNextAction([tonightClass, afterMidnight], [dueSoon], late)).toEqual({
      type: 'assignment',
      todo: dueSoon,
    });
    expect(pickNextAction([tonightClass], [], new Date('2026-10-25T00:20:00+08:00'))).toEqual({
      type: 'empty',
    });
  });

  it('只有逾期未交、今天沒課時選最早逾期的那筆，不當成空狀態', () => {
    const laterOverdue = todo({
      id: 'hw-new',
      dueAt: Date.parse('2026-10-24T23:59:00+08:00'),
    });
    const overdue = todo({
      dueAt: Date.parse('2026-10-23T23:59:00+08:00'),
    });
    expect(pickNextAction([], [laterOverdue, overdue], now)).toEqual({ type: 'overdue', todo: overdue });
    expect(formatTodoDueLine(overdue, now)).toBe(TODAY_COPY.overdueDays(2));
  });

  it('正在上的課也算 30 分鐘內有課', () => {
    const current = new Date('2026-10-25T11:00:00+08:00');
    expect(pickNextAction([klass()], [todo()], current)).toEqual({ type: 'class', class: klass() });
  });

  it('今天沒課且超過 24 小時才截止的未交是下一件作業，不是今天截止', () => {
    const laterDue = todo({ dueAt: Date.parse('2026-10-28T23:59:00+08:00') });
    expect(pickNextAction([], [laterDue], now)).toEqual({ type: 'upcoming', todo: laterDue });
    expect(formatUpcomingDueLine(laterDue)).toBe('10/28 週三 23:59 截止');
    expect(pickNextAction([], [], now)).toEqual({ type: 'empty' });
  });

  it('今天課都結束但仍有逾期未交時選逾期', () => {
    const ended = klass({
      startAt: Date.parse('2026-10-25T08:00:00+08:00'),
      endAt: Date.parse('2026-10-25T10:00:00+08:00'),
    });
    const overdue = todo({ dueAt: Date.parse('2026-10-23T23:59:00+08:00') });
    expect(pickNextAction([ended], [overdue], new Date('2026-10-25T12:00:00+08:00'))).toEqual({
      type: 'overdue',
      todo: overdue,
    });
  });

  it('今天的課都結束後帶最近一筆作業', () => {
    const ended = klass({
      startAt: Date.parse('2026-10-25T08:00:00+08:00'),
      endAt: Date.parse('2026-10-25T10:00:00+08:00'),
    });
    const laterHomework = todo({ dueAt: Date.parse('2026-10-28T23:59:00+08:00') });
    const current = new Date('2026-10-25T12:00:00+08:00');
    expect(pickNextAction([ended], [laterHomework], current)).toEqual({
      type: 'allDone',
      todo: laterHomework,
    });
    expect(pickNextAction([ended], [], current)).toEqual({ type: 'allDone', todo: null });
  });
});

describe('today screen copy and ordering', () => {
  it('keeps undated work visible after dated work without inventing a deadline', () => {
    const undated = todo({ id: 'undated', dueAt: null });
    const scheduled = todo();
    expect(sortTodayTodos([undated, scheduled])).toEqual([scheduled, undated]);
    expect(pickNextAction([], [undated], now)).toEqual({ type: 'upcoming', todo: undated });
    expect(formatTodoDueLine(undated, now)).toBe('未設截止時間');
    expect(formatUpcomingDueLine(undated)).toBe('未設截止時間');
    expect(isTodoOverdue(undated, now)).toBe(false);
    expect(isDueWithinHours(undated, now, 24)).toBe(false);
  });

  it('retains undated work after classes finish and excludes malformed dates', () => {
    const undated = todo({ dueAt: null });
    const ended = klass();
    expect(pickNextAction([ended], [undated], new Date('2026-10-25T20:00:00+08:00')))
      .toEqual({ type: 'allDone', todo: undated });
    expect(sortTodayTodos([todo({ id: 'invalid', dueAt: NaN }), undated])).toEqual([undated]);
  });

  it('頁首日期用台北曆日', () => {
    expect(formatTodayHeaderDate(now)).toBe('10月25日 週日');
  });

  it('空狀態句子鎖定', () => {
    expect(TODAY_COPY.unsigned).toBe('登入後，這裡會列出近期要處理的課程待辦。');
    expect(TODAY_COPY.emptyDay).toBe('今天沒有課，也沒有要交的作業。');
    expect(TODAY_COPY.allClassesDone).toBe('今天的課都結束了');
    expect(TODAY_COPY.timetableUnavailable).toBe('暫時讀不到課表');
    expect(TODAY_COPY.retry).toBe('再試一次');
    expect(TODAY_COPY.noTimetable).toBe('還沒有課表。');
    expect(TODAY_COPY.importTimetable).toBe('匯入課表');
    expect(TODAY_COPY.lmsUnconnected).toBe('前往 nuni 課程查看作業與測驗。');
    expect(TODAY_COPY.nextAssignment).toBe('下一件作業');
  });

  it('已上完的課排到下面', () => {
    const current = new Date('2026-10-25T10:00:00+08:00');
    const ended = klass({
      id: 'ended',
      startAt: Date.parse('2026-10-25T08:00:00+08:00'),
      endAt: Date.parse('2026-10-25T09:00:00+08:00'),
    });
    const upcoming = klass({ id: 'next' });
    expect(sortTodayClasses([ended, upcoming], current).map((item) => item.id)).toEqual([
      'next',
      'ended',
    ]);
  });
});
