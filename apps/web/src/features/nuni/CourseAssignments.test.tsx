import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniAssignment, type NuniWorkspace } from '@campus/shared/src/nuni';
import { COURSE_WORK_LANDING_ATTR, COURSE_WORK_MISSING_ASSIGNMENT } from '@/lib/courseWorkLanding';
import { CourseAssignments } from './CourseAssignments';
import { matchesAssignmentSearch, prioritizeCourseAssignments } from './courseAssignmentDiscovery';

const request = vi.hoisted(() => vi.fn());
vi.mock('./Session', () => ({
  browserRequest: request,
  useNuniSession: () => ({
    session: { context: 'session', platformAccountId: 'pa_11111111-1111-4111-8111-111111111111' },
    pendingLogout: false,
    refresh: vi.fn(),
  }),
}));
const workspace: NuniWorkspace = {
  id: 'cw_11111111-1111-4111-8111-111111111111',
  title: '設計專題',
  state: 'active',
  memberRole: 'student',
};
const task: NuniAssignment = {
  id: 'cwa_11111111-1111-4111-8111-111111111111',
  workspaceId: workspace.id,
  title: '專題提案',
  instructions: '說明問題與研究方法。',
  state: 'open',
  createdAt: '2026-01-01T00:00:00.000Z',
  dueAt: '2026-01-02T00:00:00.000Z',
  closedAt: null,
  unitId: null,
  unitTitle: null,
  submissionCount: 0,
  mySubmission: null,
};
const submitted: NuniAssignment = {
  ...task,
  id: 'cwa_22222222-2222-4222-8222-222222222222',
  title: '文獻整理',
  submissionCount: 1,
  mySubmission: {
    assignmentId: 'cwa_22222222-2222-4222-8222-222222222222',
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    displayName: '同學',
    body: '我的文獻整理',
    state: 'submitted',
    submittedAt: '2026-01-02T01:00:00.000Z',
    teacherFeedback: '請補充資料來源。',
    reviewedAt: '2026-01-03T00:00:00.000Z',
  },
};
beforeEach(() => {
  request.mockReset();
  window.history.replaceState(null, '', '/');
});

it('scrolls to an incoming assignment link after its data arrives without jumping again on refresh', async () => {
  window.history.replaceState(null, '', `#assignment-${task.id}`);
  const props = { workspace, reload: vi.fn(), onConfirmed: vi.fn() };
  const view = render(<CourseAssignments {...props} assignments={[]} />);
  view.rerender(<CourseAssignments {...props} assignments={[task]} />);
  const element = screen.getByRole('article', { name: task.title });
  const scroll = vi.fn();
  element.scrollIntoView = scroll;
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'start' }));
  expect(element.getAttribute(COURSE_WORK_LANDING_ATTR)).toBe('true');
  view.rerender(<CourseAssignments {...props} assignments={[{ ...task }]} />);
  expect(scroll).toHaveBeenCalledTimes(1);
});

it('explains a deleted or unauthorized assignment instead of leaving a blank landing', async () => {
  window.history.replaceState(null, '', `#assignment-missing`);
  render(
    <CourseAssignments
      assignments={[task]}
      workspace={workspace}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  expect(screen.getByRole('status').textContent).toBe(COURSE_WORK_MISSING_ASSIGNMENT);
  expect(screen.queryByRole('article', { name: task.title })).toBeTruthy();
});

it('shows the submitted state when a deep link opens an already submitted assignment', async () => {
  window.history.replaceState(null, '', `#assignment-${submitted.id}`);
  render(
    <CourseAssignments
      assignments={[task, submitted]}
      workspace={workspace}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  const card = screen.getByRole('article', { name: submitted.title });
  card.scrollIntoView = vi.fn();
  await waitFor(() => expect(card.getAttribute(COURSE_WORK_LANDING_ATTR)).toBe('true'));
  expect(within(card).getByRole('region', { name: '我的繳交紀錄' }).textContent).toContain(
    '我的文獻整理',
  );
});

it('counts a passed reference deadline as pending while excluding closed or submitted work', () => {
  const closed = {
    ...task,
    id: 'cwa_33333333-3333-4333-8333-333333333333',
    title: '已結束作業',
    state: 'closed' as const,
    closedAt: '2026-01-03T00:00:00.000Z',
  };
  render(
    <CourseAssignments
      assignments={[task, submitted, closed]}
      workspace={workspace}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '待繳交 1' }));
  expect(screen.getByRole('article', { name: task.title })).toBeTruthy();
  expect(screen.queryByRole('article', { name: submitted.title })).toBeNull();
  expect(screen.queryByRole('article', { name: closed.title })).toBeNull();
  expect(screen.getByRole('button', { name: '已繳交 1' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '老師回饋 1' })).toBeTruthy();
});

