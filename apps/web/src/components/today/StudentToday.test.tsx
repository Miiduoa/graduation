import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TODAY_COPY, type TodayClass, type TodayTodo } from '@campus/shared/src/pickNextAction';
import { StudentToday } from './StudentToday';
import styles from './StudentToday.module.css';

const now = new Date('2026-10-25T09:50:00+08:00');

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
    href: '/course/cs-db#assignment-hw-3',
    ...overrides,
  };
}

beforeEach(() => {
  window.scrollTo = vi.fn();
});

function todayElement(overrides: Partial<ComponentProps<typeof StudentToday>> = {}) {
  return (
    <StudentToday
      now={now}
      updatedAt={now}
      unsigned={false}
      skeleton={false}
      classes={[]}
      todos={[]}
      timetableStatus="ready"
      todosError=""
      lmsUnconnected={false}
      onRetryTimetable={vi.fn()}
      onRetryTodos={vi.fn()}
      importHref="/import?kind=timetable&campus=pu"
      weekHref="/timetable?campus=pu"
      timetableHref="/timetable?campus=pu"
      {...overrides}
    />
  );
}

function view(overrides: Partial<ComponentProps<typeof StudentToday>> = {}) {
  return render(todayElement(overrides));
}

it('shows the next class on the only solid card', () => {
  view({ classes: [klass()], todos: [todo()] });
  const card = screen.getByTestId('next-action');
  expect(card.textContent).toContain(TODAY_COPY.nextClass);
  expect(card.textContent).toContain('資料庫系統');
  expect(card.textContent).toContain('10:10・管理大樓 M302');
  expect(screen.getByRole('link', { name: TODAY_COPY.viewCourse }).getAttribute('href')).toBe(
    '/course/cs-db#week',
  );
  expect(screen.queryByText(/為你推薦|智慧|AI 幫你/)).toBeNull();
});

it('uses the assignment card when the next class is later and work is due within 24 hours', () => {
  view({
    now: new Date('2026-10-25T08:00:00+08:00'),
    classes: [
      klass({
        startAt: Date.parse('2026-10-25T16:10:00+08:00'),
        endAt: Date.parse('2026-10-25T18:00:00+08:00'),
      }),
    ],
    todos: [todo()],
  });
  expect(screen.getByTestId('next-action').textContent).toContain(TODAY_COPY.dueToday);
  expect(screen.getByRole('link', { name: TODAY_COPY.goSubmit }).getAttribute('href')).toBe(
    '/course/cs-db#assignment-hw-3-submit',
  );
});

it('names tomorrow when a deadline is within 24 hours but after Taipei midnight', () => {
  view({
    now: new Date('2026-12-31T23:50:00+08:00'),
    todos: [todo({ dueAt: Date.parse('2027-01-01T00:10:00+08:00') })],
  });
  const card = screen.getByTestId('next-action');
  expect(card.textContent).toContain('明天截止');
  expect(card.textContent).toContain('明天 00:10 截止・還剩 20 分鐘');
  expect(card.textContent).not.toContain(TODAY_COPY.dueToday);
  expect(within(card).getByRole('link', { name: TODAY_COPY.goSubmit }).getAttribute('href')).toBe(
    '/course/cs-db#assignment-hw-3-submit',
  );
});

it('keeps the remaining minutes visible for an imminent deadline', () => {
  view({
    now: new Date('2026-11-02T23:58:30+08:00'),
    todos: [todo({ dueAt: Date.parse('2026-11-02T23:59:00+08:00') })],
  });
  expect(screen.getByTestId('next-action').textContent).toContain('不到 1 分鐘');
  expect(screen.getByTestId('next-action').textContent).not.toContain('還剩 1 小時');
});

it('shows the unsigned sentence when the student is not signed in', () => {
  view({ unsigned: true, timetableStatus: 'empty' });
  expect(screen.getAllByText(TODAY_COPY.unsigned).length).toBeGreaterThan(0);
  expect(screen.getByText(TODAY_COPY.noTimetable)).toBeTruthy();
  expect(screen.getByRole('link', { name: TODAY_COPY.importTimetable }).getAttribute('href')).toBe(
    '/import?kind=timetable&campus=pu',
  );
});

it('opens the existing week for a guest without classes on Sunday instead of restarting setup', () => {
  view({ unsigned: true, timetableStatus: 'ready', classes: [], todos: [] });
  expect(screen.getByRole('heading', { name: '課表準備好了。' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '先把課表放進來。' })).toBeNull();
  expect(screen.getByRole('link', { name: '查看這週課表' }).getAttribute('href')).toBe(
    '/timetable?campus=pu',
  );
  expect(screen.getByRole('link', { name: /更新匯入紀錄/ }).getAttribute('href')).toBe(
    '/import?kind=timetable&campus=pu',
  );
});

