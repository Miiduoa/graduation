import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TodayClass, TodayTodo } from '@campus/shared/src/pickNextAction';
import { StudentToday } from './StudentToday';

vi.mock('./TodayUnreadNotifications', () => ({
  TodayUnreadNotifications: () => null,
}));

const now = new Date('2026-10-25T09:50:00+08:00');
const scopeKey = JSON.stringify(['school:uid-a', 'pu', 'uid-a']);
const workspaceId = 'cw_12345678-1234-1234-1234-123456789abc';
const request = vi.fn<typeof fetch>();
function receipt(schoolId = 'pu') {
  return { workspaceId, membershipActive: true, memberRole: 'student', status: 'reviewed', course: {
    workspaceId, schoolId, id: 'ccd_12345678-1234-1234-1234-123456789abc', version: 1,
    verification: 'administrator-reviewed', academicYear: '115', semester: '1', courseCode: 'CS301',
    className: '三甲', teacher: '老師', title: '已審查課程',
  } };
}
const REMINDER = 'today-priority-reminder';

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
    id: 'cs-db:hw-3',
    title: '作業三 繳交',
    courseName: '資料庫系統',
    schoolId: 'pu',
    courseId: 'cs-db',
    dueAt: Date.parse('2026-10-25T11:00:00+08:00'),
    href: '/course/cs-db#assignment-hw-3',
    ...overrides,
  };
}

function today(overrides: Partial<ComponentProps<typeof StudentToday>> = {}) {
  return (
    <StudentToday
      now={now}
      updatedAt={now}
      unsigned={false}
      skeleton={false}
      classes={[klass()]}
      todos={[todo()]}
      timetableStatus="ready"
      todosError=""
      lmsUnconnected={false}
      onRetryTimetable={vi.fn()}
      onRetryTodos={vi.fn()}
      importHref="/import?kind=timetable&campus=pu"
      weekHref="/timetable?campus=pu"
      timetableHref="/timetable?campus=pu"
      timetableSchoolId="pu"
      timetableTermKey="115|1"
      scopeKey={scopeKey}
      campusSearch="campus=pu"
      {...overrides}
    />
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn();
  request.mockReset();
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows one reminder before the lists and opens the original work with its campus', () => {
  render(today());
  const reminder = screen.getByTestId(REMINDER);
  expect(reminder.textContent).toContain('nuni 提醒');
  expect(reminder.textContent).toContain('作業三 繳交');
  expect(reminder.textContent).toContain('11:00');
  expect(reminder.textContent).toContain('資料庫系統');
  expect(
    reminder.compareDocumentPosition(screen.getByTestId('today-unified-flow')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const link = within(reminder).getByRole('link', { name: /前往這份作業：作業三 繳交/ });
  expect(link.getAttribute('href')).toBe('/course/cs-db?campus=pu#assignment-hw-3');
  link.focus();
  expect(document.activeElement).toBe(link);
});

function platform(accountId = 'account-a', schoolId = 'pu', overrides: Partial<ComponentProps<typeof StudentToday>> = {}) {
  return today({
    scopeKey: JSON.stringify([`platform:${accountId}`, schoolId, 'uid-a']),
    campusSearch: 'campus=' + schoolId, timetableSchoolId: schoolId,
    platformSession: { accountId, context: accountId + '-session' },
    todos: [todo({ schoolId: undefined, id: workspaceId + ':q1', courseId: workspaceId, href: '/classroom/course/' + workspaceId + '#quiz-q1' })],
    ...overrides,
  });
}

it('uses the reviewed student workspace and the original quiz anchor for a platform task', async () => {
  request.mockResolvedValue(Response.json(receipt()));
  render(platform());
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  const reminder = await screen.findByTestId(REMINDER);
  expect(within(reminder).getByRole('link', { name: /前往這份測驗/ }).getAttribute('href'))
    .toBe('/classroom/course/' + workspaceId + '?campus=pu#quiz-q1');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/api/nuni/course-access/workspace-course', expect.objectContaining({
    method: 'POST', headers: expect.objectContaining({ 'X-Campus-Session': 'account-a-session' }),
    body: JSON.stringify({ workspaceId, schoolId: 'pu' }),
  }));
});

it.each(['account', 'school', 'refresh'] as const)('ignores a previous platform receipt after %s changes', async change => {
  const previous = Promise.withResolvers<Response>();
  const latest = Promise.withResolvers<Response>();
  request.mockReturnValueOnce(previous.promise).mockReturnValueOnce(latest.promise);
  const view = render(platform());
  if (change === 'refresh') view.rerender(platform('account-a', 'pu', { refreshing: true }));
  const schoolId = change === 'school' ? 'ntu' : 'pu';
  view.rerender(platform(change === 'account' ? 'account-b' : 'account-a', schoolId));
  await act(async () => previous.resolve(Response.json(receipt())));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  await act(async () => latest.resolve(Response.json(receipt(schoolId))));
  expect(screen.getByTestId(REMINDER)).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(2);
});

it.each(['unreviewed', 'other school', 'other workspace', 'teacher', 'revoked', 'failed'])(
  'withholds the platform reminder on %s verification', async state => {
    const response = Promise.withResolvers<Response>();
    request.mockReturnValue(response.promise);
    render(platform());
    const reviewed = receipt();
    const body = state === 'unreviewed' ? { ...reviewed, status: 'unreviewed', course: null }
      : state === 'other school' ? receipt('ntu')
      : state === 'other workspace' ? { ...reviewed, workspaceId: 'wrong-workspace' }
      : state === 'teacher' ? { ...reviewed, memberRole: 'owner-teacher' }
      : { ...reviewed, membershipActive: false };
    await act(async () => response.resolve(Response.json(body, { status: state === 'failed' ? 503 : 200 })));
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(REMINDER)).toBeNull();
  },
);

