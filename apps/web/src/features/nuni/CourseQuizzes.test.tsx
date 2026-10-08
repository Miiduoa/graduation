import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  NuniError,
  type NuniQuiz,
  type NuniQuizResponse,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { CourseQuizzes } from './CourseQuizzes';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(),
  session: null as null | {
    platformAccountId: string;
    context: string;
    isPlatformOperator: boolean;
  },
}));
vi.mock('./Session', () => ({
  browserRequest: mocks.request,
  useNuniSession: () => ({ session: mocks.session, refresh: mocks.refresh }),
}));
const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const quizId = 'cwq_22222222-2222-4222-8222-222222222222';
const quizId2 = 'cwq_33333333-3333-4333-8333-333333333333';
const studentId = 'pa_44444444-4444-4444-8444-444444444444';
const teacherId = 'pa_55555555-5555-4555-8555-555555555555';
const otherId = 'pa_66666666-6666-4666-8666-666666666666';
const listPath = `class-workspaces/${workspaceId}/quizzes`;
const timestamp = '2026-10-08T08:00:00.000Z';
const workspace = (
  memberRole: NuniWorkspace['memberRole'] = 'student',
  state: NuniWorkspace['state'] = 'active',
): NuniWorkspace => ({ id: workspaceId, title: '設計研究', memberRole, state });
const answer = (extra: Partial<NuniQuizResponse> = {}): NuniQuizResponse => ({
  quizId,
  platformAccountId: studentId,
  displayName: '林同學',
  answer: '先觀察使用情境，再確認問題。',
  state: 'submitted',
  submittedAt: timestamp,
  teacherFeedback: null,
  reviewedAt: null,
  ...extra,
});
const quiz = (extra: Partial<NuniQuiz> = {}): NuniQuiz => ({
  id: quizId,
  workspaceId,
  title: '說明研究方法',
  prompt: '你會如何開始一次使用者研究？',
  state: 'open',
  createdAt: timestamp,
  closedAt: null,
  dueAt: null,
  unitId: null,
  unitTitle: null,
  responseCount: 0,
  myResponse: null,
  ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function session(account = studentId, context = 'a'.repeat(43)) {
  mocks.session = { platformAccountId: account, context, isPlatformOperator: false };
}
function replyList(items: NuniQuiz[]) {
  mocks.request.mockImplementation(async (path, _context, input) => {
    if (path === listPath && !input) return { quizzes: items };
    throw new Error(`Unexpected request ${path}`);
  });
}
function requestsTo(suffix: string) {
  return mocks.request.mock.calls.filter((call) => String(call[0]).endsWith(suffix) && call[2]);
}
function fillAnswer() {
  fireEvent.change(screen.getByLabelText('你的回答'), {
    target: { value: '先觀察使用情境，再確認問題。' },
  });
  fireEvent.click(screen.getByLabelText(/我已檢查回答/));
}
function openPublish() {
  fireEvent.click(screen.getByText('發布文字測驗'));
  fireEvent.change(screen.getByLabelText('測驗名稱'), { target: { value: '新的題目' } });
  fireEvent.change(screen.getByLabelText('題目', { exact: true }), {
    target: { value: '請提出一個研究問題。' },
  });
}
beforeEach(() => {
  mocks.request.mockReset();
  mocks.refresh.mockReset();
  session();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(timestamp));
});
afterEach(() => vi.restoreAllMocks());

it('keeps loading, failure and an empty quiz list distinct and offers a real retry', async () => {
  const pending = deferred<unknown>();
  mocks.request.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ quizzes: [] });
  render(<CourseQuizzes workspace={workspace()} />);
  expect(screen.getByText('正在讀取測驗…')).toBeTruthy();
  expect(screen.queryByText('老師還沒有發布測驗。')).toBeNull();
  await act(async () => pending.reject(new TypeError('offline')));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText('老師還沒有發布測驗。')).toBeNull();
  fireEvent.click(screen.getByText('重新讀取測驗'));
  await screen.findByText('老師還沒有發布測驗。');
});

