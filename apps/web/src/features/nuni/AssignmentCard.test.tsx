import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  NuniError,
  type NuniAssignment,
  type NuniSubmission,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { AssignmentCard, assignmentReceiptDomId } from './AssignmentCard';

const state = vi.hoisted(() => ({
  context: 'session-a',
  request: vi.fn(),
  upload: vi.fn(),
  refresh: vi.fn(),
  fileSubmit: false,
}));
vi.mock('./Session', () => ({
  browserRequest: state.request,
  browserUpload: state.upload,
  useNuniSession: () => ({
    session: {
      context: state.context,
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
      assignmentFileSubmit: state.fileSubmit,
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
  state.fileSubmit = false;
  state.request.mockReset().mockResolvedValue({ submissions: [submission] });
  state.upload.mockReset();
});
async function openSubmissions() {
  fireEvent.click(screen.getByRole('button', { name: '查看繳交內容' }));
  await screen.findByRole('article', { name: '林同學的繳交' });
  return screen.getByLabelText('給林同學的回饋') as HTMLTextAreaElement;
}

it.each(['student', 'owner-teacher'] as const)(
  'marks earlier assignment feedback after resubmission for %s',
  async (role) => {
    const revised = { ...reviewed(), body: '新繳交內容', submittedAt: '2026-10-08T10:00:00.000Z' };
    state.request.mockResolvedValueOnce({ submissions: [revised] });
    render(
      <AssignmentCard
        item={{ ...assignment, mySubmission: role === 'student' ? revised : null }}
        workspace={{ ...workspace, memberRole: role }}
        reload={reload}
      />,
    );
    if (role === 'owner-teacher') await openSubmissions();
    expect(screen.getByText('這則回饋早於最近一次繳交，請老師確認是否仍適用。')).toBeTruthy();
  },
);

it.each(['student', 'owner-teacher'] as const)(
  'does not mark a current mixed-offset review stale for %s',
  async (role) => {
    const current = {
      ...reviewed(),
      submittedAt: '2026-10-11T10:00:00',
      reviewedAt: '2026-10-11T03:00:00Z',
    };
    state.request.mockResolvedValueOnce({ submissions: [current] });
    render(
      <AssignmentCard
        item={{ ...assignment, mySubmission: role === 'student' ? current : null }}
        workspace={{ ...workspace, memberRole: role }}
        reload={reload}
      />,
    );
    if (role === 'owner-teacher') {
      await openSubmissions();
      expect(screen.getByRole('button', { name: '已回饋 1' })).toBeTruthy();
    }
    expect(screen.queryByText('這則回饋早於最近一次繳交，請老師確認是否仍適用。')).toBeNull();
  },
);

it('requires a teacher decision when a student updates the answer under a dirty feedback draft', async () => {
  const original = reviewed();
  state.request
    .mockResolvedValueOnce({ submissions: [original] })
    .mockResolvedValueOnce({
      submissions: [{ ...original, body: '學生新稿', submittedAt: '2026-10-08T10:00:00.000Z' }],
    });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const editor = await openSubmissions();
  fireEvent.change(editor, { target: { value: '尚未儲存的舊稿回饋' } });
  fireEvent.click(screen.getByRole('button', { name: '更新繳交內容' }));
  await screen.findByText('學生新稿');
  expect(screen.getByRole('region', { name: '回饋內容已更新' })).toBeTruthy();
  fireEvent.submit(editor.closest('form')!);
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  expect(
    state.request.mock.calls.filter((call) => String(call[0]).endsWith('/feedback')),
  ).toHaveLength(0);
  expect(editor.value).toBe('尚未儲存的舊稿回饋');
});
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

it('keeps an unsaved feedback draft when the teacher switches filters away and back', async () => {
  const peer = {
    ...reviewed('已回饋同學'),
    platformAccountId: 'pa_33333333-3333-4333-8333-333333333333',
    displayName: '已回同學',
    reviewedAt: '2026-10-08T09:30:00.000Z',
  };
  state.request.mockResolvedValueOnce({ submissions: [submission, peer] });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: '尚未儲存的篩選測試草稿' } });
  expect(feedback.value).toBe('尚未儲存的篩選測試草稿');
  fireEvent.click(screen.getByRole('button', { name: '已回饋 1' }));
  expect(screen.getByRole('button', { name: '已回饋 1' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: '尚未回饋 1' }));
  const restored = screen.getByLabelText('給林同學的回饋') as HTMLTextAreaElement;
  expect(restored.value).toBe('尚未儲存的篩選測試草稿');
});

it('does not submit feedback twice after filtering during a pending save', async () => {
  let finish!: (value: unknown) => void;
  const peer = {
    ...reviewed('已回饋同學'),
    platformAccountId: 'pa_33333333-3333-4333-8333-333333333333',
    displayName: '已回同學',
    reviewedAt: '2026-10-08T09:30:00.000Z',
  };
  state.request.mockResolvedValueOnce({ submissions: [submission, peer] }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  fireEvent.change(feedback, { target: { value: '排隊中的回饋' } });
  fireEvent.submit(feedback.closest('form')!);
  expect(feedback.closest('fieldset')?.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '已回饋 1' }));
  fireEvent.click(screen.getByRole('button', { name: '尚未回饋 1' }));
  const stillPending = screen.getByLabelText('給林同學的回饋') as HTMLTextAreaElement;
  expect(stillPending.value).toBe('排隊中的回饋');
  expect(stillPending.closest('fieldset')?.disabled).toBe(true);
  fireEvent.submit(stillPending.closest('form')!);
  await act(async () =>
    finish({
      ...submission,
      teacherFeedback: '排隊中的回饋',
      reviewedAt: '2026-10-08T09:00:00.000Z',
    }),
  );
  await screen.findByText('回饋已儲存，學生現在可以查看。');
  expect(
    state.request.mock.calls.filter((call) => String(call[0]).endsWith('/feedback')),
  ).toHaveLength(1);
});

