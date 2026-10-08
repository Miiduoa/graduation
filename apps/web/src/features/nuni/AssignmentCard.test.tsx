import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  NuniError,
  type NuniAssignment,
  type NuniSubmission,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { AssignmentCard } from './AssignmentCard';

const state = vi.hoisted(() => ({ context: 'session-a', request: vi.fn(), refresh: vi.fn() }));
vi.mock('./Session', () => ({
  browserRequest: state.request,
  useNuniSession: () => ({
    session: {
      context: state.context,
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    },
    pendingLogout: false,
    refresh: state.refresh,
  }),
}));
const workspace: NuniWorkspace = {
  id: 'cw_11111111-1111-4111-8111-111111111111',
  title: '資料庫',
  state: 'active',
  memberRole: 'owner-teacher',
};
const assignment: NuniAssignment = {
  id: 'cwa_11111111-1111-4111-8111-111111111111',
  workspaceId: workspace.id,
  title: '設計資料表',
  instructions: '說明主鍵與關聯。',
  state: 'open',
  dueAt: '2026-10-09T12:00:00.000Z',
  submissionCount: 1,
  mySubmission: null,
  createdAt: '2026-10-08T08:00:00.000Z',
  closedAt: null,
  unitId: null,
  unitTitle: null,
};
const submission: NuniSubmission = {
  assignmentId: assignment.id,
  platformAccountId: 'pa_22222222-2222-4222-8222-222222222222',
  displayName: '林同學',
  body: '我的資料表與主鍵',
  state: 'submitted',
  submittedAt: '2026-10-08T08:30:00.000Z',
  teacherFeedback: null,
  reviewedAt: null,
};
const reviewed = (feedback = '主鍵選擇清楚，可以再補充關聯。'): NuniSubmission => ({
  ...submission,
  teacherFeedback: feedback,
  reviewedAt: '2026-10-08T09:00:00.000Z',
});
const closed: NuniAssignment = {
  ...assignment,
  state: 'closed',
  closedAt: '2026-10-08T09:00:00.000Z',
};
const reload = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  state.context = 'session-a';
  state.request.mockResolvedValue({ submissions: [submission] });
});
async function openSubmissions() {
  fireEvent.click(screen.getByRole('button', { name: '查看繳交內容' }));
  await screen.findByRole('article', { name: '林同學的繳交' });
  return screen.getByLabelText('給林同學的回饋') as HTMLTextAreaElement;
}
function confirmClose() {
  fireEvent.click(screen.getByRole('button', { name: '停止收件' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '我了解學生將無法再繳交或修改作業' }));
  fireEvent.submit(screen.getByRole('button', { name: '確認停止收件' }).closest('form')!);
}

it('lets teachers read submissions and displays feedback only after a verified saved response', async () => {
  let finish!: (value: unknown) => void;
  state.request.mockResolvedValueOnce({ submissions: [submission] }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: reviewed().teacherFeedback } });
  fireEvent.submit(feedback.closest('form')!);
  expect(feedback.closest('fieldset')?.disabled).toBe(true);
  expect(screen.queryByText('回饋已儲存，學生現在可以查看。')).toBeNull();
  await act(async () => finish(reviewed()));
  expect(screen.getByText('回饋已儲存，學生現在可以查看。')).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: '目前老師回饋' })).getByText(
      reviewed().teacherFeedback!,
    ),
  ).toBeTruthy();
  expect(state.request).toHaveBeenCalledWith(
    `class-workspaces/${workspace.id}/assignments/${assignment.id}/submissions/${submission.platformAccountId}/feedback`,
    'session-a',
    expect.objectContaining({
      feedback: reviewed().teacherFeedback,
      idempotencyKey: expect.any(String),
    }),
  );
  expect(reload).not.toHaveBeenCalled();
});

it('preserves a feedback draft when rejected and does not fabricate a grade or save receipt', async () => {
  state.request
    .mockResolvedValueOnce({ submissions: [submission] })
    .mockRejectedValueOnce(new NuniError(403, 'CLASS_WORKSPACE_TEACHER_REQUIRED'));
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: '尚未儲存的回饋' } });
  fireEvent.submit(feedback.closest('form')!);
  await screen.findByRole('alert');
  expect(feedback.value).toBe('尚未儲存的回饋');
  expect(feedback.closest('fieldset')?.disabled).toBe(false);
  expect(screen.queryByRole('region', { name: '目前老師回饋' })).toBeNull();
  expect(screen.queryByText(/回饋已儲存|分數|評分/)).toBeNull();
});