it('preserves the original publish payload and key across an uncertain response and blocks duplicates', async () => {
  session(teacherId);
  const pending = deferred<unknown>();
  let published = false;
  mocks.request.mockImplementation(async (path, _context, input) => {
    if (path === listPath && !input) return { quizzes: [] };
    if (path === listPath && input) {
      if (!published) {
        published = true;
        return pending.promise;
      }
      return quiz({ title: '新的題目', prompt: '請提出一個研究問題。' });
    }
    throw new Error('Unexpected route');
  });
  render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  await screen.findByText('還沒有測驗。可以先發布一個文字題目。');
  openPublish();
  fireEvent.change(screen.getByLabelText('建議完成時間（選填）'), {
    target: { value: '2026-10-09T14:00' },
  });
  const button = screen.getByRole('button', { name: '發布測驗' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(requestsTo('/quizzes')).toHaveLength(1);
  expect(screen.queryByText('測驗已發布。')).toBeNull();
  await act(async () => pending.reject(new TypeError('connection lost')));
  expect(
    (screen.getByLabelText('測驗名稱') as HTMLInputElement).closest('fieldset')?.disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('測驗名稱'), { target: { value: '不應另建的內容' } });
  fireEvent.click(screen.getByRole('button', { name: '確認送出結果' }));
  await screen.findByText('測驗已發布。');
  const writes = requestsTo('/quizzes');
  expect(writes).toHaveLength(2);
  expect(writes[1][2]).toEqual(writes[0][2]);
  expect(writes[1][2]).toEqual(
    expect.objectContaining({
      title: '新的題目',
      prompt: '請提出一個研究問題。',
      dueAt: new Date('2026-10-09T14:00').toISOString(),
    }),
  );
  expect(screen.getAllByRole('article')).toHaveLength(1);
});

it('treats teacher permission rejection as a failed publish, retaining editable input', async () => {
  session(teacherId);
  mocks.request
    .mockResolvedValueOnce({ quizzes: [] })
    .mockRejectedValueOnce(new NuniError(403, 'TEACHER_REQUIRED'));
  render(<CourseQuizzes workspace={workspace('co-teacher')} />);
  await screen.findByText('還沒有測驗。可以先發布一個文字題目。');
  openPublish();
  fireEvent.click(screen.getByRole('button', { name: '發布測驗' }));
  await screen.findByText('你目前沒有這項操作的權限。');
  expect(screen.queryByText('測驗已發布。')).toBeNull();
  expect((screen.getByLabelText('測驗名稱') as HTMLInputElement).value).toBe('新的題目');
  expect(
    (screen.getByLabelText('測驗名稱') as HTMLInputElement).closest('fieldset')?.disabled,
  ).toBe(false);
});

it('requires student confirmation then displays the confirmed own answer and feedback without an edit form', async () => {
  mocks.request.mockResolvedValueOnce({ quizzes: [quiz()] }).mockResolvedValueOnce(
    quiz({
      responseCount: 1,
      myResponse: answer({ teacherFeedback: '請補充訪談對象。', reviewedAt: timestamp }),
    }),
  );
  render(<CourseQuizzes workspace={workspace()} />);
  await screen.findByText('說明研究方法');
  const textarea = screen.getByLabelText('你的回答');
  fireEvent.change(textarea, { target: { value: '先觀察使用情境，再確認問題。' } });
  fireEvent.submit(textarea.closest('form')!);
  await screen.findByRole('alert');
  expect(requestsTo('/submit')).toHaveLength(0);
  fireEvent.click(screen.getByLabelText(/我已檢查回答/));
  fireEvent.click(screen.getByRole('button', { name: '送出作答' }));
  await screen.findByText('已送出作答');
  expect(screen.getByText('先觀察使用情境，再確認問題。')).toBeTruthy();
  expect(screen.getByText('請補充訪談對象。')).toBeTruthy();
  expect(screen.queryByLabelText('你的回答')).toBeNull();
  expect(screen.queryByText('查看作答')).toBeNull();
  expect(screen.queryByText('發布文字測驗')).toBeNull();
});

it('retries an uncertain answer with the same content and idempotency key', async () => {
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz()] })
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(quiz({ responseCount: 1, myResponse: answer() }));
  render(<CourseQuizzes workspace={workspace()} />);
  await screen.findByText('說明研究方法');
  fillAnswer();
  fireEvent.click(screen.getByRole('button', { name: '送出作答' }));
  await screen.findByRole('button', { name: '確認送出結果' });
  expect(screen.queryByText('已送出作答')).toBeNull();
  fireEvent.change(screen.getByLabelText('你的回答'), {
    target: { value: '新的回答不應替換原送出內容' },
  });
  fireEvent.click(screen.getByRole('button', { name: '確認送出結果' }));
  await screen.findByText('已送出作答');
  expect(requestsTo('/submit')[1][2]).toEqual(requestsTo('/submit')[0][2]);
});

