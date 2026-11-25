import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TronClassRequestError, type TronClassClient } from '@/lib/tronClassIntegrationClient';
import type { TronClassPreparation, TronClassSubmissionResult } from '@/lib/tronClassIntegrationTypes';
import { TronClassAssignment } from './TronClassAssignment';

const owner = 'platform:synthetic-student';
const revision = 'a'.repeat(32);
const operationId = 'operation_123456789';
const otherOperation = 'another_operation_1234';
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
type Client = Pick<TronClassClient, 'prepare' | 'upload' | 'submit' | 'reconcile'>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function submitted(id: string): TronClassSubmissionResult {
  return { status: 'submitted', operationId: id,
    receipt: { source: 'tronclass', status: 'submitted', id: 'receipt-1', courseId: 12, homeworkId: 51,
      submittedAt: '2026-11-18T07:00:00.000Z', content: '保留的作業內容', attachments: [] } };
}
function confirmed(id: string): TronClassSubmissionResult {
  return { status: 'confirmed', operationId: id, receipt: null,
    confirmation: { kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu',
      operationId: id, submissionId: 90, courseId: 12, homeworkId: 51,
      confirmedAt: '2026-11-18T07:00:00.000Z', sourceRecordedAt: '2026-11-18T06:59:00.000Z' } };
}
function fixture(pending = true) {
  if (pending) sessionStorage.setItem(storageKey, operationId);
  const client = {
    prepare: vi.fn<Client['prepare']>(async () => preparation),
    upload: vi.fn<Client['upload']>(), submit: vi.fn<Client['submit']>(), reconcile: vi.fn<Client['reconcile']>(),
  };
  const props = { client, revision, owner, homework,
    initialDraft: { courseId: 12, homeworkId: 51, content: '保留的作業內容', files: [] as File[] },
    onClose: vi.fn(), onBusy: vi.fn(), onConnectionChanged: vi.fn(), onSubmitted: vi.fn(), onDraftChange: vi.fn() };
  const view = render(<TronClassAssignment {...props} />);
  return { client, props, view };
}
async function ready() {
  await waitFor(() => expect(screen.queryByText('正在確認繳交條件與既有紀錄…')).toBeNull());
}
function preview() {
  fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
  fireEvent.click(screen.getByLabelText('我已確認課程、作業內容與附件正確'));
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('TronClass pending operation ownership across late responses', () => {
  it.each(['submitted', 'confirmed', 'not-started'] as const)(
    'does not clear a replaced operation after an original %s reconciliation result', async status => {
      const s = fixture();
      const result = deferred<TronClassSubmissionResult>();
      s.client.reconcile.mockReturnValueOnce(result.promise);
      await ready();
      fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
      expect(s.client.reconcile).toHaveBeenCalledWith(operationId, revision);
      sessionStorage.setItem(storageKey, otherOperation);
      await act(async () => {
        if (status === 'not-started') result.reject(new TronClassRequestError('TRONCLASS_SUBMISSION_NOT_STARTED', '尚未送出。', 409));
        else result.resolve(status === 'confirmed' ? confirmed(operationId) : submitted(operationId));
      });
      expect(sessionStorage.getItem(storageKey)).toBe(otherOperation);
      expect(screen.getByText('瀏覽器的操作紀錄已變更，請重新開啟作業後核對。')).toBeTruthy();
      expect(screen.getByRole('heading', { name: '繳交結果待確認' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'TronClass 已確認收到' })).toBeNull();
      expect(screen.queryByRole('heading', { name: '已確認校方版本' })).toBeNull();
      expect(s.props.onSubmitted).not.toHaveBeenCalled();
      expect(s.props.onDraftChange).not.toHaveBeenCalledWith(null);
      expect(s.client.upload).not.toHaveBeenCalled();
      expect(s.client.submit).not.toHaveBeenCalled();
    },
  );

  it.each(['submitted', 'confirmed'] as const)('does not clear a replaced operation after an original %s final response', async status => {
    const s = fixture(false);
    const result = deferred<TronClassSubmissionResult>();
    s.client.submit.mockReturnValueOnce(result.promise);
    await ready();
    preview();
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await waitFor(() => expect(s.client.submit).toHaveBeenCalledTimes(1));
    const sentOperation = s.client.submit.mock.calls[0][0].operationId;
    sessionStorage.setItem(storageKey, otherOperation);
    await act(async () => result.resolve(status === 'confirmed' ? confirmed(sentOperation) : submitted(sentOperation)));
    expect(sessionStorage.getItem(storageKey)).toBe(otherOperation);
    expect(screen.getByText('瀏覽器的操作紀錄已變更，請重新開啟作業後核對。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '繳交結果待確認' })).toBeTruthy();
    expect(s.props.onSubmitted).not.toHaveBeenCalled();
    expect(s.props.onDraftChange).not.toHaveBeenCalledWith(null);
  });

  it.each(['submitted', 'not-started'] as const)('does not clear recovery state after %s when local storage fails', async status => {
    const s = fixture();
    if (status === 'submitted') s.client.reconcile.mockResolvedValueOnce(submitted(operationId));
    else s.client.reconcile.mockRejectedValueOnce(new TronClassRequestError('TRONCLASS_SUBMISSION_NOT_STARTED', '尚未送出。', 409));
    await ready();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' })));
    expect(sessionStorage.getItem(storageKey)).toBe(operationId);
    expect(screen.getByRole('heading', { name: '繳交結果待確認' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('瀏覽器紀錄尚未更新');
    expect(s.props.onSubmitted).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('作業內容')).toBeNull();
  });

  it('does not overwrite another pending operation or start uploads after a delayed preparation', async () => {
    const s = fixture(false);
    await ready();
    fireEvent.change(screen.getByLabelText('作業附件'), { target: {
      files: [new File(['report'], 'report.pdf', { type: 'application/pdf' })] } });
    preview();
    const next = deferred<TronClassPreparation>();
    s.client.prepare.mockReturnValueOnce(next.promise);
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    sessionStorage.setItem(storageKey, otherOperation);
    await act(async () => next.resolve(preparation));
    expect(sessionStorage.getItem(storageKey)).toBe(otherOperation);
    expect(screen.getByText('瀏覽器的操作紀錄已變更，請重新開啟作業後核對。')).toBeTruthy();
    expect(s.client.upload).not.toHaveBeenCalled();
    expect(s.client.submit).not.toHaveBeenCalled();
    expect(s.props.onSubmitted).not.toHaveBeenCalled();
  });

  it.each([
    ['reconcile', 'owner'], ['reconcile', 'client'], ['reconcile', 'revision'],
    ['submit', 'owner'], ['submit', 'client'], ['submit', 'revision'],
  ] as const)('ignores a late %s response after changing %s without remounting', async (action, change) => {
    const s = fixture(action === 'reconcile');
    const result = deferred<TronClassSubmissionResult>();
    s.client[action].mockReturnValueOnce(result.promise);
    await ready();
    if (action === 'submit') preview();
    fireEvent.click(screen.getByRole('button', { name: action === 'submit' ? '確認送出到 TronClass' : '查證繳交結果' }));
    await waitFor(() => expect(s.client[action]).toHaveBeenCalledTimes(1));
    const original = sessionStorage.getItem(storageKey)!;
    const replacementOwner = 'platform:another-student';
    const replacementKey = `nuni.tronclass.pending:${replacementOwner}:12:51`;
    if (change === 'owner') sessionStorage.setItem(replacementKey, otherOperation);
    const nextRevision = change === 'revision' ? 'b'.repeat(32) : revision;
    const nextClient = change === 'client' || change === 'revision'
      ? { ...s.client, prepare: vi.fn<Client['prepare']>(async () => ({ ...preparation, revision: nextRevision })) }
      : s.client;
    s.view.rerender(<TronClassAssignment {...s.props} client={nextClient} revision={nextRevision}
      owner={change === 'owner' ? replacementOwner : owner} />);
    await act(async () => result.resolve(submitted(original)));
    expect(sessionStorage.getItem(storageKey)).toBe(original);
    if (change === 'owner') expect(sessionStorage.getItem(replacementKey)).toBe(otherOperation);
    expect(s.props.onSubmitted).not.toHaveBeenCalled();
    expect(s.props.onDraftChange).not.toHaveBeenCalledWith(null);
    expect(screen.queryByRole('heading', { name: 'TronClass 已確認收到' })).toBeNull();
    expect(s.props.onBusy).toHaveBeenLastCalledWith(false);
  });
});