it('preserves a student draft across filters and reveals direct assignment links', () => {
  render(
    <CourseAssignments
      assignments={[task, submitted]}
      workspace={workspace}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  const draft = within(screen.getByRole('article', { name: task.title })).getByLabelText(
    '作業內容',
  ) as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: '還在寫的提案' } });
  fireEvent.click(screen.getByRole('button', { name: '老師回饋 1' }));
  expect(screen.queryByRole('article', { name: task.title })).toBeNull();
  act(() => {
    window.history.replaceState(null, '', `#assignment-${task.id}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(screen.getByRole('article', { name: task.title })).toBeTruthy();
  expect(draft.value).toBe('還在寫的提案');
});

it('updates task counts only from an acknowledged submission, even before a list refresh', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const reload = vi.fn();
  function Course() {
    const [assignments, setAssignments] = useState([task]);
    return (
      <CourseAssignments
        assignments={assignments}
        workspace={workspace}
        reload={reload}
        onConfirmed={(saved) => setAssignments([saved])}
      />
    );
  }
  render(<Course />);
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '已完成的提案' } });
  fireEvent.submit(screen.getByRole('button', { name: '繳交作業' }).closest('form')!);
  expect(screen.getByRole('button', { name: '待繳交 1' })).toBeTruthy();
  const receipt = {
    ...task,
    submissionCount: 1,
    mySubmission: {
      ...submitted.mySubmission!,
      assignmentId: task.id,
      body: '已完成的提案',
      teacherFeedback: null,
      reviewedAt: null,
    },
  };
  await act(async () => finish(receipt));
  expect(screen.getByRole('button', { name: '待繳交 0' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '已繳交 1' })).toBeTruthy();
  expect(screen.getByText('繳交內容已儲存，老師現在可以查看。')).toBeTruthy();
  expect(reload).not.toHaveBeenCalled();
});

it('does not remove work from pending or issue a receipt after a failed submission', async () => {
  request.mockRejectedValue(new NuniError(503, 'SERVICE_UNAVAILABLE'));
  const confirmed = vi.fn();
  render(
    <CourseAssignments
      assignments={[task]}
      workspace={workspace}
      reload={vi.fn()}
      onConfirmed={confirmed}
    />,
  );
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '要保留的提案' } });
  fireEvent.submit(screen.getByRole('button', { name: '繳交作業' }).closest('form')!);
  await screen.findByRole('alert');
  expect(confirmed).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '待繳交 1' })).toBeTruthy();
  expect(screen.queryByText('繳交內容已儲存，老師現在可以查看。')).toBeNull();
});

it('gives co-teachers received-work filters without student submission controls', () => {
  render(
    <CourseAssignments
      assignments={[task, { ...submitted, mySubmission: null }]}
      workspace={{ ...workspace, memberRole: 'co-teacher' }}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '已收到繳交 1' }));
  expect(screen.queryByRole('article', { name: task.title })).toBeNull();
  expect(screen.getByRole('article', { name: submitted.title })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /待繳交|老師回饋/ })).toBeNull();
  expect(screen.queryByLabelText('作業內容')).toBeNull();
});

it('does not claim an archived course still has submittable work', () => {
  render(
    <CourseAssignments
      assignments={[task]}
      workspace={{ ...workspace, state: 'archived' }}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: '待繳交 0' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '繳交作業' })).toBeNull();
});

it('follows another assignment link when the all filter has not changed', async () => {
  render(
    <CourseAssignments
      assignments={[task, submitted]}
      workspace={workspace}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  const target = screen.getByRole('article', { name: submitted.title });
  target.scrollIntoView = vi.fn();
  act(() => {
    window.history.replaceState(null, '', `#assignment-${submitted.id}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await waitFor(() => expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
  expect(document.activeElement).toBe(target);
});

it('shows a confirmed submission even when the student submitted from the pending filter', async () => {
  const receipt = {
    ...task,
    mySubmission: { ...submitted.mySubmission!, assignmentId: task.id },
    submissionCount: 1,
  };
  request.mockResolvedValue(receipt);
  function Course() {
    const [assignments, setAssignments] = useState([task]);
    return (
      <CourseAssignments
        assignments={assignments}
        workspace={workspace}
        reload={vi.fn()}
        onConfirmed={(saved) => setAssignments([saved])}
      />
    );
  }
  render(<Course />);
  fireEvent.click(screen.getByRole('button', { name: '待繳交 1' }));
  fireEvent.change(screen.getByLabelText('作業內容'), {
    target: { value: receipt.mySubmission.body },
  });
  fireEvent.submit(screen.getByRole('button', { name: '繳交作業' }).closest('form')!);
  await screen.findByRole('region', { name: '我的繳交紀錄' });
  expect(screen.getByRole('article', { name: task.title })).toBeTruthy();
  expect(screen.getByRole('button', { name: '已繳交 1' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});

it('searches titles, descriptions and chapters while retaining drafts and restoring a linked task', async () => {
  const chapterTask = { ...task, unitTitle: '第 03 週：設計方法' };
  render(
    <CourseAssignments
      assignments={[chapterTask, submitted]}
      workspace={workspace}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  const draft = within(screen.getByRole('article', { name: task.title })).getByLabelText(
    '作業內容',
  ) as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: '搜尋時仍保留的內容' } });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋作業' }), {
    target: { value: '文獻' },
  });
  expect(screen.queryByRole('article', { name: task.title })).toBeNull();
  expect(screen.getByRole('article', { name: submitted.title })).toBeTruthy();
  act(() => {
    window.history.replaceState({}, '', `#assignment-${task.id}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect((screen.getByRole('searchbox', { name: '搜尋作業' }) as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('article', { name: task.title })).toBeTruthy();
  expect(draft.value).toBe('搜尋時仍保留的內容');
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋作業' }), {
    target: { value: '０３ 研究' },
  });
  expect(screen.getByRole('article', { name: task.title })).toBeTruthy();
  expect(screen.queryByRole('article', { name: submitted.title })).toBeNull();
  fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜尋作業' }), { key: 'Escape' });
  expect(screen.getByRole('article', { name: submitted.title })).toBeTruthy();
});

it('keeps submitted work behind actionable work and sorts Taipei deadlines without mutating the input', () => {
  const later = { ...task, id: 'later', dueAt: '2026-10-25T10:00:00+08:00' };
  const earlier = { ...task, id: 'earlier', dueAt: '2026-10-25T09:00:00' };
  const unspecified = { ...task, id: 'no-date', dueAt: null };
  const invalid = { ...task, id: 'invalid', dueAt: 'not-a-date' };
  const input = [submitted, unspecified, later, invalid, earlier];
  const sorted = prioritizeCourseAssignments(input, workspace);
  expect(sorted.map((item) => item.id)).toEqual([
    'earlier',
    'later',
    'no-date',
    'invalid',
    submitted.id,
  ]);
  expect(input.map((item) => item.id)).toEqual([
    submitted.id,
    'no-date',
    'later',
    'invalid',
    'earlier',
  ]);
  expect(prioritizeCourseAssignments(input, { ...workspace, memberRole: 'co-teacher' })).toBe(
    input,
  );
  expect(prioritizeCourseAssignments(input, { ...workspace, state: 'archived' })).toBe(input);
  expect(matchesAssignmentSearch({ ...task, title: 'API 設計' }, 'ＡＰＩ 研究')).toBe(true);
});

it('explains an empty search and clears it without losing a student answer', () => {
  render(
    <CourseAssignments
      assignments={[task]}
      workspace={workspace}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '草稿不要消失' } });
  const search = screen.getByRole('searchbox', { name: '搜尋作業' });
  fireEvent.change(search, { target: { value: '不存在的內容' } });
  expect(screen.getByText('沒有符合的作業。試試其他關鍵字，或清除搜尋。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('草稿不要消失');
  expect(document.activeElement).toBe(search);
});


it('separates overdue reference dates from still-open future work without blocking submissions', async () => {
  const overdue = { ...task, dueAt: '2020-01-01T12:00:00+08:00' };
  const later = {
    ...task,
    id: 'cwa_55555555-5555-4555-8555-555555555555',
    title: '下學期作業',
    dueAt: '2099-01-01T12:00:00+08:00',
  };
  render(
    <CourseAssignments
      assignments={[overdue, later, submitted]}
      workspace={workspace}
      reload={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: '已過參考時間 1' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '已過參考時間 1' }));
  expect(screen.getByRole('article', { name: overdue.title })).toBeTruthy();
  expect(screen.getByText('已過參考時間 · 仍可補交')).toBeTruthy();
  expect(screen.getByRole('button', { name: '繳交作業' })).toBeTruthy();
  expect(screen.queryByRole('article', { name: later.title })).toBeNull();
  expect(screen.queryByRole('article', { name: submitted.title })).toBeNull();
});

it('多份收件已開啟時只自動讀取最後選取的一份', async () => {
  request.mockResolvedValue({ submissions: [] });
  const view = render(<CourseAssignments assignments={[task, submitted]} workspace={{ ...workspace, memberRole: 'owner-teacher' }} reload={vi.fn()} onConfirmed={vi.fn()} />);
  const first = within(screen.getByRole('article', { name: task.title }));
  const second = within(screen.getByRole('article', { name: submitted.title }));
  await act(async () => { fireEvent.click(first.getByRole('button', { name: '查看繳交內容' })); });
  await act(async () => { fireEvent.click(second.getByRole('button', { name: '查看繳交內容' })); });
  vi.useFakeTimers();
  try {
    await act(async () => { window.dispatchEvent(new Event('pageshow')); });
    const before = request.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(7500); });
    expect(request).toHaveBeenCalledTimes(before + 3);
    expect(request.mock.calls.slice(before).every(([path]) => path.includes(submitted.id))).toBe(true);
    expect(first.getByText(/收件：已暫停更新/)).toBeTruthy();
    view.unmount();
  } finally { vi.useRealTimers(); }
});
