import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TronClassSubmissionHistory as History,
  TronClassSubmissionHistoryEntry,
} from '@campus/shared/src/tronClassSubmissionHistory';
import type { TronClassClient } from '@/lib/tronClassIntegrationClient';
import type { TronClassPreparation } from '@/lib/tronClassIntegrationTypes';
import { TronClassSubmissionHistory } from './TronClassSubmissionHistory';
import { TronClassAssignment } from './TronClassAssignment';

const sourceHref = 'https://tronclass.pu.edu.tw/course/12/learning-activity#/51';
function entry(overrides: Partial<TronClassSubmissionHistoryEntry> = {}): TronClassSubmissionHistoryEntry {
  return {
    id: '100', state: 'submitted', isLatest: false, createdAt: '2026-11-16T01:00:00.000Z',
    content: '先前提交的文字。', contentTruncated: false, attachments: [], hasOtherResources: false,
    ...overrides,
  };
}
function history(overrides: Partial<History> = {}): History {
  return {
    source: 'tronclass', courseId: 12, homeworkId: 51, fetchedAt: '2026-11-16T02:00:00.000Z',
    state: 'available', latestId: null, entries: [], ...overrides,
  };
}
function show(value: History, retry = vi.fn(), retryDisabled = false) {
  return render(<TronClassSubmissionHistory history={value} sourceHref={sourceHref}
    onRetry={retry} retryDisabled={retryDisabled} />);
}

describe('TronClass read-only submission history', () => {
  it('uses the school-marked latest version even when an older submitted entry is first and has a larger ID', () => {
    const view = show(history({ latestId: '40', entries: [
      entry({ id: '900', content: '較早的已交版本。' }),
      entry({ id: '40', state: 'returned', isLatest: true, content: '需要重做的目前版本。' }),
    ] }));
    expect(screen.getByText('校方標示的目前版本：', { exact: false }).textContent).toBe('校方標示的目前版本：退回重做');
    const open = view.container.querySelectorAll('details[open]');
    expect(open).toHaveLength(1);
    expect(open[0].textContent).toContain('需要重做的目前版本。');
    expect(open[0].textContent).not.toContain('較早的已交版本。');
    const summaries = Array.from(view.container.querySelectorAll('summary')).map(node => node.textContent);
    expect(summaries[0]).toContain('歷次紀錄 · 已繳交');
    expect(summaries[1]).toContain('目前版本 · 退回重做');
    expect(summaries.every(text => text?.includes('紀錄時間：'))).toBe(true);
    expect(screen.queryByText(/繳交時間：/)).toBeNull();
    expect(screen.queryByText('TronClass 已確認收到')).toBeNull();
  });

  it.each([
    ['draft', '草稿', '這筆內容仍是草稿，尚未正式繳交。'],
    ['returned', '退回重做', '這個版本已退回重做，請查看原作業的要求。'],
    ['teacher-marked', '教師標記已繳', '教師已標記繳交狀態，此紀錄未提供作業內容。'],
    ['unknown', '狀態待確認', '校方尚未提供可確認的狀態，請開啟原作業核對。'],
  ] as const)('keeps a %s version distinct from a verified new submission', (state, label, explanation) => {
    show(history({ latestId: '100', entries: [entry({ state, isLatest: true,
      content: state === 'teacher-marked' ? '' : '校方歷次內容。' })] }));
    expect(screen.getByText('校方標示的目前版本：', { exact: false }).textContent).toBe(`校方標示的目前版本：${label}`);
    expect(screen.getByText(explanation)).toBeTruthy();
    expect(screen.queryByText('TronClass 已確認收到')).toBeNull();
  });

  it('does not infer a current version from entry order, ID, time or an older submitted state', () => {
    const view = show(history({ entries: [
      entry({ id: '2000', createdAt: '2026-11-16T01:30:00.000Z' }),
      entry({ id: '20', state: 'draft' }),
    ] }));
    expect(screen.getByText('校方未標示目前版本，可逐筆查看歷次內容。')).toBeTruthy();
    expect(screen.queryByText('校方標示的目前版本：', { exact: false })).toBeNull();
    expect(view.container.querySelectorAll('details[open]')).toHaveLength(0);
  });

  it('shows empty history without classifying the assignment as unsubmitted', () => {
    show(history());
    expect(screen.getByText('目前未取得這份作業的繳交紀錄。')).toBeTruthy();
    expect(screen.queryByText(/未繳交|尚未繳交|全部作業已完成/)).toBeNull();
    expect(screen.queryByRole('button', { name: '重新讀取繳交紀錄' })).toBeNull();
  });

  it('keeps group history on the school page without presenting a personal empty result', () => {
    show(history({ state: 'group-unsupported' }));
    expect(screen.getByText('這份作業採小組繳交，請開啟 TronClass 原作業查看小組紀錄。')).toBeTruthy();
    expect(screen.getByRole('link', { name: /查看 TronClass 原作業/ }).getAttribute('href')).toBe(sourceHref);
    expect(screen.queryByText('目前未取得這份作業的繳交紀錄。')).toBeNull();
  });

  it('offers an explicit retry only for unavailable history and respects an active operation', () => {
    const retry = vi.fn();
    const value = history({ state: 'unavailable' });
    const view = show(value, retry);
    fireEvent.click(screen.getByRole('button', { name: '重新讀取繳交紀錄' }));
    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(<TronClassSubmissionHistory history={value} sourceHref={sourceHref} onRetry={retry} retryDisabled />);
    const button = screen.getByRole('button', { name: '重新讀取繳交紀錄' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('目前未取得這份作業的繳交紀錄。')).toBeNull();
  });

  it('renders school content as text and lists attachment metadata without download links', () => {
    const content = '<img src=x onerror="alert(1)">\n<script>alert(2)</script>';
    const view = show(history({ latestId: '100', entries: [entry({ isLatest: true, content,
      contentTruncated: true, hasOtherResources: true, attachments: [
        { name: 'report.pdf', size: 1536 }, { name: 'notes.txt', size: null }, { name: 'empty.txt', size: 0 },
      ] })] }));
    expect(view.container.querySelector('img, script, iframe')).toBeNull();
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === content)).toBeTruthy();
    expect(screen.getByText('report.pdf · 1.5 KB')).toBeTruthy();
    expect(screen.getByText('notes.txt · 未提供大小')).toBeTruthy();
    expect(screen.getByText('empty.txt · 0 B')).toBeTruthy();
    expect(screen.getByText('這裡只顯示部分文字，可到原作業查看完整內容。')).toBeTruthy();
    expect(screen.getByText('這筆紀錄還有其他資源，請到原作業查看。')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /下載/ })).toBeNull();
  });
});

