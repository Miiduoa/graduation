import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TODAY_COPY, type TodayClass, type TodayTodo } from '@campus/shared/src/pickNextAction';
import { TODAY_FLOW_CLASS_TITLE, TODAY_FLOW_WORK_TITLE } from '@/lib/todayCourseWork';
import { StudentToday } from './StudentToday';
import styles from './StudentToday.module.css';

vi.mock('./TodayUnreadNotifications', () => ({
  TodayUnreadNotifications: ({ unsigned }: { unsigned: boolean }) => (
    <section data-testid="today-notifications">
      {unsigned ? '未讀通知需登入' : '未讀通知摘要'}
    </section>
  ),
}));

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
      timetableSchoolId="pu"
      {...overrides}
    />
  );
}

function view(overrides: Partial<ComponentProps<typeof StudentToday>> = {}) {
  return render(todayElement(overrides));
}

it('shows the next class once in the timetable with a keyboard-accessible destination', () => {
  view({ classes: [klass()] });
  const row = screen.getByTestId('next-action');
  expect(within(screen.getByTestId('today-classes')).getByTestId('next-action')).toBe(row);
  expect(row.textContent).toContain(TODAY_COPY.nextClass);
  expect(row.textContent).toContain('10:10');
  expect(row.textContent).toContain('12:00');
  expect(row.textContent).toContain('管理大樓 M302');
  expect(screen.getAllByText('資料庫系統')).toHaveLength(1);
  const link = within(row).getByRole('link', { name: /資料庫系統.*看課程/ });
  expect(link.getAttribute('href')).toBe('/course/cs-db#week');
  expect(within(row).getAllByRole('link')).toHaveLength(2);
  expect(within(row).getByRole('link', { name: /^找教室：/ })).toBeTruthy();
  link.focus();
  expect(document.activeElement).toBe(link);
  expect(screen.queryByText(/為你推薦|智慧|AI 幫你/)).toBeNull();
});

