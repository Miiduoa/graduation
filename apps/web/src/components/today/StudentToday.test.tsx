import { fireEvent, render, screen } from '@testing-library/react';
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

function view(overrides: Partial<ComponentProps<typeof StudentToday>> = {}) {
  return render(
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
    />,
  );
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

it('shows the unsigned sentence when the student is not signed in', () => {
  view({ unsigned: true, timetableStatus: 'empty' });
  expect(screen.getAllByText(TODAY_COPY.unsigned).length).toBeGreaterThan(0);
  expect(screen.getByText(TODAY_COPY.noTimetable)).toBeTruthy();
  expect(screen.getByRole('link', { name: TODAY_COPY.importTimetable }).getAttribute('href')).toBe(
    '/import?kind=timetable&campus=pu',
  );
});

it('shows the empty-day sentence and the week button', () => {
  view({ classes: [], todos: [], timetableStatus: 'ready' });
  expect(screen.getByText(TODAY_COPY.emptyDay)).toBeTruthy();
  expect(screen.getByRole('link', { name: TODAY_COPY.viewWeek })).toBeTruthy();
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
  expect(card.textContent).toContain(TODAY_COPY.overdueDays(2));
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
  expect(screen.getByText(TODAY_COPY.lmsUnconnected)).toBeTruthy();
});

it('shows skeleton bones instead of a spinner', () => {
  view({ skeleton: true });
  expect(screen.getByTestId('today-skeleton')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText(/載入中|讀取中/)).toBeNull();
});