it('shows a passed suggested date truthfully while an open quiz remains answerable', async () => {
  replyList([quiz({ dueAt: '2026-10-07T08:00:00.000Z' })]);
  render(<CourseQuizzes workspace={workspace()} />);
  await screen.findByText('已過建議完成時間，老師尚未結束測驗，目前仍可送出作答。');
  expect(screen.getByLabelText('你的回答')).toBeTruthy();
});

it('closed quizzes show the absence of an answer and cannot be submitted', async () => {
  replyList([quiz({ state: 'closed', closedAt: timestamp })]);
  render(<CourseQuizzes workspace={workspace()} />);
  await screen.findByText('這份測驗已結束，沒有你的作答紀錄。');
  expect(screen.queryByLabelText('你的回答')).toBeNull();
});

it.each(['student', 'owner-teacher'] as const)(
  'archived %s views are read-only and do not call the unavailable teacher responses API',
  async (role) => {
    replyList([quiz()]);
    render(<CourseQuizzes workspace={workspace(role, 'archived')} />);
    await screen.findByText('說明研究方法');
    expect(screen.queryByText('發布文字測驗')).toBeNull();
    expect(screen.queryByText('結束測驗')).toBeNull();
    expect(screen.queryByLabelText('你的回答')).toBeNull();
    expect(screen.queryByText('查看作答')).toBeNull();
    expect(mocks.request.mock.calls).toHaveLength(1);
  },
);

it('teacher response errors do not become empty responses, and feedback only changes after acknowledgment', async () => {
  session(teacherId);
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz({ responseCount: 1 })] })
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce({ responses: [answer()] })
    .mockRejectedValueOnce(new TypeError('lost feedback response'))
    .mockResolvedValueOnce(answer({ teacherFeedback: '請補充研究對象。', reviewedAt: timestamp }));
  render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  await screen.findByText('說明研究方法');
  fireEvent.click(screen.getByRole('button', { name: '查看作答' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('尚未收到作答。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看作答' }));
  await screen.findByText('林同學');
  fireEvent.click(screen.getByText('填寫回饋'));
  fireEvent.change(screen.getByLabelText('給 林同學 的回饋'), {
    target: { value: '請補充研究對象。' },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存回饋' }));
  await screen.findByRole('button', { name: '確認送出結果' });
  expect(screen.queryByText('已儲存的回饋')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '確認送出結果' }));
  await screen.findByText('回饋已儲存，學生現在可以查看。');
  expect(
    within(screen.getByText('已儲存的回饋').parentElement!).getByText('請補充研究對象。'),
  ).toBeTruthy();
  expect(requestsTo('/feedback')[1][2]).toEqual(requestsTo('/feedback')[0][2]);
});

it('discards an old account quiz response immediately when the session changes', async () => {
  const old = deferred<unknown>();
  mocks.request.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ quizzes: [] });
  const view = render(<CourseQuizzes workspace={workspace()} />);
  session(otherId, 'b'.repeat(43));
  view.rerender(<CourseQuizzes workspace={workspace()} />);
  await screen.findByText('老師還沒有發布測驗。');
  await act(async () => old.resolve({ quizzes: [quiz({ myResponse: answer() })] }));
  expect(screen.queryByText('先觀察使用情境，再確認問題。')).toBeNull();
  expect(screen.queryByText('說明研究方法')).toBeNull();
});

it('late teacher response lists cannot expose student answers in a new session', async () => {
  session(teacherId);
  const old = deferred<unknown>();
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz({ responseCount: 1 })] })
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ quizzes: [quiz()] });
  const view = render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  await screen.findByText('說明研究方法');
  fireEvent.click(screen.getByRole('button', { name: '查看作答' }));
  session(otherId, 'b'.repeat(43));
  view.rerender(<CourseQuizzes workspace={workspace()} />);
  await screen.findByLabelText('你的回答');
  await act(async () => old.resolve({ responses: [answer()] }));
  expect(screen.queryByText('林同學')).toBeNull();
  expect(screen.queryByText('先觀察使用情境，再確認問題。')).toBeNull();
});