it('keeps resubmitted work in the pending-review queue while preserving the older feedback text', async () => {
  const revised = {
    ...reviewed('針對舊稿的回饋'),
    body: '學生新稿',
    submittedAt: '2026-10-08T10:00:00.000Z',
  };
  state.request.mockResolvedValueOnce({ submissions: [revised] });
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  await openSubmissions();
  expect(screen.getByRole('button', { name: '尚未回饋 1' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByText('學生新稿')).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: '目前老師回饋' })).getByText('針對舊稿的回饋'),
  ).toBeTruthy();
  expect(screen.getByText('這則回饋早於最近一次繳交，請老師確認是否仍適用。')).toBeTruthy();
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
  expect(
    await within(await screen.findByRole('region', { name: '我的繳交紀錄' })).findByText('修正版'),
  ).toBeTruthy();
  expect(reload).not.toHaveBeenCalled();
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
  expect(await screen.findByText('繳交內容已儲存，老師現在可以查看。')).toBeTruthy();
  expect(reload).not.toHaveBeenCalled();
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

it('keeps the text-only form when file submit is off', () => {
  render(
    <AssignmentCard
      item={assignment}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
    />,
  );
  expect(screen.queryByRole('button', { name: '拍照' })).toBeNull();
  expect(screen.queryByRole('button', { name: '照片轉 PDF' })).toBeNull();
  expect(screen.getByLabelText('作業內容')).toBeTruthy();
});

it('previews a photo and shows a late receipt after a confirmed file submit', async () => {
  state.fileSubmit = true;
  const fileId = 'cwf_11111111-1111-4111-8111-111111111111';
  const mine = {
    ...submission,
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    late: true,
    files: [
      {
        id: fileId,
        originalName: 'shot.jpg',
        contentType: 'image/jpeg',
        byteSize: 12,
        kind: 'image' as const,
        downloadPath: `class-workspaces/${workspace.id}/assignments/${assignment.id}/files/${fileId}/content`,
        downloadExp: '1',
        downloadSig: 'sig',
      },
    ],
  };
  let finishUpload!: (value: unknown) => void;
  state.request
    .mockResolvedValueOnce({
      intents: [
        {
          id: fileId,
          uploadPath: `class-workspaces/${workspace.id}/assignments/${assignment.id}/files/${fileId}/content`,
          originalName: 'shot.jpg',
          contentType: 'image/jpeg',
          byteSize: 12,
          kind: 'image',
        },
      ],
    })
    .mockResolvedValueOnce({ ...assignment, mySubmission: mine, submissionCount: 1 });
  state.upload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
  );
  render(
    <AssignmentCard
      item={{ ...assignment, dueAt: '2026-10-08T07:00:00.000Z' }}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
    />,
  );
  expect(screen.getByText('已過截止時間，現在送出會標為遲交')).toBeTruthy();
  expect(screen.getByText('網路不穩時再送一次，不會重複交。選好的照片可以刪除或調整順序後再送出。')).toBeTruthy();
  const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'shot.jpg', {
    type: 'image/jpeg',
  });
  const camera = document.querySelector('input[capture="environment"]') as HTMLInputElement;
  fireEvent.change(camera, { target: { files: [photo] } });
  expect(screen.getByRole('list', { name: '即將繳交的檔案' }).textContent).toContain('shot.jpg');
  expect(screen.getByRole('list', { name: '即將繳交的檔案' }).textContent).toMatch(/B|KB|MB/);
  fireEvent.click(screen.getByRole('button', { name: '放大預覽 shot.jpg' }));
  expect(screen.getByRole('dialog', { name: 'shot.jpg' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '關閉' }));
  fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
  expect(await screen.findByText('上傳中 0/1，請保持網路連線。')).toBeTruthy();
  await act(async () => finishUpload(mine.files[0]));
  const receipt = await screen.findByRole('region', { name: '我的繳交紀錄' });
  expect(within(receipt).getByText('遲交')).toBeTruthy();
  expect(state.request.mock.calls[0][0]).toContain('/files/intents');
  expect(state.request.mock.calls[0][2]).toMatchObject({
    files: [expect.objectContaining({ originalName: 'shot.jpg' })],
  });
  expect(state.request.mock.calls[1][0]).toContain('/submit-files');
  expect(state.upload).toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(receipt.textContent).toContain('shot.jpg');
  expect(screen.getByRole('link', { name: '下載' }).getAttribute('href')).toContain('download=1');
});