describe('TronClass assignment history refresh', () => {
  const revision = 'a'.repeat(32);
  const homework = {
    id: 51, courseId: 12, courseName: '資訊管理', title: '期中報告',
    deadline: null, deadlineLabel: '未提供截止時間', submitted: null,
    description: '請繳交報告。', href: sourceHref,
  };
  const preparation: TronClassPreparation = {
    source: 'tronclass', schoolId: 'pu', courseId: 12, homeworkId: 51, revision,
    title: homework.title, description: homework.description, deadline: null,
    canSubmit: false, blockedReason: '尚未開放站內繳交。',
    maxFiles: 4, maxFileBytes: 10 * 1024 * 1024, allowedContentTypes: [], receipt: null,
    history: history({ state: 'unavailable' }),
  };
  beforeEach(() => sessionStorage.clear());

  it('hides older submitted history while a restored operation still needs verification', async () => {
    const operationId = 'pending-operation-0001';
    sessionStorage.setItem('nuni.tronclass.pending:platform:account-a:12:51', operationId);
    const client = {
      prepare: vi.fn().mockResolvedValue({ ...preparation, history: history({ latestId: '100',
        entries: [entry({ isLatest: true, content: '前一次已交的內容。' })] }) }),
      upload: vi.fn(), submit: vi.fn(),
      reconcile: vi.fn().mockResolvedValue({ status: 'unknown', operationId, receipt: null }),
    } satisfies Pick<TronClassClient, 'prepare' | 'upload' | 'submit' | 'reconcile'>;
    render(<TronClassAssignment client={client} revision={revision} owner="platform:account-a" homework={homework}
      onClose={vi.fn()} onBusy={vi.fn()} onConnectionChanged={vi.fn()} onSubmitted={vi.fn()} />);
    await screen.findByText('繳交結果待確認');
    await waitFor(() => expect(screen.queryByText('正在確認繳交條件與既有紀錄…')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'TronClass 繳交紀錄' })).toBeNull();
    expect(screen.queryByText('前一次已交的內容。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查證繳交結果' }));
    await waitFor(() => expect(client.reconcile).toHaveBeenCalledWith(operationId, revision));
    expect(screen.getByText('繳交結果待確認')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'TronClass 繳交紀錄' })).toBeNull();
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.upload).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('preserves the local text and files while a history retry ends in %s', async (outcome) => {
    let resolve!: (value: TronClassPreparation) => void;
    let reject!: (reason: Error) => void;
    const pending = new Promise<TronClassPreparation>((done, fail) => { resolve = done; reject = fail; });
    const client = {
      prepare: vi.fn().mockResolvedValueOnce(preparation).mockReturnValueOnce(pending),
      upload: vi.fn(), submit: vi.fn(), reconcile: vi.fn(),
    } satisfies Pick<TronClassClient, 'prepare' | 'upload' | 'submit' | 'reconcile'>;
    render(<TronClassAssignment client={client} revision={revision} owner="platform:account-a" homework={homework}
      onClose={vi.fn()} onBusy={vi.fn()} onConnectionChanged={vi.fn()} onSubmitted={vi.fn()} />);
    await screen.findByRole('button', { name: '重新讀取繳交紀錄' });
    fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: '仍在整理的私人草稿。' } });
    fireEvent.change(screen.getByLabelText('作業附件'), { target: { files: [new File(['report'], 'draft.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: '重新讀取繳交紀錄' }));
    await waitFor(() => expect(client.prepare).toHaveBeenCalledTimes(2));
    expect(screen.getByText('正在確認繳交條件與既有紀錄…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'TronClass 繳交紀錄' })).toBeNull();
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('仍在整理的私人草稿。');
    expect(screen.getByText('draft.pdf')).toBeTruthy();
    await act(async () => {
      if (outcome === 'success') resolve({ ...preparation, history: history({ latestId: '100',
        entries: [entry({ isLatest: true, content: '從學校重新讀到的內容。' })] }) });
      else reject(new Error('school read failed'));
    });
    if (outcome === 'success') {
      await screen.findByText('從學校重新讀到的內容。');
      expect(screen.queryByText('TronClass 已確認收到')).toBeNull();
    } else {
      await screen.findByRole('button', { name: '重新確認繳交條件' });
      expect(screen.queryByRole('heading', { name: 'TronClass 繳交紀錄' })).toBeNull();
    }
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('仍在整理的私人草稿。');
    expect(screen.getByText('draft.pdf')).toBeTruthy();
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.reconcile).not.toHaveBeenCalled();
  });
});
