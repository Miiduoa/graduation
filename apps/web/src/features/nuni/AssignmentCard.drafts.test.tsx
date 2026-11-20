import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniAssignment, type NuniSubmission, type NuniWorkspace } from '@campus/shared/src/nuni';
import { AssignmentCard } from './AssignmentCard';

const state = vi.hoisted(() => ({ request: vi.fn(), upload: vi.fn(), fileSubmit: false }));
vi.mock('./Session', () => ({
  browserRequest: state.request,
  browserUpload: state.upload,
  useNuniSession: () => ({
    session: {
      context: 'student-session',
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
      assignmentFileSubmit: state.fileSubmit,
    },
    pendingLogout: false,
    refresh: vi.fn(),
  }),
}));

const workspace: NuniWorkspace = {
  id: 'cw_11111111-1111-4111-8111-111111111111',
  title: '資料庫',
  state: 'active',
  memberRole: 'student',
};
const submission: NuniSubmission = {
  assignmentId: 'cwa_11111111-1111-4111-8111-111111111111',
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  displayName: '同學',
  body: '第一版內容',
  state: 'submitted',
  submittedAt: '2026-11-02T01:00:00Z',
  teacherFeedback: null,
  reviewedAt: null,
};
const assignment: NuniAssignment = {
  id: submission.assignmentId,
  workspaceId: workspace.id,
  title: '資料表設計',
  instructions: '說明主鍵。',
  state: 'open',
  dueAt: '2099-11-03T01:00:00Z',
  submissionCount: 1,
  mySubmission: submission,
  createdAt: '2026-11-01T01:00:00Z',
  closedAt: null,
  unitId: null,
  unitTitle: null,
};
const newer: NuniAssignment = {
  ...assignment,
  mySubmission: { ...submission, body: '另一個分頁的新版內容', submittedAt: '2026-11-02T02:00:00Z' },
};
const props = { workspace, reload: vi.fn() };
const editor = () => screen.getByLabelText('作業內容') as HTMLTextAreaElement;

beforeEach(() => {
  state.request.mockReset().mockResolvedValue(newer);
  state.upload.mockReset();
  state.fileSubmit = false;
});
afterEach(() => vi.restoreAllMocks());

it('未編輯的作業內容跟隨最新繳交，不需要手動重新輸入', () => {
  const view = render(<AssignmentCard {...props} item={assignment} syncVersion="first" />);
  expect(editor().value).toBe('第一版內容');
  view.rerender(<AssignmentCard {...props} item={newer} syncVersion="second" />);
  expect(editor().value).toBe('另一個分頁的新版內容');
  expect(screen.queryByRole('region', { name: '繳交內容已更新' })).toBeNull();
});

it('同步發現新繳交時保留草稿，確認前不覆蓋另一個分頁的版本', async () => {
  const view = render(<AssignmentCard {...props} item={assignment} syncVersion="first" />);
  fireEvent.change(editor(), { target: { value: '尚未送出的補充' } });
  view.rerender(<AssignmentCard {...props} item={newer} syncVersion="second" />);
  expect(editor().value).toBe('尚未送出的補充');
  expect(screen.getByRole('region', { name: '繳交內容已更新' })).toBeTruthy();
  fireEvent.submit(editor().closest('form')!);
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '載入最新內容' }));
  expect(editor().value).toBe('另一個分頁的新版內容');
  expect(screen.queryByRole('region', { name: '繳交內容已更新' })).toBeNull();
});

it('確認保留草稿後才送出，成功後以回執更新編輯內容', async () => {
  const confirmed = {
    ...newer,
    mySubmission: { ...newer.mySubmission!, body: '尚未送出的補充', submittedAt: '2026-11-02T03:00:00Z' },
  };
  state.request.mockResolvedValue(confirmed);
  const onConfirmed = vi.fn();
  const view = render(<AssignmentCard {...props} item={assignment} onConfirmed={onConfirmed} syncVersion="first" />);
  fireEvent.change(editor(), { target: { value: '尚未送出的補充' } });
  view.rerender(<AssignmentCard {...props} item={newer} onConfirmed={onConfirmed} syncVersion="second" />);
  fireEvent.click(screen.getByRole('button', { name: '保留草稿，送出時取代' }));
  fireEvent.submit(editor().closest('form')!);
  await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(confirmed));
  expect(state.request.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ body: '尚未送出的補充' }));
  expect(editor().value).toBe('尚未送出的補充');
  expect(screen.queryByRole('region', { name: '繳交內容已更新' })).toBeNull();
});