it('retains the original feedback key on uncertain retry and shows a newer authoritative replay', async () => {
  state.request
    .mockResolvedValueOnce({ submissions: [submission] })
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockResolvedValueOnce(reviewed('另一位老師已補充新的回饋'));
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: '原本送出的回饋' } });
  fireEvent.submit(feedback.closest('form')!);
  await screen.findByRole('button', { name: '確認送出結果' });
  const request = state.request.mock.calls[1][2];
  fireEvent.submit(feedback.closest('form')!);
  expect(await screen.findByText('這份回饋已有新的內容，上方顯示目前儲存的版本。')).toBeTruthy();
  expect(state.request.mock.calls[2][2]).toEqual(request);
  expect(feedback.value).toBe('另一位老師已補充新的回饋');
  expect(screen.queryByText('回饋已儲存，學生現在可以查看。')).toBeNull();
});

it('hides an old teacher submission read immediately on session change', async () => {
  let finish!: (value: unknown) => void;
  state.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  fireEvent.click(screen.getByRole('button', { name: '查看繳交內容' }));
  state.context = 'session-b';
  view.rerender(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  await act(async () => finish({ submissions: [submission] }));
  expect(screen.queryByText(submission.body)).toBeNull();
  expect(screen.queryByLabelText('給林同學的回饋')).toBeNull();
});

it('ignores a late feedback response after the session changes', async () => {
  let finish!: (value: unknown) => void;
  state.request.mockResolvedValueOnce({ submissions: [submission] }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: reviewed().teacherFeedback } });
  fireEvent.submit(feedback.closest('form')!);
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  state.context = 'session-b';
  view.rerender(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  await act(async () => finish(reviewed()));
  expect(screen.queryByText(/回饋已儲存|另一位老師/)).toBeNull();
  expect(screen.queryByText(submission.body)).toBeNull();
});

it('requires an explicit checked acknowledgment before closing', async () => {
  state.request.mockResolvedValueOnce(closed);
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  fireEvent.click(screen.getByRole('button', { name: '停止收件' }));
  expect(state.request).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: '確認停止收件' });
  fireEvent.submit(button.closest('form')!);
  await screen.findByRole('alert');
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: '我了解學生將無法再繳交或修改作業' }));
  fireEvent.submit(button.closest('form')!);
  expect(await screen.findByText('目前已停止收件，已繳交的內容與老師回饋仍會保留。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '停止收件' })).toBeNull();
});

it('reconciles a lost close acknowledgment with a fresh verified closed assignment', async () => {
  state.request
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockResolvedValueOnce({ assignments: [closed] });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  confirmClose();
  await screen.findByText('目前已停止收件，已繳交的內容與老師回饋仍會保留。');
  expect(state.request.mock.calls[1][0]).toBe(`class-workspaces/${workspace.id}/assignments`);
  expect(screen.queryByText('開放繳交')).toBeNull();
});

it('does not treat any conflict or an unconfirmed read as a successful close', async () => {
  state.request
    .mockRejectedValueOnce(new NuniError(409, 'REQUEST_FAILED'))
    .mockResolvedValueOnce({ assignments: [assignment] });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  confirmClose();
  await screen.findByRole('alert');
  expect(screen.getByText('開放繳交')).toBeTruthy();
  expect(screen.queryByText(/目前已停止收件/)).toBeNull();
  expect(state.request).toHaveBeenCalledTimes(2);
});

it('shows a students real feedback and allows an open assignment revision without teacher controls', async () => {
  const mySubmission = {
    ...reviewed(),
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  };
  state.request.mockResolvedValueOnce({
    ...assignment,
    mySubmission: { ...mySubmission, body: '修正版' },
  });
  render(
    <AssignmentCard
      item={{ ...assignment, mySubmission }}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
    />,
  );
  expect(screen.getByText(mySubmission.teacherFeedback!)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看繳交內容' })).toBeNull();
  expect(screen.queryByRole('button', { name: '停止收件' })).toBeNull();
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '修正版' } });
  fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(
    within(screen.getByRole('region', { name: '我的繳交紀錄' })).getByText('修正版'),
  ).toBeTruthy();
});