it('does not request workspace evidence for another account or a non-conflicting deadline', () => {
  const view = render(platform('account-a', 'pu', { platformSession: { accountId: 'account-b', context: 'other' } }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  view.rerender(platform('account-a', 'pu', { classes: [] }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  view.rerender(platform('account-a', 'pu', { todos: [todo()] }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it('withdraws an already verified reminder immediately when a refreshed workspace check fails', async () => {
  request.mockResolvedValueOnce(Response.json(receipt()));
  const next = Promise.withResolvers<Response>();
  request.mockReturnValueOnce(next.promise);
  const view = render(platform());
  await screen.findByTestId(REMINDER);
  view.rerender(platform('account-a', 'pu', { refreshing: true }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  view.rerender(platform());
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  await act(async () => next.resolve(Response.json({}, { status: 403 })));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});

it('drops other schools before ranking Firebase work and requires the timetable owner to match the school account', () => {
  const view = render(today({ todos: [
    todo({ schoolId: 'ntu', title: '他校作業', dueAt: now.getTime() + 60000 }), todo(),
  ] }));
  expect(within(screen.getByTestId(REMINDER)).getByText('作業三 繳交')).toBeTruthy();
  view.rerender(today({ scopeKey: JSON.stringify(['school:uid-a', 'pu', 'uid-b']) }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  view.rerender(today({ todos: [todo({ schoolId: undefined })] }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it('stays quiet when the deadline is not during a class (todo or class priority)', () => {
  const view = render(today({ todos: [todo({ dueAt: Date.parse('2026-10-25T23:59:00+08:00') })] }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  view.rerender(today({ todos: [] }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
});

it('links the exact item when two work items share a title', () => {
  render(
    today({
      todos: [
        todo({
          id: 'os:hw-3',
          courseId: 'os',
          courseName: '作業系統',
          href: '/course/os#assignment-hw-3',
        }),
        todo(),
        todo({
          id: 'ds:hw-3',
          courseId: 'ds',
          courseName: '資料結構',
          href: '/course/ds#assignment-hw-3',
          dueAt: Date.parse('2026-10-25T23:59:00+08:00'),
        }),
      ],
    }),
  );
  const reminder = screen.getByTestId(REMINDER);
  const link = within(reminder).getByRole('link');
  expect(link.getAttribute('href')).toBe('/course/cs-db?campus=pu#assignment-hw-3');
  expect(link.getAttribute('aria-label')).toContain('資料庫系統');
  expect(link.getAttribute('aria-label')).not.toContain('作業系統');
});

it.each([
  ['signed out', { unsigned: true }],
  ['loading', { skeleton: true }],
  ['refreshing', { refreshing: true }],
  ['a task error', { todosError: '作業暫時讀不到' }],
  ['a timetable error', { timetableStatus: 'error' as const }],
  ['an unconnected platform', { lmsUnconnected: true }],
  ['a withdrawing task', { leavingTodoIds: ['cs-db:hw-3'] }],
  ['no campus in the link context', { campusSearch: 'token=private' }],
  ['all campuses', { campusSearch: 'campus=all' }],
  ['another campus in the link context', { campusSearch: 'campus=ntu' }],
  ['another campus timetable', { timetableSchoolId: 'ntu' }],
  ['an unscoped timetable', { timetableSchoolId: 'personal', campusSearch: 'campus=personal' }],
  ['a past term', { timetableTermKey: '114|1' }],
  ['a future term', { timetableTermKey: '115|2' }],
  ['an unknown term', { timetableTermKey: '未填|未填' }],
  ['an absent term', { timetableTermKey: undefined }],
  ['a missing scope', { scopeKey: undefined }],
  ['a scope for another campus', { scopeKey: JSON.stringify(['platform:account-a', 'ntu', null]) }],
  ['an unparseable scope', { scopeKey: 'account-a:pu' }],
])('does not show the reminder for %s', (_label, overrides) => {
  render(today(overrides));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
});

it.each([
  ['a made-up id', { id: 'hw-3' }],
  ['a different course than the link', { courseId: 'other' }],
  ['no link', { href: undefined }],
  ['an off-site link', { href: 'https://example.com/course/cs-db#assignment-hw-3' }],
  ['a link for another campus', { href: '/course/cs-db?campus=ntu#assignment-hw-3' }],
  ['a link without a work anchor', { href: '/course/cs-db#week' }],
  ['a material anchor', { href: '/course/cs-db#material-hw-3' }],
])('does not link work with %s', (_label, overrides) => {
  render(today({ todos: [todo(overrides)] }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
});

it('withdraws the reminder when the page fails, signs out, or refreshes, and returns after recovery', () => {
  const view = render(today());
  expect(screen.getByTestId(REMINDER)).toBeTruthy();
  view.rerender(today({ todosError: '作業暫時讀不到' }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
  view.rerender(today({ refreshing: true }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  view.rerender(today());
  expect(screen.getByTestId(REMINDER)).toBeTruthy();
  view.rerender(today({ unsigned: true, todos: [], classes: [] }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
  expect(screen.queryByText('作業三 繳交')).toBeNull();
  view.rerender(today({ scopeKey: JSON.stringify(['platform:account-b', 'pu', null]) }));
  expect(screen.queryByTestId(REMINDER)).toBeNull();
});