it('keeps selected files and does not claim success when the network fails', async () => {
  state.fileSubmit = true;
  state.request.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  render(
    <AssignmentCard
      item={assignment}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
    />,
  );
  const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'keep.jpg', {
    type: 'image/jpeg',
  });
  fireEvent.change(document.querySelector('input[capture="environment"]') as HTMLInputElement, {
    target: { files: [photo] },
  });
  fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('繳交內容已儲存，老師現在可以查看。')).toBeNull();
  expect(screen.getByRole('list', { name: '即將繳交的檔案' }).textContent).toContain('keep.jpg');
});

it('lets a student delete or reorder selected photos before submit', () => {
  state.fileSubmit = true;
  render(
    <AssignmentCard
      item={assignment}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
    />,
  );
  const camera = document.querySelector('input[capture="environment"]') as HTMLInputElement;
  fireEvent.change(camera, {
    target: { files: [new File([new Uint8Array([1])], 'first.jpg', { type: 'image/jpeg' })] },
  });
  fireEvent.change(camera, {
    target: { files: [new File([new Uint8Array([2])], 'second.jpg', { type: 'image/jpeg' })] },
  });
  const preview = screen.getByRole('list', { name: '即將繳交的檔案' });
  expect(preview.textContent).toMatch(/first\.jpg[\s\S]*second\.jpg/);
  fireEvent.click(screen.getAllByRole('button', { name: '上移' })[1]!);
  expect(preview.textContent).toMatch(/second\.jpg[\s\S]*first\.jpg/);
  fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0]!);
  expect(preview.textContent).toContain('first.jpg');
  expect(preview.textContent).not.toContain('second.jpg');
});

it('keeps the original assignment submit key when SESSION_CHANGED leaves the result uncertain', async () => {
  const mine = {
    ...submission,
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    body: '第一次送出',
  };
  state.request
    .mockRejectedValueOnce(new NuniError(409, 'SESSION_CHANGED'))
    .mockResolvedValueOnce({ ...assignment, mySubmission: mine, submissionCount: 1 });
  render(
    <AssignmentCard
      item={assignment}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
    />,
  );
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: mine.body } });
  fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
  await screen.findByRole('button', { name: '確認送出結果' });
  const first = state.request.mock.calls[0][2];
  fireEvent.click(screen.getByRole('button', { name: '確認送出結果' }));
  expect(await screen.findByText('繳交內容已儲存，老師現在可以查看。')).toBeTruthy();
  expect(state.request.mock.calls[1][2]).toEqual(first);
});

it('treats a dueAt without offset as Taipei time for display and 遲交', async () => {
  state.request.mockResolvedValueOnce({
    submissions: [
      {
        ...submission,
        submittedAt: '2026-10-22T16:00:00.000Z',
      },
    ],
  });
  render(
    <AssignmentCard
      item={{ ...assignment, dueAt: '2026-10-22T23:59:00' }}
      workspace={workspace}
      reload={reload}
    />,
  );
  expect(screen.getByText('2026/10/22 下午11:59')).toBeTruthy();
  await openSubmissions();
  expect(screen.getByText('遲交')).toBeTruthy();
  expect(screen.getByText('2026/10/23 上午12:00:00')).toBeTruthy();
});

