import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TronClassPreparationCancellation } from '@campus/shared/src/tronClassSubmissionCancellation';
import { TronClassRequestError, type TronClassClient } from '@/lib/tronClassIntegrationClient';
import type { TronClassPreparation } from '@/lib/tronClassIntegrationTypes';
import { TronClassAssignment } from './TronClassAssignment';

const owner = 'platform:synthetic-student';
const revision = 'a'.repeat(32);
const operationId = 'operation_123456789';
const storageKey = `nuni.tronclass.pending:${owner}:12:51`;
const homework = { id: 51, courseId: 12, courseName: '資訊管理', title: '期中報告',
  deadline: null, deadlineLabel: '未提供截止時間', submitted: false,
  description: '依老師要求繳交。', href: 'https://tronclass.pu.edu.tw/course/12/learning-activity#/51' };
const preparation: TronClassPreparation = {
  source: 'tronclass', schoolId: 'pu', courseId: 12, homeworkId: 51, revision,
  title: homework.title, description: homework.description, deadline: null,
  canSubmit: true, blockedReason: null, maxFiles: 4, maxFileBytes: 1024,
  allowedContentTypes: ['application/pdf'],
  rules: { status: 'confirmed', allowsText: true, allowsAttachments: true, maxTotalBytes: 2048 }, receipt: null,
};
const cancelled: TronClassPreparationCancellation = { status: 'cancelled', operationId, courseId: 12, homeworkId: 51 };
type Client = Pick<TronClassClient, 'prepare' | 'upload' | 'submit' | 'reconcile' | 'cancelPreparation'>;

function fixture(value: unknown = cancelled, prepareOnly = false) {
  sessionStorage.setItem(storageKey, operationId);
  const file = new File(['report'], 'report.pdf', { type: 'application/pdf' });
  const client = {
    prepare: vi.fn<Client['prepare']>(async () => preparation),
    upload: vi.fn<Client['upload']>(), submit: vi.fn<Client['submit']>(),
    reconcile: vi.fn<Client['reconcile']>(),
    cancelPreparation: vi.fn<Client['cancelPreparation']>(async () => value as TronClassPreparationCancellation),
  };
  const props = { client, revision, owner, homework, prepareOnly,
    initialDraft: { courseId: 12, homeworkId: 51, content: '保留的作業內容', files: [file] },
    onClose: vi.fn(), onBusy: vi.fn(), onConnectionChanged: vi.fn(), onSubmitted: vi.fn(), onDraftChange: vi.fn() };
  const view = render(<TronClassAssignment {...props} />);
  return { client, props, view, file };
}