it('late publish acknowledgment cannot add a quiz after account switch', async () => {
  session(teacherId);
  const old = deferred<unknown>();
  mocks.request
    .mockResolvedValueOnce({ quizzes: [] })
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ quizzes: [] });
  const view = render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  await screen.findByText('還沒有測驗。可以先發布一個文字題目。');
  openPublish();
  fireEvent.click(screen.getByRole('button', { name: '發布測驗' }));
  session(otherId, 'b'.repeat(43));
  view.rerender(<CourseQuizzes workspace={workspace()} />);
  await screen.findByText('老師還沒有發布測驗。');
  await act(async () => old.resolve(quiz({ title: '前一個帳號發布的題目' })));
  expect(screen.queryByText('前一個帳號發布的題目')).toBeNull();
  expect(screen.queryByText('測驗已發布。')).toBeNull();
});

it('closing requires explicit confirmation and recovers a lost acknowledgment by reading actual state', async () => {
  session(teacherId);
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz()] })
    .mockRejectedValueOnce(new TypeError('lost close response'))
    .mockResolvedValueOnce({ quizzes: [quiz({ state: 'closed', closedAt: timestamp })] });
  render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  await screen.findByText('說明研究方法');
  fireEvent.click(screen.getByText('結束測驗'));
  const checkbox = screen.getByLabelText('我確認結束這份測驗。');
  fireEvent.submit(checkbox.closest('form')!);
  await screen.findByRole('alert');
  expect(requestsTo('/close')).toHaveLength(0);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: '確認結束測驗' }));
  await screen.findByRole('button', { name: '確認送出結果' });
  fireEvent.click(screen.getByRole('button', { name: '確認送出結果' }));
  await screen.findByText('已結束');
  expect(requestsTo('/close')).toHaveLength(1);
  expect(screen.queryByText('確認結束測驗')).toBeNull();
});

it('a close conflict is not success when the fresh server read still says open', async () => {
  session(teacherId);
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz()] })
    .mockRejectedValueOnce(new NuniError(409, 'CONFLICT'))
    .mockResolvedValueOnce({ quizzes: [quiz()] });
  render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  await screen.findByText('說明研究方法');
  fireEvent.click(screen.getByText('結束測驗'));
  fireEvent.click(screen.getByLabelText('我確認結束這份測驗。'));
  fireEvent.click(screen.getByRole('button', { name: '確認結束測驗' }));
  await screen.findByText('資料已變更，請更新後確認目前狀態。');
  expect(screen.queryByText('已結束')).toBeNull();
  expect(screen.getByText('開放作答')).toBeTruthy();
});

it('a refresh started before a confirmed publish cannot erase the new quiz afterward', async () => {
  session(teacherId);
  const refresh = deferred<unknown>();
  mocks.request
    .mockResolvedValueOnce({ quizzes: [] })
    .mockReturnValueOnce(refresh.promise)
    .mockResolvedValueOnce(quiz({ id: quizId2, title: '已確認的新題目' }));
  render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  await screen.findByText('還沒有測驗。可以先發布一個文字題目。');
  fireEvent.click(screen.getByRole('button', { name: '更新測驗' }));
  openPublish();
  fireEvent.click(screen.getByRole('button', { name: '發布測驗' }));
  await screen.findByText('已確認的新題目');
  await act(async () => refresh.resolve({ quizzes: [] }));
  expect(screen.getByText('已確認的新題目')).toBeTruthy();
});

async function openFeedbackEditor() {
  await screen.findByText('說明研究方法');
  fireEvent.click(screen.getByRole('button', { name: '查看作答' }));
  const editor = await screen.findByLabelText('給 林同學 的回饋');
  fireEvent.click(screen.getByText('修改回饋'));
  return editor as HTMLTextAreaElement;
}
const reviewedAnswer = (feedback: string, reviewedAt = timestamp) =>
  answer({ teacherFeedback: feedback, reviewedAt });

it('refreshes an untouched quiz feedback editor to the newest saved text', async () => {
  session(teacherId);
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz({ responseCount: 1 })] })
    .mockResolvedValueOnce({ responses: [reviewedAnswer('舊回饋')] })
    .mockResolvedValueOnce({
      responses: [reviewedAnswer('其他老師的新回饋', '2026-10-08T10:00:00.000Z')],
    });
  render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  const editor = await openFeedbackEditor();
  expect(editor.value).toBe('舊回饋');
  fireEvent.click(screen.getByRole('button', { name: '更新作答' }));
  await waitFor(() => expect(editor.value).toBe('其他老師的新回饋'));
  expect(screen.queryByRole('region', { name: '回饋內容已更新' })).toBeNull();
});

