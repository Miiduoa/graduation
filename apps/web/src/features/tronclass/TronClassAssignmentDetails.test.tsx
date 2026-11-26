import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TronClassAssignmentDetails as AssignmentDetails, TronClassPreparation } from '@/lib/tronClassIntegrationTypes';
import { TronClassAssignmentDetails } from './TronClassAssignmentDetails';
import { TronClassAssignment } from './TronClassAssignment';

const available: Extract<AssignmentDetails, { status: 'available' }> = {
  status: 'available', fetchedAt: '2026-11-16T13:00:00.000Z',
  submissionType: 'individual', mode: 'normal',
  opensAt: '2026-11-15T00:00:00.000Z', deadline: '2026-11-20T15:59:00.000Z',
  isInProgress: true, isClosed: false,
  attempts: { unlimited: false, limit: 2, used: 2, remaining: 0 },
  resubmissionOpen: false, retractAllowed: false,
};

function show(details: AssignmentDetails) {
  return render(<TronClassAssignmentDetails details={details} onRetry={vi.fn()} />);
}

describe('school assignment settings display', () => {
  it('preserves exhausted attempts and displays Taiwan times without enabling a submission', () => {
    show(available);
    const settings = within(screen.getByRole('region', { name: '校方作業設定' }));
    expect(settings.getByText('剩餘 0 次')).toBeTruthy();
    expect(settings.getByText('已繳交 2 次 · 上限 2 次')).toBeTruthy();
    expect(settings.getByText(/11\/15\s*(?:上午)?08:00/)).toBeTruthy();
    expect(settings.getByText(/11\/20\s*(?:下午11:59|23:59)/)).toBeTruthy();
    expect(settings.getByText('未開放重交')).toBeTruthy();
    expect(settings.queryByRole('button', { name: /送出|繳交/ })).toBeNull();
  });

  it('does not infer an unlimited count, deadline, or open status when the school omits them', () => {
    show({ ...available, opensAt: null, deadline: null, mode: 'unknown', submissionType: 'unknown',
      isInProgress: null, isClosed: null, resubmissionOpen: null, retractAllowed: null,
      attempts: { unlimited: null, limit: null, used: null, remaining: null } });
    expect(screen.getByText('剩餘次數待確認')).toBeTruthy();
    expect(screen.getAllByText('校方未提供')).toHaveLength(7);
    expect(screen.queryByText('不限制次數')).toBeNull();
    expect(screen.queryByText('進行中')).toBeNull();
    expect(screen.queryByText(/尚未繳交|已繳交 0 次/)).toBeNull();
  });

  it('shows the school group and multiple-choice modes without implying nuni can submit them', () => {
    show({ ...available, submissionType: 'group', mode: 'multiple',
      attempts: { unlimited: true, limit: null, used: 0, remaining: null },
      resubmissionOpen: true, retractAllowed: true });
    expect(screen.getByText('小組繳交')).toBeTruthy();
    expect(screen.getByText('選題式作業')).toBeTruthy();
    expect(screen.getByText('不限制次數')).toBeTruthy();
    expect(screen.getByText('已繳交 0 次')).toBeTruthy();
    expect(screen.getByText('已開放重交')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not resolve contradictory source flags into an open assignment', () => {
    show({ ...available, isInProgress: true, isClosed: true });
    expect(screen.getByText('狀態待確認')).toBeTruthy();
    expect(screen.queryByText('進行中')).toBeNull();
  });

  it('offers an explicit retry for unavailable settings and respects active work', () => {
    const onRetry = vi.fn();
    const view = render(<TronClassAssignmentDetails details={{ status: 'unavailable' }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: '重新讀取作業設定' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.rerender(<TronClassAssignmentDetails details={{ status: 'unavailable' }} onRetry={onRetry} retryDisabled />);
    fireEvent.click(screen.getByRole('button', { name: '重新讀取作業設定' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('剩餘 0 次')).toBeNull();
  });
});

describe('current school settings in the assignment editor', () => {
  beforeEach(() => sessionStorage.clear());

  it('replaces old summary fields on refresh, keeps the local answer, and never treats observed settings as write permission', async () => {
    const homework = {
      id: 2, courseId: 1, courseName: '資料庫設計', title: '舊作業名稱',
      description: '已經撤下的舊要求', deadline: '2026-11-17T15:59:00.000Z',
      deadlineLabel: '明天截止', submitted: null,
      href: 'https://tronclass.pu.edu.tw/course/1/learning-activity#/2',
    };
    const preparation: TronClassPreparation = {
      source: 'tronclass', schoolId: 'pu', courseId: 1, homeworkId: 2, revision: 'a'.repeat(32),
      title: homework.title, description: homework.description, deadline: homework.deadline,
      canSubmit: false, blockedReason: '尚未開放站內繳交', maxFiles: 0, maxFileBytes: 0,
      allowedContentTypes: [], receipt: null, rules: { status: 'unknown' }, details: { status: 'unavailable' },
    };
    const client = {
      prepare: vi.fn().mockResolvedValueOnce(preparation).mockResolvedValue({
        ...preparation, title: '更新後的作業名稱', description: '', deadline: null,
        details: { ...available, deadline: null },
      }),
      upload: vi.fn(), submit: vi.fn(), reconcile: vi.fn(),
    };
    render(<TronClassAssignment client={client} revision={preparation.revision} owner="firebase:student"
      homework={homework} onClose={vi.fn()} onBusy={vi.fn()} onConnectionChanged={vi.fn()} onSubmitted={vi.fn()} />);
    await screen.findByRole('button', { name: '重新讀取作業設定' });
    fireEvent.change(screen.getByRole('textbox', { name: '作業內容' }), { target: { value: '我正在整理的答案' } });
    fireEvent.click(screen.getByRole('button', { name: '重新讀取作業設定' }));
    await screen.findByRole('heading', { name: '更新後的作業名稱' });
    expect(screen.queryByText('已經撤下的舊要求')).toBeNull();
    expect(screen.queryByText('明天截止')).toBeNull();
    expect(screen.queryByText(/11\/17/)).toBeNull();
    expect(screen.getByText('未提供截止時間')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '作業內容' }) as HTMLTextAreaElement).value).toBe('我正在整理的答案');
    expect(screen.getByText('剩餘 0 次')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '我已確認課程、作業內容與附件正確' }));
    const submit = screen.getByRole('button', { name: '確認送出到 TronClass' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.prepare).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/作業：更新後的作業名稱/)).toBeTruthy();
  });
});
