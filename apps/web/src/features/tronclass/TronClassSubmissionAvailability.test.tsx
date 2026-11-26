import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TronClassPreparation, TronClassSubmissionAvailability as Availability } from '@/lib/tronClassIntegrationTypes';
import { TronClassSubmissionAvailability } from './TronClassSubmissionAvailability';
import { TronClassAssignment } from './TronClassAssignment';

const availability: Availability = {
  source: 'tronclass', courseId: 1, homeworkId: 2, revision: 'a'.repeat(32), fetchedAt: '2026-11-18T08:00:00.000Z',
  state: 'available', ordinary: { state: 'attempts-exhausted', kind: 'repeat', remainingAttempts: 0 },
  makeUp: { state: 'open', updatedAt: null }, resubmit: { state: 'disabled', updatedAt: null },
  draft: { state: 'available', submissionId: '8', count: 1 },
};
const unavailable: Availability = { ...availability, state: 'unavailable',
  ordinary: { state: 'unknown', kind: 'unknown', remainingAttempts: null },
  makeUp: { state: 'unknown', updatedAt: null }, resubmit: { state: 'unknown', updatedAt: null },
  draft: { state: 'unknown', submissionId: null, count: null } };

beforeEach(() => sessionStorage.clear());

describe('personal school submission availability', () => {
  it('separates exhausted ordinary attempts, an individual make-up opening, and the existing school draft', () => {
    render(<TronClassSubmissionAvailability availability={availability} onRetry={vi.fn()} />);
    const section = within(screen.getByRole('region', { name: '你的校方繳交狀態' }));
    expect(section.getByText('一般再次繳交')).toBeTruthy();
    expect(section.getByText('一般繳交次數已用完，剩餘 0 次')).toBeTruthy();
    expect(section.getByText('個人補交已開放')).toBeTruthy();
    expect(section.getByText('作業目前未開放重繳')).toBeTruthy();
    expect(section.getByText('校方有 1 份草稿，請至 TronClass 接續')).toBeTruthy();
    expect(section.getByText(/nuni 可送出的方式仍以本頁繳交區為準/)).toBeTruthy();
    expect(section.queryByRole('button', { name: /送出|繳交至/ })).toBeNull();
  });

  it('labels a first attempt without interpreting a null count as unlimited', () => {
    render(<TronClassSubmissionAvailability availability={{ ...availability,
      ordinary: { state: 'open', kind: 'first', remainingAttempts: null },
      draft: { state: 'ambiguous', submissionId: null, count: 2 } }} onRetry={vi.fn()} />);
    expect(screen.getByText('一般初繳')).toBeTruthy();
    expect(screen.getByText('校方目前開放')).toBeTruthy();
    expect(screen.getByText('校方有 2 份草稿，請至 TronClass 確認')).toBeTruthy();
    expect(screen.queryByText(/不限制|不限次數|剩餘 0 次/)).toBeNull();
  });

  it('makes an unavailable read retryable without inventing a closed window or empty drafts', () => {
    const onRetry = vi.fn();
    const view = render(<TronClassSubmissionAvailability availability={unavailable} onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toContain('已取得的作業內容與紀錄仍可查看');
    expect(screen.queryByText('校方沒有草稿')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新讀取繳交狀態' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.rerender(<TronClassSubmissionAvailability availability={unavailable} onRetry={onRetry} retryDisabled />);
    fireEvent.click(screen.getByRole('button', { name: '重新讀取繳交狀態' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.rerender(<TronClassSubmissionAvailability availability={{ ...unavailable, state: 'group-unsupported' }} onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toContain('小組繳交');
    expect(screen.queryByText('一般初繳')).toBeNull();
  });

  it('does not unlock the assignment submit action when the school reports an open personal window', async () => {
    const homework = { id: 2, courseId: 1, courseName: '程式設計', title: '作業', description: '請閱讀題目',
      deadline: null, deadlineLabel: '未提供截止時間', submitted: null,
      href: 'https://tronclass.pu.edu.tw/course/1/learning-activity#/2' };
    const preparation: TronClassPreparation = { source: 'tronclass', schoolId: 'pu', courseId: 1, homeworkId: 2,
      revision: availability.revision, title: homework.title, description: homework.description, deadline: null,
      canSubmit: false, blockedReason: '尚未開放站內繳交', maxFiles: 0, maxFileBytes: 0,
      allowedContentTypes: [], rules: { status: 'confirmed', allowsText: true, allowsAttachments: false, maxTotalBytes: 0 },
      receipt: null, availability };
    const client = { prepare: vi.fn().mockResolvedValue(preparation), upload: vi.fn(), submit: vi.fn(), reconcile: vi.fn() };
    render(<TronClassAssignment client={client} revision={preparation.revision} owner="firebase:student"
      homework={homework} onClose={vi.fn()} onBusy={vi.fn()} onConnectionChanged={vi.fn()} onSubmitted={vi.fn()} />);
    await screen.findByRole('region', { name: '你的校方繳交狀態' });
    expect(screen.getByText('目前可在本頁整理與預覽；正式繳交請使用 TronClass 原頁。')).toBeTruthy();
    expect(screen.queryByText('目前可在 nuni 以文字繳交，附件請至 TronClass 處理。')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '作業內容' }), { target: { value: '我的草稿答案' } });
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '我已確認課程、作業內容與附件正確' }));
    const submit = screen.getByRole('button', { name: '確認送出到 TronClass' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.upload).not.toHaveBeenCalled();
  });
});