it('shows Taipei time, 準時／遲交, and a download link on teacher receipts', async () => {
  state.fileSubmit = true;
  const fileId = 'cwf_11111111-1111-4111-8111-111111111111';
  state.request.mockResolvedValueOnce({
    submissions: [
      {
        ...submission,
        submittedAt: '2026-10-22T03:49:43.000Z',
        late: false,
        files: [
          {
            id: fileId,
            originalName: 'shot.jpg',
            contentType: 'image/jpeg',
            byteSize: 12,
            kind: 'image',
            downloadPath: `class-workspaces/${workspace.id}/assignments/${assignment.id}/files/${fileId}/content`,
            downloadExp: '1',
            downloadSig: 'sig',
          },
        ],
      },
    ],
  });
  render(
    <AssignmentCard
      item={{ ...assignment, dueAt: '2026-10-22T16:00:00.000Z' }}
      workspace={workspace}
      reload={reload}
    />,
  );
  await openSubmissions();
  expect(screen.getByText('準時')).toBeTruthy();
  expect(screen.getByText('2026/10/22 上午11:49:43')).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看' }).getAttribute('href')).not.toContain(
    'download=1',
  );
  expect(screen.getByRole('link', { name: '下載' }).getAttribute('href')).toContain('download=1');
});

it('hides the file picker after the teacher stops accepting work', () => {
  state.fileSubmit = true;
  render(
    <AssignmentCard
      item={closed}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
    />,
  );
  expect(screen.queryByRole('button', { name: '拍照' })).toBeNull();
  expect(screen.getByText('已停止收件')).toBeTruthy();
});

it('saves feedback and opens the next awaiting receipt only after server success', async () => {
  const peer = {
    ...submission,
    platformAccountId: 'pa_33333333-3333-4333-8333-333333333333',
    displayName: '陳同學',
    body: '第二份繳交',
    submittedAt: '2026-10-08T07:00:00.000Z',
  };
  state.request
    .mockResolvedValueOnce({ submissions: [submission, peer] })
    .mockResolvedValueOnce(reviewed('給林同學的回饋內容'));
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  const firstReceipt = screen.getByRole('article', { name: '林同學的繳交' });
  expect(within(firstReceipt).getByText('待回饋第 1／2 份')).toBeTruthy();
  fireEvent.change(feedback, { target: { value: '給林同學的回饋內容' } });
  fireEvent.click(within(firstReceipt).getByRole('button', { name: '儲存回饋並查看下一份' }));
  await screen.findByText('回饋已儲存。已移到 陳同學 的繳交。');
  const peerReceipt = screen.getByRole('article', { name: '陳同學的繳交' });
  expect(
    within(peerReceipt).getByText(/待回饋第 1／1 份/),
  ).toBeTruthy();
  expect(within(peerReceipt).getByText(/目前批改這一份/)).toBeTruthy();
  expect(within(peerReceipt).getByLabelText('給陳同學的回饋')).toBeTruthy();
  expect(within(peerReceipt).getByRole('button', { name: '儲存回饋' })).toBeTruthy();
});

it('keeps the draft and selected receipt when save-and-next fails', async () => {
  const peer = {
    ...submission,
    platformAccountId: 'pa_33333333-3333-4333-8333-333333333333',
    displayName: '陳同學',
    body: '第二份繳交',
    submittedAt: '2026-10-08T07:00:00.000Z',
  };
  state.request
    .mockResolvedValueOnce({ submissions: [submission, peer] })
    .mockRejectedValueOnce(new NuniError(500, 'REQUEST_FAILED'));
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  const firstReceipt = screen.getByRole('article', { name: '林同學的繳交' });
  fireEvent.change(feedback, { target: { value: '失敗仍應保留的草稿' } });
  fireEvent.click(within(firstReceipt).getByRole('button', { name: '儲存回饋並查看下一份' }));
  await within(firstReceipt).findByRole('alert');
  expect(feedback.value).toBe('失敗仍應保留的草稿');
  expect(screen.queryByText('已移到 陳同學 的繳交。')).toBeNull();
  expect(within(firstReceipt).getByRole('button', { name: '確認送出結果' })).toBeTruthy();
});

