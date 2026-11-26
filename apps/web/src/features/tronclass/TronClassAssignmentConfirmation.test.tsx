import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TronClassAcknowledgedReadbackResult } from '@campus/shared/src/tronClassSubmissionConfirmation';
import type { TronClassClient } from '@/lib/tronClassIntegrationClient';
import type { TronClassPreparation, TronClassSubmissionResult } from '@/lib/tronClassIntegrationTypes';
import { TronClassAssignment } from './TronClassAssignment';
import { tronClassTime } from './TronClassSource';

const revision = 'a'.repeat(32);
const operationId = 'operation_123456789';
const owner = 'platform:synthetic-student';
const storageKey = `nuni.tronclass.pending:${owner}:12:51`;
const homework = { id: 51, courseId: 12, courseName: '資訊管理', title: '期中報告',
  deadline: null, deadlineLabel: '未提供截止時間', submitted: false,
  description: '依老師要求繳交。', href: 'https://tronclass.pu.edu.tw/course/12/learning-activity#/51' };
const preparation: TronClassPreparation = {
  source: 'tronclass', schoolId: 'pu', courseId: 12, homeworkId: 51, revision,
  title: homework.title, description: homework.description, deadline: null,
  canSubmit: false, blockedReason: '目前僅提供查證。', maxFiles: 0, maxFileBytes: 0,
  allowedContentTypes: [], rules: { status: 'unknown' }, receipt: null,
};
const confirmed: TronClassAcknowledgedReadbackResult = {
  status: 'confirmed', operationId, receipt: null,
  confirmation: { kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu',
    operationId, submissionId: 90, courseId: 12, homeworkId: 51,
    confirmedAt: '2026-11-18T08:00:00.700Z', sourceRecordedAt: '2026-11-17T08:00:00.000Z' },
};
type Client = Pick<TronClassClient, 'prepare' | 'upload' | 'submit' | 'reconcile'>;

function fixture(result: TronClassSubmissionResult = confirmed, prepareOnly = false) {
  sessionStorage.setItem(storageKey, operationId);
  const client = {
    prepare: vi.fn<Client['prepare']>(async () => preparation),
    upload: vi.fn<Client['upload']>(), submit: vi.fn<Client['submit']>(),
    reconcile: vi.fn<Client['reconcile']>(async () => result),
  };
  const onSubmitted = vi.fn();
  const onDraftChange = vi.fn();
  render(<TronClassAssignment client={client} revision={revision} owner={owner} homework={homework}
    onClose={vi.fn()} onBusy={vi.fn()} onConnectionChanged={vi.fn()}
    onSubmitted={onSubmitted} onDraftChange={onDraftChange} prepareOnly={prepareOnly} />);
  return { client, onSubmitted, onDraftChange };
}

async function reconcile() {
  fireEvent.click(await screen.findByRole('button', { name: '查證繳交結果' }));
  await waitFor(() => expect(screen.queryByText('正在核對學校的繳交紀錄…')).toBeNull());
}

beforeEach(() => sessionStorage.clear());