it('只選檔也算未送出草稿，載入最新內容前不丟掉選檔', () => {
  state.fileSubmit = true;
  const view = render(<AssignmentCard {...props} item={assignment} syncVersion="first" />);
  fireEvent.change(document.querySelector('input[accept^=".pdf"]')!, {
    target: { files: [new File(['draft'], '我的補充.pdf', { type: 'application/pdf' })] },
  });
  view.rerender(<AssignmentCard {...props} item={newer} syncVersion="second" />);
  expect(screen.getByRole('region', { name: '繳交內容已更新' })).toBeTruthy();
  expect(screen.getByText('我的補充.pdf')).toBeTruthy();
  expect(editor().value).toBe('第一版內容');
  fireEvent.click(screen.getByRole('button', { name: '載入最新內容' }));
  expect(screen.queryByText('我的補充.pdf')).toBeNull();
  expect(editor().value).toBe('另一個分頁的新版內容');
});

it('同一份繳交只更新老師回饋時不打斷草稿', () => {
  const view = render(<AssignmentCard {...props} item={assignment} syncVersion="first" />);
  fireEvent.change(editor(), { target: { value: '尚未送出的補充' } });
  view.rerender(<AssignmentCard {...props} item={{
    ...assignment,
    mySubmission: { ...submission, teacherFeedback: '請補充外鍵', reviewedAt: '2026-11-02T02:00:00Z' },
  }} syncVersion="second" />);
  expect(editor().value).toBe('尚未送出的補充');
  expect(screen.queryByRole('region', { name: '繳交內容已更新' })).toBeNull();
});

it('檔案內容換新時提醒確認，下載簽章更新則保持草稿', () => {
  const originalFile = {
    id: 'cwf_11111111-1111-4111-8111-111111111111',
    originalName: '資料表.pdf',
    contentType: 'application/pdf',
    byteSize: 4,
    kind: 'file' as const,
    downloadPath: 'class-workspaces/course/assignments/assignment/files/file/content',
    downloadExp: '1',
    downloadSig: 'first',
  };
  const withFiles = { ...assignment, mySubmission: { ...submission, files: [originalFile] } };
  const view = render(<AssignmentCard {...props} item={withFiles} syncVersion="first" />);
  fireEvent.change(editor(), { target: { value: '尚未送出的補充' } });
  view.rerender(<AssignmentCard {...props} item={{
    ...withFiles,
    mySubmission: { ...withFiles.mySubmission, files: [{ ...originalFile, downloadExp: '2', downloadSig: 'second' }] },
  }} syncVersion="second" />);
  expect(screen.queryByRole('region', { name: '繳交內容已更新' })).toBeNull();
  view.rerender(<AssignmentCard {...props} item={{
    ...withFiles,
    mySubmission: { ...withFiles.mySubmission, files: [{ ...originalFile, id: 'cwf_22222222-2222-4222-8222-222222222222' }] },
  }} syncVersion="third" />);
  expect(screen.getByRole('region', { name: '繳交內容已更新' })).toBeTruthy();
  expect(editor().value).toBe('尚未送出的補充');
});

it('繳交已撤回時保留未送出草稿，確認後才能重新提交', () => {
  const view = render(<AssignmentCard {...props} item={assignment} syncVersion="first" />);
  fireEvent.change(editor(), { target: { value: '尚未送出的補充' } });
  view.rerender(<AssignmentCard {...props} item={{ ...assignment, mySubmission: null }} syncVersion="second" />);
  expect(editor().value).toBe('尚未送出的補充');
  expect(screen.getByRole('region', { name: '繳交內容已更新' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '載入最新內容' }));
  expect(editor().value).toBe('');
});