it('does not advance save-and-next when an authoritative replay returns different feedback', async () => {
  const peer = {
    ...submission,
    platformAccountId: 'pa_33333333-3333-4333-8333-333333333333',
    displayName: '陳同學',
    body: '第二份繳交',
    submittedAt: '2026-10-08T07:00:00.000Z',
  };
  state.request
    .mockResolvedValueOnce({ submissions: [submission, peer] })
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockResolvedValueOnce(reviewed('另一位老師已補充新的回饋'));
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} />);
  const feedback = await openSubmissions();
  const firstReceipt = screen.getByRole('article', { name: '林同學的繳交' });
  fireEvent.change(feedback, { target: { value: '原本送出的回饋' } });
  fireEvent.click(within(firstReceipt).getByRole('button', { name: '儲存回饋並查看下一份' }));
  await within(firstReceipt).findByRole('button', { name: '確認送出結果' });
  fireEvent.click(within(firstReceipt).getByRole('button', { name: '確認送出結果' }));
  expect(
    await within(firstReceipt).findByText('這份回饋已有新的內容，上方顯示目前儲存的版本。'),
  ).toBeTruthy();
  expect(screen.queryByText(/已移到 陳同學/)).toBeNull();
  expect(within(firstReceipt).getByText(/目前批改這一份/)).toBeTruthy();
  expect(feedback.value).toBe('另一位老師已補充新的回饋');
});

it('reveals the next receipt only inside the activity that saved, not a sibling assignment', async () => {
  const peer = {
    ...submission,
    platformAccountId: 'pa_33333333-3333-4333-8333-333333333333',
    displayName: '陳同學',
    body: '第二份繳交',
    submittedAt: '2026-10-08T07:00:00.000Z',
  };
  const otherAssignment: NuniAssignment = {
    ...assignment,
    id: 'cwa_99999999-9999-4999-8999-999999999999',
    title: '另一份作業',
  };
  state.request.mockImplementation(async (path) => {
    const route = String(path);
    if (route.endsWith('/submissions')) {
      const activityId = route.includes(otherAssignment.id) ? otherAssignment.id : assignment.id;
      return {
        submissions: [
          { ...submission, assignmentId: activityId },
          { ...peer, assignmentId: activityId },
        ],
      };
    }
    if (route.endsWith('/feedback')) {
      if (!route.includes(otherAssignment.id)) {
        throw new Error(`feedback targeted wrong activity: ${route}`);
      }
      return {
        ...reviewed('給林同學的回饋內容'),
        assignmentId: otherAssignment.id,
      };
    }
    throw new Error(`unexpected ${route}`);
  });
  render(
    <>
      <AssignmentCard item={assignment} workspace={workspace} reload={reload} />
      <AssignmentCard item={otherAssignment} workspace={workspace} reload={reload} />
    </>,
  );
  const firstCard = screen.getByRole('article', { name: assignment.title });
  const secondCard = screen.getByRole('article', { name: otherAssignment.title });
  fireEvent.click(within(firstCard).getByRole('button', { name: '查看繳交內容' }));
  await waitFor(() =>
    expect(
      document.getElementById(
        assignmentReceiptDomId(workspace.id, assignment.id, submission.platformAccountId),
      ),
    ).toBeTruthy(),
  );
  fireEvent.click(within(secondCard).getByRole('button', { name: '查看繳交內容' }));
  await waitFor(() =>
    expect(
      document.getElementById(
        assignmentReceiptDomId(workspace.id, otherAssignment.id, submission.platformAccountId),
      ),
    ).toBeTruthy(),
  );
  const firstActivityLin = document.getElementById(
    assignmentReceiptDomId(workspace.id, assignment.id, submission.platformAccountId),
  )!;
  const secondActivityLin = document.getElementById(
    assignmentReceiptDomId(workspace.id, otherAssignment.id, submission.platformAccountId),
  )!;
  expect(firstActivityLin).not.toBe(secondActivityLin);

  const secondScroll = vi.fn();
  const firstScroll = vi.fn();
  firstActivityLin.scrollIntoView = firstScroll;
  const secondPeer = document.getElementById(
    assignmentReceiptDomId(workspace.id, otherAssignment.id, peer.platformAccountId),
  )!;
  secondPeer.scrollIntoView = secondScroll;

  const secondLinArticle = within(secondActivityLin).getByRole('article', {
    name: '林同學的繳交',
  });
  fireEvent.click(within(secondLinArticle).getByText('留下回饋'));
  const editor = within(secondLinArticle).getByLabelText('給林同學的回饋') as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: '給林同學的回饋內容' } });
  fireEvent.click(within(secondLinArticle).getByRole('button', { name: '儲存回饋並查看下一份' }));
  await screen.findByText('回饋已儲存。已移到 陳同學 的繳交。');
  await waitFor(() => expect(secondScroll).toHaveBeenCalled());
  expect(firstScroll).not.toHaveBeenCalled();
});