it('keeps the assistant mounted after the planner while the day finishes loading', () => {
  const assistant = <input aria-label="助理草稿測試" defaultValue="" />;
  const result = view({ skeleton: true, assistant });
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: '下一堂課在哪裡？' } });
  result.rerender(todayElement({ classes: [klass()], assistant }));
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft.compareDocumentPosition(screen.getByTestId('next-action')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  expect(draft.compareDocumentPosition(screen.getByTestId('today-classes')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  expect((draft as HTMLInputElement).value).toBe('下一堂課在哪裡？');
});

it('keeps the task agent visible before the timetable and preserves it while home data refreshes', () => {
  const agent = <button type="button">首頁代辦測試</button>;
  const result = view({ skeleton: true, agent });
  const button = screen.getByRole('button', { name: '首頁代辦測試' });
  result.rerender(todayElement({ classes: [klass()], agent }));
  expect(screen.getByRole('button', { name: '首頁代辦測試' })).toBe(button);
  const planner = screen.getByTestId('today-unified-flow');
  expect(button.compareDocumentPosition(planner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('keeps immediate coursework before personalized suggestions and preserves the assistant draft', () => {
  const assistant = <input aria-label="助理草稿測試" defaultValue="請幫我安排今天" />;
  const personalization = <section aria-label="個人化安排">依年級與生活需求安排</section>;
  const result = view({ classes: [klass()], todos: [todo()], assistant, personalization });
  const next = screen.getByTestId('next-action');
  const suggestions = screen.getByRole('region', { name: '個人化安排' });
  expect(next.compareDocumentPosition(suggestions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const draft = screen.getByRole('textbox');
  result.rerender(todayElement({ classes: [klass()], todos: [todo()], assistant,
    personalization: <section aria-label="個人化安排">改成期末準備</section> }));
  expect(screen.getByRole('textbox')).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe('請幫我安排今天');
});

it('marks a class in progress and expands the rest of the day without leaving Today', () => {
  const classes = Array.from({ length: 5 }, (_, i) => klass({
    id: 'class-' + i, title: '課程 ' + i,
    startAt: now.getTime() + (i - 1) * 3_600_000,
    endAt: now.getTime() + (i - 1) * 3_600_000 + 50 * 60_000,
  }));
  view({ classes });
  const list = within(screen.getByTestId('today-classes'));
  expect(within(screen.getByTestId('next-action')).getByText('上課中')).toBeTruthy();
  expect(list.getByRole('link', { name: /(?=.*課程 1)(?=.*上課中)/ })).toBeTruthy();
  expect(list.queryByText('課程 0')).toBeNull();
  fireEvent.click(list.getByRole('button', { name: '再看 1 堂課' }));
  expect(list.getByRole('link', { name: /(?=.*課程 0)(?=.*已結束)/ })).toBeTruthy();
  expect(list.getByRole('link', { name: TODAY_COPY.viewFullTimetable }).getAttribute('href')).toBe('/timetable?campus=pu');
  fireEvent.click(list.getByRole('button', { name: '收起課程' }));
  expect(list.queryByText('課程 0')).toBeNull();
});

it('labels an overnight deadline with its Taipei calendar day', () => {
  view({ now: new Date('2026-10-25T22:00:00+08:00'), todos: [todo({
    dueAt: Date.parse('2026-10-26T08:00:00+08:00'),
  })] });
  expect(within(screen.getByTestId('next-action')).getByText('明天截止')).toBeTruthy();
  expect(screen.getByTestId('next-action').querySelector(`.${styles.rowDeadline}`)?.textContent).toBe(
    '10/26 週一 08:00 截止',
  );
});

it('orders the unified flow as classes, due work, then unread notifications', () => {
  view({ classes: [klass()], todos: [todo()] });
  const flow = screen.getByTestId('today-unified-flow');
  const sections = within(flow)
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent);
  expect(sections.slice(0, 2)).toEqual([TODAY_FLOW_CLASS_TITLE, TODAY_FLOW_WORK_TITLE]);
  expect(within(flow).getByTestId('today-notifications')).toBeTruthy();
  expect(within(flow).getByTestId('next-action').querySelector('a')?.getAttribute('href')).toBe(
    '/course/cs-db#week',
  );
  expect(within(flow).getByTestId('today-work-list').querySelector('a')?.getAttribute('href')).toBe(
    '/course/cs-db#assignment-hw-3',
  );
});

it('puts the due-work row before later classes and keeps one task with separate detail and submit links', () => {
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
  const row = screen.getByTestId('next-action');
  expect(within(screen.getByTestId('today-work-list')).getByTestId('next-action')).toBe(row);
  expect(row.textContent).toContain(TODAY_COPY.dueToday);
  expect(screen.getAllByText('作業三 繳交')).toHaveLength(1);
  const headings = within(screen.getByTestId('today-unified-flow'))
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent);
  expect(headings.slice(0, 2)).toEqual([TODAY_FLOW_WORK_TITLE, TODAY_FLOW_CLASS_TITLE]);
  const detail = within(row).getByRole('link', { name: /作業三 繳交/ });
  const submit = within(row).getByRole('link', { name: TODAY_COPY.goSubmit });
  expect(detail.getAttribute('href')).toBe('/course/cs-db#assignment-hw-3');
  expect(submit.getAttribute('href')).toBe('/course/cs-db#assignment-hw-3-submit');
  expect(detail.contains(submit)).toBe(false);
  detail.focus();
  expect(document.activeElement).toBe(detail);
  submit.focus();
  expect(document.activeElement).toBe(submit);
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

it('puts the earliest overdue item at the top of the work list with its deadline', () => {
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
  expect(card.querySelector(`.${styles.overdue} .${styles.rowDeadline}`)?.textContent).toContain(
    TODAY_COPY.overdueDays(2),
  );
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
  expect(list.getAllByRole('link', { name: /待辦 \d/ })).toHaveLength(3);
  const expand = list.getByRole('button', { name: '還有 2 件' });
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(expand);
  expect(list.getAllByRole('link', { name: /待辦 \d/ })).toHaveLength(5);
  expect(list.getByRole('link', { name: /待辦 5/ }).getAttribute('href')).toBe(
    '/course/cs-db#assignment-work-4',
  );
  fireEvent.click(list.getByRole('button', { name: '收起待辦' }));
  expect(list.getAllByRole('link', { name: /待辦 \d/ })).toHaveLength(3);
});

it('shows undated work and uses the platform task anchor on the focused task row', () => {
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
  expect(card.textContent).toContain('10:30 截止・還剩 40 分鐘');
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
  expect(within(card).getByRole('link', { name: /看課程$/ }).getAttribute('href')).toBe(
    '/course/cs-new#week',
  );
  const mapHref = within(card).getByRole('link', { name: '找教室：新教室 201' }).getAttribute('href');
  const map = new URL(mapHref!, 'https://campus.example');
  expect(map.searchParams.get('query')).toBe('新教室 201');
  expect(map.searchParams.get('schoolId')).toBe('pu');
});

it('keeps classroom navigation separate from course work and uses the timetable school in the unified schedule', () => {
  view({ timetableSchoolId: 'ncku', classes: [klass()] });
  const links = screen.getAllByRole('link', { name: '找教室：管理大樓 M302' });
  expect(links).toHaveLength(1);
  for (const link of links) {
    const url = new URL(link.getAttribute('href')!, 'https://campus.example');
    expect(url.pathname).toBe('/map');
    expect(url.searchParams.get('schoolId')).toBe('ncku');
    expect(url.searchParams.get('query')).toBe('管理大樓 M302');
    expect(link.parentElement?.closest('a, button')).toBeNull();
    expect(link.getAttribute('tabindex')).not.toBe('-1');
  }
  expect(screen.getByRole('link', { name: /資料庫系統.*看課程/ }).getAttribute('href')).toBe('/course/cs-db#week');
});

it.each([undefined, null, 'personal', 'all'])('does not infer a map school from a timetable URL or account (%s)', (timetableSchoolId) => {
  view({ timetableSchoolId, classes: [klass()] });
  expect(screen.queryByRole('link', { name: /找教室/ })).toBeNull();
});

it('does not offer a classroom destination for a blank room or unconfirmed timetable', () => {
  const page = view({ classes: [klass({ location: '  ' })] });
  expect(screen.queryByRole('link', { name: /找教室/ })).toBeNull();
  page.rerender(todayElement({ timetableStatus: 'loading', classes: [klass()] }));
  expect(screen.queryByRole('link', { name: /找教室/ })).toBeNull();
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

it('replaces the focused task immediately when the open work changes in the same scope', () => {
  const page = view({ scopeKey: 'account-a:pu', todos: [todo()] });
  page.rerender(
    todayElement({
      scopeKey: 'account-a:pu',
      todos: [todo({ id: 'hw-new', title: '下一份作業', href: '/course/cs-db#assignment-hw-new' })],
    }),
  );
  const row = screen.getByTestId('next-action');
  expect(row.textContent).toContain('下一份作業');
  expect(screen.queryByText('作業三 繳交')).toBeNull();
  expect(within(row).getByRole('link', { name: TODAY_COPY.goSubmit }).getAttribute('href')).toBe(
    '/course/cs-db#assignment-hw-new-submit',
  );
});

it('keeps an imminent lesson first when there is also a deadline today', () => {
  view({ classes: [klass()], todos: [todo()] });
  const flow = screen.getByTestId('today-unified-flow');
  const headings = within(flow).getAllByRole('heading', { level: 2 });
  expect(headings.slice(0, 2).map((heading) => heading.textContent)).toEqual([
    TODAY_FLOW_CLASS_TITLE,
    TODAY_FLOW_WORK_TITLE,
  ]);
  expect(within(screen.getByTestId('today-classes')).getByTestId('next-action')).toBeTruthy();
  expect(within(screen.getByTestId('today-work-list')).queryByTestId('next-action')).toBeNull();
  expect(screen.getAllByText('作業三 繳交')).toHaveLength(1);
});

it('keeps the selected due-soon task visible ahead of older overdue work', () => {
  view({
    todos: [
      todo({ id: 'old-work', title: '較早逾期待辦', dueAt: now.getTime() - 86_400_000 }),
      todo({ id: 'due-soon', title: '即將截止待辦', dueAt: now.getTime() + 3_600_000 }),
    ],
  });
  const row = screen.getByTestId('next-action');
  expect(row.textContent).toContain('即將截止待辦');
  const list = within(screen.getByTestId('today-work-list'));
  expect(list.getAllByRole('link', { name: /待辦/ })[0].textContent).toContain('即將截止待辦');
  expect(screen.getAllByText('較早逾期待辦')).toHaveLength(1);
  expect(screen.getAllByText('即將截止待辦')).toHaveLength(1);
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

it.each(['pending', 'empty', 'error'] as const)('keeps the calendar reachable from %s coursework', (state) => {
  view({
    todos: state === 'pending' ? [todo()] : [],
    todosError: state === 'error' ? '作業暫時讀不到' : '',
  });
  const work = within(screen.getByTestId('today-work'));
  const calendar = work.getByRole('link', { name: '查看行事曆' });
  expect(calendar.getAttribute('href')).toBe('/calendar');
  calendar.focus();
  expect(document.activeElement).toBe(calendar);
  if (state === 'pending') {
    expect(work.getByRole('link', { name: /作業三 繳交/ }).getAttribute('href'))
      .toBe('/course/cs-db#assignment-hw-3');
  }
});