it('shows the empty-day sentence and the week button', () => {
  view({ classes: [], todos: [], timetableStatus: 'ready' });
  expect(screen.getByText(TODAY_COPY.emptyDay)).toBeTruthy();
  expect(screen.getByRole('link', { name: TODAY_COPY.viewWeek })).toBeTruthy();
});

it.each(['loading', 'empty', 'error', 'unsigned-scope'] as const)(
  'does not declare an empty day before the timetable is confirmed (%s)',
  (timetableStatus) => {
    view({ timetableStatus, classes: [], todos: [] });
    expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
    expect(screen.getByTestId('next-action').textContent?.trim()).not.toBe('');
  },
);

it('keeps a known task actionable while timetable data is still loading', () => {
  view({ timetableStatus: 'loading', todos: [todo()] });
  expect(screen.getByTestId('next-action').textContent).toContain('作業三 繳交');
  expect(screen.getByRole('link', { name: TODAY_COPY.goSubmit })).toBeTruthy();
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
});

it('does not declare there are no assignments when the course platform is unconnected', () => {
  view({ timetableStatus: 'ready', lmsUnconnected: true });
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
  expect(screen.getByRole('link', { name: '查看我的課程' }).getAttribute('href')).toBe('/classroom');
});

it('shows upcoming work due after 24 hours as the next assignment, not due today', () => {
  view({
    now: new Date('2026-10-25T02:00:00+08:00'),
    classes: [],
    todos: [todo({ dueAt: Date.parse('2026-10-28T23:59:00+08:00') })],
    timetableStatus: 'ready',
  });
  const card = screen.getByTestId('next-action');
  expect(card.textContent).toContain(TODAY_COPY.nextAssignment);
  expect(card.textContent).toContain('10/28 週三 23:59 截止');
  expect(card.textContent).not.toContain(TODAY_COPY.dueToday);
  expect(screen.getByRole('link', { name: TODAY_COPY.goSubmit })).toBeTruthy();
});

it('puts the earliest overdue item on the main card instead of the empty-day sentence', () => {
  view({
    now: new Date('2026-10-25T02:00:00+08:00'),
    classes: [],
    todos: [
      todo({
        id: 'hw-new',
        title: '作業四 繳交',
        dueAt: Date.parse('2026-10-24T23:59:00+08:00'),
      }),
      todo({ dueAt: Date.parse('2026-10-23T23:59:00+08:00') }),
    ],
    timetableStatus: 'ready',
  });
  const card = screen.getByTestId('next-action');
  expect(card.textContent).toContain(TODAY_COPY.overdue);
  expect(card.textContent).toContain('作業三 繳交');
  expect(card.textContent).toContain(TODAY_COPY.overdueDays(1));
  expect(card.querySelector(`.${styles.metaDanger}`)).toBeTruthy();
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
  expect(screen.getByRole('link', { name: TODAY_COPY.goSubmit }).getAttribute('href')).toBe(
    '/course/cs-db#assignment-hw-3-submit',
  );
});

it('says today classes are done after the last period', () => {
  view({
    now: new Date('2026-10-25T13:00:00+08:00'),
    classes: [klass()],
    todos: [],
  });
  expect(screen.getByText(TODAY_COPY.allClassesDone)).toBeTruthy();
});

it('keeps other blocks when the timetable cannot be read', () => {
  const retry = vi.fn();
  view({ timetableStatus: 'error', todos: [todo()], onRetryTimetable: retry });
  expect(screen.getByText(TODAY_COPY.timetableUnavailable)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: TODAY_COPY.retry }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getAllByText('作業三 繳交').length).toBeGreaterThan(0);
});

it('does not pretend LMS is empty when it is not connected', () => {
  view({ lmsUnconnected: true, todos: [] });
  expect(screen.getByText(/還沒有 nuni 課程資料/)).toBeTruthy();
});

it('shows skeleton bones instead of a spinner', () => {
  view({ skeleton: true });
  expect(screen.getByTestId('today-skeleton')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText(/載入中|讀取中/)).toBeNull();
});

it('opens the remaining tasks in place and keeps each original course destination', () => {
  view({
    todos: Array.from({ length: 5 }, (_, index) =>
      todo({
        id: `work-${index}`,
        title: `待辦 ${index + 1}`,
        href: `/course/cs-db#assignment-work-${index}`,
      }),
    ),
  });
  const list = within(screen.getByTestId('today-work-list'));
  expect(list.getAllByRole('link')).toHaveLength(3);
  const expand = list.getByRole('button', { name: '還有 2 件' });
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(expand);
  expect(list.getAllByRole('link')).toHaveLength(5);
  expect(list.getByRole('link', { name: /待辦 5/ }).getAttribute('href')).toBe(
    '/course/cs-db#assignment-work-4',
  );
  fireEvent.click(list.getByRole('button', { name: '收起待辦' }));
  expect(list.getAllByRole('link')).toHaveLength(3);
});