it('送出中與離線不產生已繳收據，收到伺服器回覆後才確認同一份作業', async () => {
  let resolve!: (result: unknown) => void;
  let reject!: (error: Error) => void;
  state.request.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; }));
  const onConfirmed = vi.fn();
  render(<AssignmentCard item={{ ...assignment, dueAt: '2099-12-31T00:00:00Z' }}
    workspace={{ ...workspace, memberRole: 'student' }} reload={reload} onConfirmed={onConfirmed} />);
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '我的資料表' } });
  fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
  expect(screen.queryByRole('region', { name: '我的繳交紀錄' })).toBeNull();
  expect(onConfirmed).not.toHaveBeenCalled();
  await act(async () => reject(new Error('offline')));
  expect(screen.queryByRole('region', { name: '我的繳交紀錄' })).toBeNull();
  expect(onConfirmed).not.toHaveBeenCalled();
  expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('我的資料表');
  state.request.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
  fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
  const confirmed = { ...assignment, mySubmission: { ...submission,
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', body: '我的資料表' } };
  await act(async () => resolve(confirmed));
  expect((await screen.findByRole('region', { name: '我的繳交紀錄' })).textContent).toContain('我的資料表');
  expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({
    id: assignment.id, workspaceId: workspace.id,
    mySubmission: expect.objectContaining({ assignmentId: assignment.id, state: 'submitted' }),
  }));
});
it('withdraws a submission and keeps the cleared receipt visible after confirmation', async () => {
  state.fileSubmit = true;
  const item = { ...assignment, dueAt: '2099-10-31T12:00:00Z', mySubmission: submission };
  state.request.mockResolvedValue({ ...item, mySubmission: null, submissionCount: 0 });
  const onConfirmed = vi.fn();
  render(
    <AssignmentCard
      item={item}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
      onConfirmed={onConfirmed}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '撤回繳交' }));
  await screen.findByText('已撤回，截止前可以重新繳交。');
  expect(screen.queryByLabelText('我的繳交紀錄')).toBeNull();
  expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ mySubmission: null }));
  expect(state.request).toHaveBeenCalledWith(
    expect.stringContaining('/withdraw-submission'),
    state.context,
    expect.objectContaining({ submittedAt: submission.submittedAt }),
  );
});

it('keeps a failed withdrawal available for retry', async () => {
  state.fileSubmit = true;
  state.request.mockRejectedValueOnce(new NuniError(503, 'REQUEST_FAILED'));
  render(
    <AssignmentCard
      item={{ ...assignment, dueAt: '2099-10-31T12:00:00Z', mySubmission: submission }}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '撤回繳交' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('我的繳交紀錄')).toBeTruthy();
  expect(screen.getByRole('button', { name: '確認送出結果' })).toBeTruthy();
});

it('allows text revision after the deadline without a prohibition notice when file submission is disabled', () => {
  state.fileSubmit = false;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-10T12:00:00Z'));
  try {
    render(
      <AssignmentCard
        item={{ ...assignment, mySubmission: submission }}
        workspace={{ ...workspace, memberRole: 'student' }}
        reload={reload}
      />,
    );
    expect(screen.getByLabelText('我的繳交紀錄')).toBeTruthy();
    expect(screen.getByText('修改繳交內容')).toBeTruthy();
    expect(screen.getByRole('button', { name: '更新繳交內容' })).toBeTruthy();
    expect(screen.queryByText('已過截止時間，這份繳交不能再修改或撤回。')).toBeNull();
    expect(screen.queryByRole('button', { name: '撤回繳交' })).toBeNull();
  } finally {
    clock.mockRestore();
  }
});