describe('acknowledged school-version result in the assignment view', () => {
  it('shows both time meanings and clears the matching pending operation after read-only confirmation', async () => {
    const s = fixture();
    await reconcile();
    expect(await screen.findByRole('heading', { name: '已確認校方版本' })).toBeTruthy();
    expect(screen.getByText(/^確認時間：/).textContent).toBe(`確認時間：${tronClassTime(confirmed.confirmation.confirmedAt)}`);
    expect(screen.getByText(/^來源紀錄時間：/).textContent).toBe(`來源紀錄時間：${tronClassTime(confirmed.confirmation.sourceRecordedAt)}`);
    expect(screen.getByText('校方版本：90')).toBeTruthy();
    expect(screen.queryByText(/^繳交時間：/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'TronClass 已確認收到' })).toBeNull();
    expect(screen.queryByText(preparation.blockedReason!)).toBeNull();
    expect(screen.queryByRole('button', { name: '確認送出到 TronClass' })).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(s.onSubmitted).toHaveBeenCalledTimes(1);
    expect(s.onDraftChange).toHaveBeenLastCalledWith(null);
    expect(s.client.reconcile).toHaveBeenCalledWith(operationId, revision);
    expect(s.client.submit).not.toHaveBeenCalled();
    expect(s.client.upload).not.toHaveBeenCalled();
  });

  it('keeps unavailable source record time separate from a valid version confirmation', async () => {
    fixture({ ...confirmed, confirmation: { ...confirmed.confirmation, sourceRecordedAt: null } });
    await reconcile();
    expect(await screen.findByRole('heading', { name: '已確認校方版本' })).toBeTruthy();
    expect(screen.getByText('來源紀錄時間：尚無可確認的時間')).toBeTruthy();
    expect(screen.queryByText(/^繳交時間：/)).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it.each([
    { courseId: 13 }, { homeworkId: 52 }, { operationId: 'another_operation_1234' },
    { confirmedAt: 'bad-time' }, { submittedAt: '2026-11-18T08:00:00.700Z' },
  ])('keeps the operation unresolved for a mismatched or mixed confirmation: %j', async change => {
    const s = fixture({ ...confirmed, confirmation: { ...confirmed.confirmation, ...change } });
    await reconcile();
    expect(screen.getByRole('heading', { name: '繳交結果待確認' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '已確認校方版本' })).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBe(operationId);
    expect(s.onSubmitted).not.toHaveBeenCalled();
    expect(s.client.submit).not.toHaveBeenCalled();
  });

  it('rejects a different outer operation and preserves the original recovery key', async () => {
    const s = fixture({ ...confirmed, operationId: 'another_operation_1234',
      confirmation: { ...confirmed.confirmation, operationId: 'another_operation_1234' } });
    await reconcile();
    expect(screen.getByRole('heading', { name: '繳交結果待確認' })).toBeTruthy();
    expect(sessionStorage.getItem(storageKey)).toBe(operationId);
    expect(s.onSubmitted).not.toHaveBeenCalled();
  });

  it('preserves an ordinary unknown result without exposing a new submit action', async () => {
    const s = fixture({ status: 'unknown', operationId, receipt: null });
    await reconcile();
    expect(screen.getByRole('heading', { name: '繳交結果待確認' })).toBeTruthy();
    expect(sessionStorage.getItem(storageKey)).toBe(operationId);
    expect(screen.queryByRole('button', { name: '確認送出到 TronClass' })).toBeNull();
    expect(s.onSubmitted).not.toHaveBeenCalled();
  });

  it('keeps the legacy receipt display and its submitted-at value unchanged', async () => {
    const s = fixture({ status: 'submitted', operationId,
      receipt: { source: 'tronclass', status: 'submitted', id: 'legacy-90', courseId: 12, homeworkId: 51,
        submittedAt: '2026-11-18T07:59:00.000Z', content: '原有收據本文', attachments: [] } });
    await reconcile();
    expect(await screen.findByRole('heading', { name: 'TronClass 已確認收到' })).toBeTruthy();
    expect(screen.getByText(/^繳交時間：/).textContent).toBe(`繳交時間：${tronClassTime('2026-11-18T07:59:00.000Z')}`);
    expect(screen.queryByRole('heading', { name: '已確認校方版本' })).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(s.onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('does not let Agent preparation resume a manual operation or gain a write grant', async () => {
    const s = fixture(confirmed, true);
    await waitFor(() => expect(screen.queryByText('正在確認繳交條件與既有紀錄…')).toBeNull());
    expect(screen.queryByRole('button', { name: '查證繳交結果' })).toBeNull();
    fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '準備文字' } });
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    fireEvent.click(screen.getByLabelText('我已確認課程、作業內容與附件正確'));
    const send = screen.getByRole('button', { name: '確認送出到 TronClass' });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.click(send);
    expect(s.client.reconcile).not.toHaveBeenCalled();
    expect(s.client.submit).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBe(operationId);
  });
});
