import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniAssignment, type NuniWorkspace } from '@campus/shared/src/nuni';
import { CourseAssignments } from './CourseAssignments';

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
  view.rerender(<CourseAssignments {...props} assignments={[{ ...task }]} />);
  expect(scroll).toHaveBeenCalledTimes(1);
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
  expect(reload).toHaveBeenCalledOnce();
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