it('renders archived assignments read-only and does not offer unsupported teacher reads', () => {
  render(
    <AssignmentCard
      item={assignment}
      workspace={{ ...workspace, state: 'archived' }}
      reload={reload}
    />,
  );
  expect(screen.getByText('課程已封存，目前只能查看已保留的作業資料。')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});

it.each([403, 404])(
  'clears loaded submissions and teacher controls after access returns %i',
  async (status) => {
    state.request
      .mockResolvedValueOnce({ submissions: [submission] })
      .mockRejectedValueOnce(new NuniError(status, 'REQUEST_FAILED'));
    render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
    await openSubmissions();
    fireEvent.click(screen.getByRole('button', { name: '更新繳交內容' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(submission.body)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '停止收件' })).toBeNull();
  },
);

it('keeps a verified feedback result when an older submission refresh fails', async () => {
  let fail!: (reason: unknown) => void;
  state.request
    .mockResolvedValueOnce({ submissions: [submission] })
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValueOnce(reviewed());
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.click(screen.getByRole('button', { name: '更新繳交內容' }));
  fireEvent.change(feedback, { target: { value: reviewed().teacherFeedback } });
  fireEvent.submit(feedback.closest('form')!);
  await screen.findByText('回饋已儲存，學生現在可以查看。');
  await act(async () => fail(new Error('old request failed')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('region', { name: '目前老師回饋' }).textContent).toContain(
    reviewed().teacherFeedback,
  );
});

it('confirms an already-closed conflict only after a fresh server read', async () => {
  state.request
    .mockRejectedValueOnce(new NuniError(409, 'REQUEST_FAILED'))
    .mockResolvedValueOnce({ assignments: [closed] });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  confirmClose();
  expect(await screen.findByText('目前已停止收件，已繳交的內容與老師回饋仍會保留。')).toBeTruthy();
  expect(state.request).toHaveBeenCalledTimes(2);
});

it('keeps confirmed closure when a late parent snapshot still says open', async () => {
  state.request.mockResolvedValueOnce(closed);
  const view = render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  confirmClose();
  await screen.findByText('目前已停止收件，已繳交的內容與老師回饋仍會保留。');
  view.rerender(<AssignmentCard item={{ ...assignment }} workspace={workspace} reload={reload} />);
  expect(screen.getByText('已停止收件')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '停止收件' })).toBeNull();
});

it('keeps a confirmed student revision across stale props and accepts a fresher server revision', async () => {
  const mine = { ...submission, platformAccountId: 'pa_11111111-1111-4111-8111-111111111111' };
  const saved = { ...mine, body: '已確認的修正版', submittedAt: '2026-10-08T09:30:00.000Z' };
  state.request.mockResolvedValueOnce({ ...assignment, mySubmission: saved });
  const studentWorkspace: NuniWorkspace = { ...workspace, memberRole: 'student' };
  const view = render(
    <AssignmentCard
      item={{ ...assignment, mySubmission: mine }}
      workspace={studentWorkspace}
      reload={reload}
    />,
  );
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: saved.body } });
  fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  view.rerender(
    <AssignmentCard
      item={{ ...assignment, mySubmission: mine }}
      workspace={studentWorkspace}
      reload={reload}
    />,
  );
  expect(screen.getByRole('region', { name: '我的繳交紀錄' }).textContent).toContain(saved.body);
  const newer = { ...mine, body: '其他裝置的新版本', submittedAt: '2026-10-08T10:30:00.000Z' };
  view.rerender(
    <AssignmentCard
      item={{ ...assignment, mySubmission: newer }}
      workspace={studentWorkspace}
      reload={reload}
    />,
  );
  expect(screen.getByRole('region', { name: '我的繳交紀錄' }).textContent).toContain(newer.body);
});

it('updates an untouched feedback editor when another teacher has saved a newer response', async () => {
  state.request.mockResolvedValueOnce({ submissions: [reviewed('舊回饋')] }).mockResolvedValueOnce({
    submissions: [{ ...reviewed('其他老師的新回饋'), reviewedAt: '2026-10-08T10:00:00.000Z' }],
  });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  expect(feedback.value).toBe('舊回饋');
  fireEvent.click(screen.getByRole('button', { name: '更新繳交內容' }));
  await waitFor(() => expect(feedback.value).toBe('其他老師的新回饋'));
  expect(screen.queryByRole('region', { name: '回饋內容已更新' })).toBeNull();
});