it('shows the deadline state without revision or withdrawal controls', () => {
  state.fileSubmit = true;
  render(
    <AssignmentCard
      item={{ ...assignment, mySubmission: submission }}
      workspace={{ ...workspace, memberRole: 'student' }}
      reload={reload}
    />,
  );
  expect(screen.getByText('已過截止時間，這份繳交不能再修改或撤回。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '撤回繳交' })).toBeNull();
  expect(screen.queryByRole('button', { name: '更新繳交內容' })).toBeNull();
});

it.each(['alignment', 'lost-response'])(
  'recovers uploaded revision after deadline and rerender: %s',
  async (failure) => {
    state.fileSubmit = true;
    let now = Date.parse('2026-10-09T11:59:00Z');
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fileId = 'cwf_77777777-7777-4777-8777-777777777777';
    const metadata = {
      id: fileId,
      originalName: 'repair.pdf',
      contentType: 'application/pdf',
      byteSize: 4,
      kind: 'file',
      downloadPath: `class-workspaces/${workspace.id}/assignments/${assignment.id}/files/${fileId}/content`,
      downloadExp: '1',
      downloadSig: 'sig',
    };
    const original = { ...assignment, mySubmission: submission };
    const confirmed = {
      ...original,
      mySubmission: {
        ...submission,
        platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
        files: [metadata],
      },
    };
    state.request
      .mockResolvedValueOnce({ intents: [{ ...metadata, uploadPath: metadata.downloadPath }] })
      .mockRejectedValueOnce(
        failure === 'alignment'
          ? new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE')
          : new TypeError('response lost'),
      )
      .mockRejectedValueOnce(new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE'))
      .mockResolvedValueOnce(confirmed);
    state.upload.mockResolvedValue(metadata);
    const props = {
      item: original,
      workspace: { ...workspace, memberRole: 'student' as const },
      reload,
    };
    const view = render(<AssignmentCard {...props} />);
    fireEvent.change(document.querySelector('input[accept^=".pdf"]')!, {
      target: { files: [new File(['test'], 'repair.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
    await screen.findByRole('button', { name: '確認送出結果' });
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.request).toHaveBeenCalledTimes(2);
    now = Date.parse('2026-10-09T12:01:00Z');
    view.rerender(<AssignmentCard {...props} />);
    fireEvent.submit(screen.getByRole('button', { name: '確認送出結果' }).closest('form')!);
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3));
    await screen.findByRole('button', { name: '確認送出結果' });
    view.rerender(<AssignmentCard {...props} />);
    fireEvent.submit(screen.getByRole('button', { name: '確認送出結果' }).closest('form')!);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: '我的繳交紀錄' }).textContent).toContain(
        'repair.pdf',
      ),
    );
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.request).toHaveBeenCalledTimes(4);
    expect(state.request.mock.calls[3][2]).toEqual(state.request.mock.calls[1][2]);
    expect(state.request.mock.calls[2][2]).toEqual(state.request.mock.calls[1][2]);
    expect(screen.queryByRole('button', { name: '更新繳交內容' })).toBeNull();
    clock.mockRestore();
  },
);

it.each(['superseded'])(
  'refreshes current receipt after replaced recovery: %s',
  async (failure) => {
    state.fileSubmit = true;
    let now = Date.parse('2026-10-09T11:59:00Z');
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fileId = 'cwf_77777777-7777-4777-8777-777777777777';
    const metadata = {
      id: fileId,
      originalName: 'repair.pdf',
      contentType: 'application/pdf',
      byteSize: 4,
      kind: 'file',
      downloadPath: `class-workspaces/${workspace.id}/assignments/${assignment.id}/files/${fileId}/content`,
      downloadExp: '1',
      downloadSig: 'sig',
    };
    const original = { ...assignment, mySubmission: submission };
    const confirmed = {
      ...original,
      mySubmission: {
        ...submission,
        platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
        files: [metadata],
      },
    };
    state.request
      .mockResolvedValueOnce({ intents: [{ ...metadata, uploadPath: metadata.downloadPath }] })
      .mockRejectedValueOnce(
        failure === 'alignment'
          ? new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE')
          : new TypeError('response lost'),
      )
      .mockRejectedValueOnce(new NuniError(409, 'ASSIGNMENT_SUBMISSION_SUPERSEDED'))
      .mockResolvedValueOnce({
        assignments: [
          { ...confirmed, mySubmission: { ...confirmed.mySubmission, body: 'new B', files: [] } },
        ],
      });
    state.upload.mockResolvedValue(metadata);
    const props = {
      item: original,
      workspace: { ...workspace, memberRole: 'student' as const },
      reload,
    };
    const view = render(<AssignmentCard {...props} />);
    fireEvent.change(document.querySelector('input[accept^=".pdf"]')!, {
      target: { files: [new File(['test'], 'repair.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
    await screen.findByRole('button', { name: '確認送出結果' });
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.request).toHaveBeenCalledTimes(2);
    now = Date.parse('2026-10-09T12:01:00Z');
    view.rerender(<AssignmentCard {...props} />);
    fireEvent.submit(screen.getByRole('button', { name: '確認送出結果' }).closest('form')!);
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3));
    await screen.findByText('這次繳交已被較新的提交取代，請以目前回執為準。');
    expect(screen.getByRole('region', { name: '我的繳交紀錄' }).textContent).toContain('new B');
    expect(screen.queryByText('repair.pdf · 檔案')).toBeNull();
    expect(state.upload).toHaveBeenCalledTimes(1);
    clock.mockRestore();
  },
);

it('採用新同步的撤回結果並保留尚未送出的草稿', async () => {
  const mine = { ...submission, platformAccountId: 'pa_11111111-1111-4111-8111-111111111111' };
  state.request.mockResolvedValueOnce({ ...assignment, mySubmission: mine });
  const studentWorkspace: NuniWorkspace = { ...workspace, memberRole: 'student' };
  const view = render(
    <AssignmentCard
      item={assignment}
      workspace={studentWorkspace}
      reload={reload}
      syncVersion="first"
    />,
  );
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: mine.body } });
  fireEvent.submit(screen.getByLabelText('作業內容').closest('form')!);
  await screen.findByText('繳交內容已儲存，老師現在可以查看。');
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '還沒寫完的補充' } });
  view.rerender(
    <AssignmentCard
      item={assignment}
      workspace={studentWorkspace}
      reload={reload}
      syncVersion="second"
    />,
  );
  expect(screen.queryByRole('region', { name: '我的繳交紀錄' })).toBeNull();
  expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('還沒寫完的補充');
});