it('斷線後仍以同一筆內容與 key 確認結果，不被同步衝突改成新提交', async () => {
  state.request
    .mockRejectedValueOnce(new NuniError(503, 'REQUEST_FAILED'))
    .mockResolvedValueOnce(newer);
  const view = render(<AssignmentCard {...props} item={assignment} syncVersion="first" />);
  fireEvent.change(editor(), { target: { value: '尚未送出的補充' } });
  fireEvent.submit(editor().closest('form')!);
  await screen.findByRole('button', { name: '確認送出結果' });
  const original = state.request.mock.calls[0]?.[2];
  view.rerender(<AssignmentCard {...props} item={newer} syncVersion="second" />);
  expect(editor().value).toBe('尚未送出的補充');
  fireEvent.submit(editor().closest('form')!);
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  expect(state.request.mock.calls[1]?.[2]).toEqual(original);
  await waitFor(() => expect(editor().value).toBe('另一個分頁的新版內容'));
  expect(screen.queryByRole('region', { name: '繳交內容已更新' })).toBeNull();
});

it('已確認送出後到達的舊清單不把新稿誤判成衝突', async () => {
  const view = render(<AssignmentCard {...props} item={assignment} syncVersion="first" />);
  fireEvent.change(editor(), { target: { value: newer.mySubmission!.body } });
  fireEvent.submit(editor().closest('form')!);
  await screen.findByText('繳交內容已儲存，老師現在可以查看。');
  view.rerender(<AssignmentCard {...props} item={assignment} syncVersion="first" />);
  expect(editor().value).toBe(newer.mySubmission!.body);
  expect(screen.queryByRole('region', { name: '繳交內容已更新' })).toBeNull();
});

it('送出回應晚到時不以舊回執取代已同步的新繳交', async () => {
  let finish!: (value: NuniAssignment) => void;
  state.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const onConfirmed = vi.fn();
  const view = render(<AssignmentCard {...props} item={assignment} syncVersion="first" onConfirmed={onConfirmed} />);
  fireEvent.change(editor(), { target: { value: '這個分頁的送出' } });
  fireEvent.submit(editor().closest('form')!);
  const current = { ...newer, mySubmission: { ...newer.mySubmission!, submittedAt: '2026-11-02T03:00:00Z' } };
  view.rerender(<AssignmentCard {...props} item={current} syncVersion="second" onConfirmed={onConfirmed} />);
  finish({ ...assignment, mySubmission: { ...submission, body: '這個分頁的送出', submittedAt: '2026-11-02T02:00:00Z' } });
  await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(current));
  expect(editor().value).toBe(current.mySubmission.body);
  expect(screen.queryByRole('region', { name: '繳交內容已更新' })).toBeNull();
});

it('同步時鐘先前進但內容仍舊時，保留之後確認的新回執與編輯內容', async () => {
  let finish!: (value: NuniAssignment) => void;
  state.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<AssignmentCard {...props} item={assignment} syncVersion="first" />);
  fireEvent.change(editor(), { target: { value: newer.mySubmission!.body } });
  fireEvent.submit(editor().closest('form')!);
  // A poll can finish before the mutation commits, without updating the submitted content.
  view.rerender(<AssignmentCard {...props} item={assignment} syncVersion="second" />);
  finish(newer);
  await screen.findByText('繳交內容已儲存，老師現在可以查看。');
  expect(screen.getByRole('region', { name: '我的繳交紀錄' }).textContent).toContain(newer.mySubmission!.body);
  expect(editor().value).toBe(newer.mySubmission!.body);
  expect(screen.queryByRole('region', { name: '繳交內容已更新' })).toBeNull();
  // The parent deliberately keeps its old item prop after onConfirmed would normally run.
  view.rerender(<AssignmentCard {...props} item={assignment} syncVersion="second" />);
  expect(editor().value).toBe(newer.mySubmission!.body);
});