it('keeps a dirty feedback draft but requires a decision before overwriting a refreshed version', async () => {
  state.request
    .mockResolvedValueOnce({ submissions: [reviewed('舊回饋')] })
    .mockResolvedValueOnce({
      submissions: [{ ...reviewed('其他老師的新回饋'), reviewedAt: '2026-10-08T10:00:00.000Z' }],
    })
    .mockResolvedValueOnce({ ...reviewed('自己的草稿'), reviewedAt: '2026-10-08T10:30:00.000Z' });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: '自己的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '更新繳交內容' }));
  await screen.findByRole('region', { name: '回饋內容已更新' });
  expect(feedback.value).toBe('自己的草稿');
  fireEvent.submit(feedback.closest('form')!);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '儲存回饋' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(state.request).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '保留草稿，儲存時覆寫' }));
  fireEvent.submit(feedback.closest('form')!);
  await screen.findByText('回饋已儲存，學生現在可以查看。');
  expect(state.request.mock.calls[2][2].feedback).toBe('自己的草稿');
});

it('lets a teacher discard a conflicting draft and edit the fresh feedback', async () => {
  state.request
    .mockResolvedValueOnce({ submissions: [reviewed('舊回饋')] })
    .mockResolvedValueOnce({ submissions: [reviewed('其他老師的新回饋')] });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: '自己的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '更新繳交內容' }));
  await screen.findByRole('region', { name: '回饋內容已更新' });
  fireEvent.click(screen.getByRole('button', { name: '改用目前回饋' }));
  expect(feedback.value).toBe('其他老師的新回饋');
  expect(screen.queryByRole('region', { name: '回饋內容已更新' })).toBeNull();
  expect(state.request).toHaveBeenCalledTimes(2);
});

it('preserves an uncertain feedback attempt even if refreshed feedback changes before its retry', async () => {
  const latest = { ...reviewed('其他老師的新回饋'), reviewedAt: '2026-10-08T10:00:00.000Z' };
  state.request
    .mockResolvedValueOnce({ submissions: [reviewed('舊回饋')] })
    .mockRejectedValueOnce(new TypeError('response lost'))
    .mockResolvedValueOnce({ submissions: [latest] })
    .mockResolvedValueOnce(latest);
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: '自己的草稿' } });
  fireEvent.submit(feedback.closest('form')!);
  await screen.findByRole('button', { name: '確認送出結果' });
  const original = state.request.mock.calls[1][2];
  fireEvent.click(screen.getByRole('button', { name: '更新繳交內容' }));
  await screen.findByRole('region', { name: '回饋內容已更新' });
  fireEvent.submit(feedback.closest('form')!);
  await screen.findByText('這份回饋已有新的內容，上方顯示目前儲存的版本。');
  expect(state.request.mock.calls[3][2]).toEqual(original);
  expect(feedback.value).toBe(latest.teacherFeedback);
});

it('rejects a feedback receipt belonging to another student without showing it as saved', async () => {
  state.request.mockResolvedValueOnce({ submissions: [submission] }).mockResolvedValueOnce({
    ...reviewed(),
    platformAccountId: 'pa_33333333-3333-4333-8333-333333333333',
  });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: reviewed().teacherFeedback } });
  fireEvent.submit(feedback.closest('form')!);
  await screen.findByRole('alert');
  expect(screen.queryByText('回饋已儲存，學生現在可以查看。')).toBeNull();
  expect(screen.queryByRole('region', { name: '目前老師回饋' })).toBeNull();
});

it('does not reconcile or display an old close response in a new session', async () => {
  let reject!: (value: unknown) => void;
  state.request.mockImplementationOnce(
    () =>
      new Promise((_resolve, failure) => {
        reject = failure;
      }),
  );
  const view = render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  confirmClose();
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
  state.context = 'session-b';
  view.rerender(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  await act(async () => reject(new NuniError(409, 'REQUEST_FAILED')));
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/目前已停止收件/)).toBeNull();
  expect(screen.getByText('開放繳交')).toBeTruthy();
});