it('preserves a dirty quiz feedback draft and requires a choice before overwriting new feedback', async () => {
  session(teacherId);
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz({ responseCount: 1 })] })
    .mockResolvedValueOnce({ responses: [reviewedAnswer('舊回饋')] })
    .mockResolvedValueOnce({
      responses: [reviewedAnswer('其他老師的新回饋', '2026-10-08T10:00:00.000Z')],
    })
    .mockResolvedValueOnce(reviewedAnswer('自己的草稿', '2026-10-08T10:30:00.000Z'));
  render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  const editor = await openFeedbackEditor();
  fireEvent.change(editor, { target: { value: '自己的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '更新作答' }));
  await screen.findByRole('region', { name: '回饋內容已更新' });
  expect(editor.value).toBe('自己的草稿');
  fireEvent.submit(editor.closest('form')!);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '儲存回饋' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(requestsTo('/feedback')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '保留草稿，儲存時覆寫' }));
  fireEvent.submit(editor.closest('form')!);
  await screen.findByText('回饋已儲存，學生現在可以查看。');
  expect(requestsTo('/feedback')[0][2].feedback).toBe('自己的草稿');
});

it('lets teachers discard a conflicting quiz feedback draft without writing', async () => {
  session(teacherId);
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz({ responseCount: 1 })] })
    .mockResolvedValueOnce({ responses: [reviewedAnswer('舊回饋')] })
    .mockResolvedValueOnce({ responses: [reviewedAnswer('其他老師的新回饋')] });
  render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  const editor = await openFeedbackEditor();
  fireEvent.change(editor, { target: { value: '自己的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '更新作答' }));
  await screen.findByRole('region', { name: '回饋內容已更新' });
  fireEvent.click(screen.getByRole('button', { name: '改用目前回饋' }));
  expect(editor.value).toBe('其他老師的新回饋');
  expect(screen.queryByRole('region', { name: '回饋內容已更新' })).toBeNull();
  expect(requestsTo('/feedback')).toHaveLength(0);
});

it('replays an uncertain quiz feedback attempt unchanged after refreshed feedback changes', async () => {
  session(teacherId);
  const latest = reviewedAnswer('其他老師的新回饋', '2026-10-08T10:00:00.000Z');
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz({ responseCount: 1 })] })
    .mockResolvedValueOnce({ responses: [reviewedAnswer('舊回饋')] })
    .mockRejectedValueOnce(new TypeError('acknowledgment lost'))
    .mockResolvedValueOnce({ responses: [latest] })
    .mockResolvedValueOnce(latest);
  render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  const editor = await openFeedbackEditor();
  fireEvent.change(editor, { target: { value: '自己的草稿' } });
  fireEvent.submit(editor.closest('form')!);
  await screen.findByRole('button', { name: '確認送出結果' });
  const original = requestsTo('/feedback')[0][2];
  fireEvent.click(screen.getByRole('button', { name: '更新作答' }));
  await screen.findByRole('region', { name: '回饋內容已更新' });
  expect(editor.value).toBe('自己的草稿');
  expect(
    (screen.getByRole('button', { name: '改用目前回饋' }) as HTMLButtonElement).closest('fieldset')
      ?.disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '確認送出結果' }));
  await screen.findByText('這份回饋已有新的內容，上方顯示目前儲存的版本。');
  expect(requestsTo('/feedback')[1][2]).toEqual(original);
  expect(editor.value).toBe(latest.teacherFeedback);
  expect(screen.queryByText('回饋已儲存，學生現在可以查看。')).toBeNull();
});

it('does not show a pending teacher feedback receipt after the course role changes', async () => {
  session(teacherId);
  const pending = deferred<unknown>();
  mocks.request
    .mockResolvedValueOnce({ quizzes: [quiz({ responseCount: 1 })] })
    .mockResolvedValueOnce({ responses: [reviewedAnswer('舊回饋')] })
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ quizzes: [quiz()] });
  const view = render(<CourseQuizzes workspace={workspace('owner-teacher')} />);
  const editor = await openFeedbackEditor();
  fireEvent.change(editor, { target: { value: '尚未確認的回饋' } });
  fireEvent.submit(editor.closest('form')!);
  view.rerender(<CourseQuizzes workspace={workspace('student')} />);
  await screen.findByLabelText('你的回答');
  await act(async () => pending.resolve(reviewedAnswer('尚未確認的回饋')));
  expect(screen.queryByText('林同學')).toBeNull();
  expect(screen.queryByText('尚未確認的回饋')).toBeNull();
  expect(screen.queryByText('回饋已儲存，學生現在可以查看。')).toBeNull();
});