it('shows undated work and uses the platform task anchor on the next-action card', () => {
  const href = '/classroom/course/cw_123#assignment-final-report';
  view({ todos: [todo({ dueAt: null, href })] });
  expect(screen.queryByText(TODAY_COPY.emptyDay)).toBeNull();
  expect(screen.getAllByText(/未設截止時間/).length).toBeGreaterThan(0);
  const links = within(screen.getByTestId('next-action')).getAllByRole('link');
  expect(links.map((link) => link.getAttribute('href'))).toEqual([href, href]);
});

it('renders even when session storage is blocked by the browser', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  try {
    const page = view();
    expect(screen.getByRole('heading', { name: '今天' })).toBeTruthy();
    expect(() => page.unmount()).not.toThrow();
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});

it('updates a changed task payload without waiting for its identifier to change', () => {
  const page = view({ todos: [todo()] });
  page.rerender(
    todayElement({
      todos: [
        todo({
          title: '修正版作業',
          href: '/classroom/course/cw_123#assignment-revised',
          dueAt: Date.parse('2026-10-25T10:30:00+08:00'),
        }),
      ],
    }),
  );
  const card = screen.getByTestId('next-action');
  expect(card.textContent).toContain('修正版作業');
  expect(card.textContent).not.toContain('作業三 繳交');
  expect(card.textContent).toContain('今天 10:30 截止・還剩 40 分鐘');
  expect(within(card).getByRole('link', { name: TODAY_COPY.goSubmit }).getAttribute('href')).toBe(
    '/classroom/course/cw_123#assignment-revised',
  );
});

it('updates the current class room and destination when the class identifier stays unchanged', () => {
  const page = view({ classes: [klass()] });
  page.rerender(todayElement({ classes: [klass({ location: '新教室 201', courseId: 'cs-new' })] }));
  const card = screen.getByTestId('next-action');
  expect(card.textContent).toContain('新教室 201');
  expect(card.textContent).not.toContain('管理大樓 M302');
  expect(within(card).getByRole('link', { name: TODAY_COPY.viewCourse }).getAttribute('href')).toBe(
    '/course/cs-new#week',
  );
});

it('drops the previous action immediately on sign-out and on a different account or school scope', () => {
  const page = view({ scopeKey: 'account-a:pu', classes: [klass({ title: 'A 的私人課程' })] });
  page.rerender(
    todayElement({ scopeKey: 'account-b:pu', classes: [klass({ title: 'B 的私人課程' })] }),
  );
  expect(screen.getByTestId('next-action').textContent).toContain('B 的私人課程');
  expect(screen.queryByText('A 的私人課程')).toBeNull();
  page.rerender(
    todayElement({ scopeKey: 'account-b:nthu', todos: [todo({ title: '新校園待辦' })] }),
  );
  expect(screen.getByTestId('next-action').textContent).toContain('新校園待辦');
  expect(screen.queryByText('B 的私人課程')).toBeNull();
  page.rerender(
    todayElement({ scopeKey: 'account-b:nthu', unsigned: true, todos: [], classes: [] }),
  );
  expect(screen.queryByTestId('next-action')).toBeNull();
  expect(screen.getByText(TODAY_COPY.unsigned)).toBeTruthy();
  expect(screen.queryByText('新校園待辦')).toBeNull();
});

it('keeps the transition between different tasks within the same scope', async () => {
  const page = view({ scopeKey: 'account-a:pu', todos: [todo()] });
  page.rerender(
    todayElement({
      scopeKey: 'account-a:pu',
      todos: [todo({ id: 'hw-new', title: '下一份作業' })],
    }),
  );
  expect(screen.getByTestId('next-action').className).toContain(styles.fadeOut);
  await waitFor(() =>
    expect(screen.getByTestId('next-action').textContent).toContain('下一份作業'),
  );
  expect(screen.getByTestId('next-action').textContent).not.toContain('作業三 繳交');
});

it('keeps one welcome area without duplicate login copy when the guest campus changes', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const page = view({ scopeKey: 'guest:personal', unsigned: true, timetableStatus: 'empty' });
    expect(screen.queryByTestId('next-action')).toBeNull();
    page.rerender(todayElement({ scopeKey: 'guest:pu', unsigned: true, timetableStatus: 'empty' }));
    expect(screen.queryByTestId('next-action')).toBeNull();
    expect(screen.getAllByTestId('today-work')).toHaveLength(1);
    expect(screen.getAllByText(TODAY_COPY.unsigned)).toHaveLength(1);
    const servicePaths = screen
      .getAllByRole('link')
      .map((link) => new URL(link.getAttribute('href')!, 'https://campus.example').pathname);
    for (const pathname of ['/map', '/bus', '/cafeteria', '/library']) {
      expect(servicePaths.filter((path) => path === pathname)).toHaveLength(1);
    }
    expect(error).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
    warning.mockRestore();
  }
});