it('收件讀取晚到時保留剛儲存的回饋，並在慢讀取完成後才安排下一次', async () => {
  render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} syncVersion="first" />);
  const feedback = await openSubmissions();
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const older = new Promise((resolve) => { finish = resolve; });
  state.request.mockImplementation((path: string) => path.endsWith('/feedback') ? Promise.resolve(reviewed('新的回饋')) : older);
  await act(async () => { window.dispatchEvent(new Event('pageshow')); });
  const calls = state.request.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(state.request).toHaveBeenCalledTimes(calls);
  fireEvent.change(feedback, { target: { value: '新的回饋' } });
  await act(async () => { fireEvent.submit(feedback.closest('form')!); });
  expect(screen.getByText('回饋已儲存，學生現在可以查看。')).toBeTruthy();
  state.request.mockResolvedValue({ submissions: [reviewed('新的回饋')] });
  await act(async () => { finish({ submissions: [submission] }); });
  expect(screen.getByRole('region', { name: '目前老師回饋' }).textContent).toContain('新的回饋');
  vi.useRealTimers();
});

it('背景再回前景先丟棄舊收件，不等待主清單更新', async () => {
  const view = render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} syncVersion="first" />);
  await openSubmissions();
  let finish!: (value: unknown) => void;
  state.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { window.dispatchEvent(new Event('pageshow')); });
  await act(async () => {
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
  });
  let fresh!: (value: unknown) => void;
  state.request.mockImplementationOnce(() => new Promise((resolve) => { fresh = resolve; }));
  await act(async () => { finish({ submissions: [reviewed('背景前的舊回饋')] }); });
  expect(screen.queryByText('背景前的舊回饋')).toBeNull();
  await act(async () => { fresh({ submissions: [reviewed('前景的新回饋')] }); });
  expect(screen.getByRole('region', { name: '目前老師回饋', hidden: true }).textContent).toContain('前景的新回饋');
  view.unmount();
});

it('主清單頻繁更新不作廢慢收件，隱藏卡片停止自動讀取', async () => {
  const view = render(<AssignmentCard item={assignment} workspace={workspace} reload={reload} syncVersion="first" />);
  await openSubmissions();
  vi.useFakeTimers();
  try {
    let finish!: (value: unknown) => void;
    state.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => { window.dispatchEvent(new Event('pageshow')); });
    const before = state.request.mock.calls.length;
    for (let i = 0; i < 4; i++) {
      view.rerender(<AssignmentCard item={assignment} workspace={workspace} reload={reload} syncVersion={`next-${i}`} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    }
    expect(state.request).toHaveBeenCalledTimes(before);
    await act(async () => { finish({ submissions: [{ ...submission, body: '慢讀取的新內容' }] }); });
    expect(screen.getByText('慢讀取的新內容')).toBeTruthy();
    view.rerender(<AssignmentCard item={assignment} workspace={workspace} reload={reload} receiptActive={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(state.request).toHaveBeenCalledTimes(before);
    view.unmount();
  } finally { vi.useRealTimers(); }
});
