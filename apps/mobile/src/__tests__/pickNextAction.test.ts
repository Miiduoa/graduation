import {
  formatTodayHeaderDate,
  formatTodoDeadlineLabel,
  formatTodoDueLine,
  formatUpcomingDueLine,
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

test('24 小時內有未交作業截止時優先顯示待辦', () => {
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

test('只有逾期未交、今天沒課時選最早逾期的那筆，不當成空狀態', () => {
  const laterOverdue = todo({
    id: 'hw-new',
    dueAt: Date.parse('2026-10-24T23:59:00+08:00'),
  });
  const overdue = todo({ dueAt: Date.parse('2026-10-23T23:59:00+08:00') });
  expect(pickNextAction([], [laterOverdue, overdue], now)).toEqual({ type: 'overdue', todo: overdue });
  expect(formatTodoDueLine(overdue, now)).toBe(TODAY_COPY.overdueDays(1));
  expect(formatTodayHeaderDate(now)).toBe('10月25日 週日');
});

test('正在上的課也算 30 分鐘內有課', () => {
  expect(pickNextAction([klass()], [todo()], new Date('2026-10-25T11:00:00+08:00'))).toEqual({
    type: 'class',
    class: klass(),
  });
});

test('今天沒課且超過 24 小時才截止的未交是下一件作業，不是今天截止', () => {
  const laterDue = todo({ dueAt: Date.parse('2026-10-28T23:59:00+08:00') });
  expect(pickNextAction([], [laterDue], now)).toEqual({ type: 'upcoming', todo: laterDue });
  expect(formatUpcomingDueLine(laterDue)).toBe('10/28 週三 23:59 截止');
  expect(TODAY_COPY.nextAssignment).toBe('下一件作業');
  expect(pickNextAction([], [], now)).toEqual({ type: 'empty' });
});

test('明天凌晨到期保留優先級並顯示正確日期和分鐘', () => {
  const current = new Date('2026-12-31T23:50:00+08:00');
  const work = todo({ dueAt: Date.parse('2027-01-01T00:10:00+08:00') });
  expect(pickNextAction([], [work], current)).toEqual({ type: 'assignment', todo: work });
  expect(formatTodoDeadlineLabel(work, current)).toBe('明天截止');
  expect(formatTodoDueLine(work, current)).toBe('明天 00:10 截止・還剩 20 分鐘');
});

test('不足一分鐘不顯示還有一小時，午夜剛過不算逾期一天', () => {
  const current = new Date('2026-11-02T23:59:30+08:00');
  expect(formatTodoDueLine(todo({ dueAt: current.getTime() + 30_000 }), current))
    .toBe('明天 00:00 截止・不到 1 分鐘');
  expect(formatTodoDueLine(
    todo({ dueAt: Date.parse('2026-11-02T23:59:00+08:00') }),
    new Date('2026-11-03T00:01:00+08:00'),
  )).toBe('已逾期');
});

test('無效時間不顯示 NaN，沒有截止時間保留未知狀態', () => {
  expect(formatTodoDeadlineLabel(todo({ dueAt: NaN }), now)).toBe('截止時間待確認');
  expect(formatTodoDueLine(todo(), new Date(NaN))).toBe('截止時間待確認');
  expect(formatTodoDeadlineLabel(todo({ dueAt: null }), now)).toBe('未設截止時間');
});
