import {
  formatTodayHeaderDate,
  formatTodoDueLine,
  pickNextAction,
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

test('30 分鐘內有課時選下一堂課', () => {
  const current = new Date('2026-10-25T09:50:00+08:00');
  expect(pickNextAction([klass()], [todo()], current)).toEqual({ type: 'class', class: klass() });
});

test('24 小時內有未交作業截止時選今天截止', () => {
  const current = new Date('2026-10-25T08:00:00+08:00');
  const laterClass = klass({
    startAt: Date.parse('2026-10-25T16:10:00+08:00'),
    endAt: Date.parse('2026-10-25T18:00:00+08:00'),
  });
  expect(pickNextAction([laterClass], [todo()], current)).toEqual({ type: 'assignment', todo: todo() });
});

test('今天後面還有課時選下一堂課', () => {
  const laterDue = todo({ dueAt: Date.parse('2026-10-27T23:59:00+08:00') });
  expect(pickNextAction([klass()], [laterDue], new Date('2026-10-25T08:00:00+08:00'))).toEqual({
    type: 'class',
    class: klass(),
  });
});

test('都沒有時回傳空狀態', () => {
  expect(pickNextAction([], [], now)).toEqual({ type: 'empty' });
});

test('跨午夜只算台北同一曆日', () => {
  const dueSoon = todo({ dueAt: Date.parse('2026-10-25T00:30:00+08:00') });
  expect(
    pickNextAction(
      [
        klass({
          startAt: Date.parse('2026-10-24T23:00:00+08:00'),
          endAt: Date.parse('2026-10-24T23:50:00+08:00'),
        }),
      ],
      [dueSoon],
      new Date('2026-10-24T23:50:00+08:00'),
    ),
  ).toEqual({ type: 'assignment', todo: dueSoon });
});

test('逾期兩天寫已逾期 2 天，且不佔 24 小時截止', () => {
  const overdue = todo({ dueAt: Date.parse('2026-10-23T23:59:00+08:00') });
  expect(pickNextAction([], [overdue], now)).toEqual({ type: 'empty' });
  expect(formatTodoDueLine(overdue, now)).toBe(TODAY_COPY.overdueDays(2));
  expect(formatTodayHeaderDate(now)).toBe('10月25日 週日');
});