async function ready() {
  await waitFor(() => expect(screen.queryByText('正在確認繳交條件與既有紀錄…')).toBeNull());
}
async function stop() {
  await ready();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '停止準備並返回編輯' }));
  });
}
function unresolved() {
  expect(screen.getByRole('heading', { name: '繳交結果待確認' })).toBeTruthy();
  expect(screen.queryByLabelText('作業內容')).toBeNull();
  expect(sessionStorage.getItem(storageKey)).toBe(operationId);
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('TronClass assignment preparation recovery', () => {
  it('keeps the draft and resets attachment state only after a scoped cancellation and local cleanup', async () => {
    const s = fixture();
    await stop();
    await screen.findByText('已停止這次準備。內容與附件已保留，請重新預覽後再繳交。');
    expect(s.client.cancelPreparation).toHaveBeenCalledWith({ revision, operationId, courseId: 12, homeworkId: 51 });
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('保留的作業內容');
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText(/已選取/)).toBeTruthy();
    expect(s.props.onDraftChange).toHaveBeenLastCalledWith({ courseId: 12, homeworkId: 51,
      content: '保留的作業內容', files: [s.file] });
    expect(s.props.onSubmitted).not.toHaveBeenCalled();
    expect(s.client.upload).not.toHaveBeenCalled();
    expect(s.client.submit).not.toHaveBeenCalled();
    expect(s.client.reconcile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    expect(screen.getByLabelText('我已確認課程、作業內容與附件正確')).toHaveProperty('checked', false);
    expect(screen.getByRole('button', { name: '確認送出到 TronClass' })).toHaveProperty('disabled', true);
  });

  it.each([
    { ...cancelled, status: 'unknown' }, {}, null, { ...cancelled, status: ['cancelled'] },
    { ...cancelled, courseId: 13 }, { ...cancelled, homeworkId: 52 },
    { ...cancelled, operationId: 'another_operation_1234' }, { ...cancelled, receipt: null },
  ])('keeps the pending operation for unknown or invalid results: %j', async value => {
    const s = fixture(value);
    await stop();
    await screen.findByRole('alert');
    unresolved();
    expect(s.props.onSubmitted).not.toHaveBeenCalled();
    expect(s.client.submit).not.toHaveBeenCalled();
  });

  it('keeps pending metadata when the network fails', async () => {
    const s = fixture();
    s.client.cancelPreparation.mockRejectedValueOnce(new Error('network unavailable'));
    await stop();
    await screen.findByRole('alert');
    unresolved();
  });

  it('keeps pending metadata and signals a lost school binding', async () => {
    const s = fixture();
    const error = new TronClassRequestError('TRONCLASS_BINDING_CHANGED', '學校連接已變更。', 409);
    s.client.cancelPreparation.mockRejectedValueOnce(error);
    await stop();
    await waitFor(() => expect(s.props.onConnectionChanged).toHaveBeenCalledWith(error));
    unresolved();
  });

  it('does not restore editing until a failed local cleanup succeeds on the next cancellation', async () => {
    const s = fixture();
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    await stop();
    await screen.findByText('已停止準備，但瀏覽器紀錄尚未更新。請再次停止準備，清除紀錄後再編輯。');
    unresolved();
    remove.mockRestore();
    await stop();
    await screen.findByLabelText('作業內容');
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(s.client.cancelPreparation).toHaveBeenCalledTimes(2);
  });

  it('does not delete a different operation saved while cancellation is pending', async () => {
    const s = fixture();
    let resolve!: (value: TronClassPreparationCancellation) => void;
    s.client.cancelPreparation.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await stop();
    sessionStorage.setItem(storageKey, 'another_operation_1234');
    await act(async () => resolve(cancelled));
    await screen.findByText('瀏覽器的操作紀錄已變更，請重新開啟作業後核對。');
    expect(sessionStorage.getItem(storageKey)).toBe('another_operation_1234');
    expect(screen.queryByLabelText('作業內容')).toBeNull();
  });

  it('locks cancellation and reconciliation until the current request finishes', async () => {
    const s = fixture();
    let resolve!: (value: TronClassPreparationCancellation) => void;
    s.client.cancelPreparation.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await stop();
    const button = screen.getByRole('button', { name: '正在停止準備…' });
    expect(button).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '查證繳交結果' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '返回作業清單' })).toHaveProperty('disabled', true);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
    expect(s.client.cancelPreparation).toHaveBeenCalledTimes(1);
    expect(s.client.reconcile).not.toHaveBeenCalled();
    expect(s.props.onBusy).toHaveBeenLastCalledWith(true);
    await act(async () => resolve(cancelled));
    expect(s.props.onBusy).toHaveBeenLastCalledWith(false);
  });

  it.each(['unmount', 'owner', 'revision', 'client'] as const)('ignores a late cancellation after %s changes', async change => {
    const s = fixture();
    let resolve!: (value: TronClassPreparationCancellation) => void;
    s.client.cancelPreparation.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await stop();
    if (change === 'unmount') s.view.unmount();
    else s.view.rerender(<TronClassAssignment {...s.props}
      {...(change === 'owner' ? { owner: 'platform:another-student' }
        : change === 'revision' ? { revision: 'b'.repeat(32) }
        : { client: { ...s.client } })} />);
    await act(async () => resolve(cancelled));
    expect(sessionStorage.getItem(storageKey)).toBe(operationId);
    expect(s.props.onSubmitted).not.toHaveBeenCalled();
    expect(s.client.upload).not.toHaveBeenCalled();
    if (change !== 'unmount') {
      expect(screen.queryByRole('button', { name: '正在停止準備…' })).toBeNull();
      expect(s.props.onBusy).toHaveBeenLastCalledWith(false);
    }
  });

  it('does not expose cancellation to Agent preparation', async () => {
    const s = fixture(cancelled, true);
    await ready();
    expect(screen.queryByRole('button', { name: '停止準備並返回編輯' })).toBeNull();
    expect(s.client.cancelPreparation).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBe(operationId);
  });
});
