import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TronClassClient } from '@/lib/tronClassIntegrationClient';
import type { TronClassAssignmentDetails, TronClassPreparation, TronClassSubmissionRules } from '@/lib/tronClassIntegrationTypes';
import { TronClassAssignment } from './TronClassAssignment';

const revision = 'a'.repeat(32);
const homework = { id: 51, courseId: 12, courseName: '資訊管理', title: '期中報告',
  deadline: null, deadlineLabel: '未提供截止時間', submitted: false,
  description: '依老師要求繳交。', href: 'https://tronclass.pu.edu.tw/course/12/learning-activity#/51' };
const confirmed: Extract<TronClassSubmissionRules, { status: 'confirmed' }> = {
  status: 'confirmed', allowsText: true, allowsAttachments: true, maxTotalBytes: 20 * 1024 * 1024,
};
const preparation: TronClassPreparation = {
  source: 'tronclass', schoolId: 'pu', courseId: 12, homeworkId: 51, revision,
  title: homework.title, description: homework.description, deadline: null,
  canSubmit: true, blockedReason: null, maxFiles: 4, maxFileBytes: 10 * 1024 * 1024,
  allowedContentTypes: ['application/pdf', 'text/plain'], rules: confirmed, receipt: null,
};
const details: Extract<TronClassAssignmentDetails, { status: 'available' }> = {
  status: 'available', fetchedAt: '2026-11-18T07:00:00.000Z',
  submissionType: 'individual', mode: 'normal', opensAt: '2026-11-17T00:00:00.000Z',
  deadline: '2026-11-19T15:59:00.000Z', isInProgress: true, isClosed: false,
  attempts: { unlimited: false, limit: 3, used: 0, remaining: 3 },
  resubmissionOpen: false, retractAllowed: false,
};
type Client = Pick<TronClassClient, 'prepare' | 'upload' | 'submit' | 'reconcile'>;

function fixture(value: TronClassPreparation | Promise<TronClassPreparation> = preparation) {
  const uploaded: { name: string; size: number }[] = [];
  const client = {
    prepare: vi.fn<Client['prepare']>(async () => value),
    upload: vi.fn<Client['upload']>(async (input) => {
      uploaded.push({ name: input.file.name, size: input.file.size });
      return { fileId: input.fileId, name: input.file.name, contentType: input.file.type,
        size: input.file.size, sha256: 'b'.repeat(64), status: 'uploaded' };
    }),
    submit: vi.fn<Client['submit']>(async input => ({ status: 'submitted', operationId: input.operationId,
      receipt: { id: 'receipt-1', source: 'tronclass', courseId: 12, homeworkId: 51,
        status: 'submitted', submittedAt: '2026-11-16T08:00:00.000Z', content: input.content,
        attachments: uploaded } })),
    reconcile: vi.fn<Client['reconcile']>(),
  };
  render(<TronClassAssignment client={client} revision={revision} owner="platform:account-a" homework={homework}
    onClose={vi.fn()} onBusy={vi.fn()} onConnectionChanged={vi.fn()} onSubmitted={vi.fn()} />);
  return client;
}

async function ready() {
  await waitFor(() => expect(screen.queryByText('正在確認繳交條件與既有紀錄…')).toBeNull());
}
function files() {
  return [new File(['ab'], 'report.pdf', { type: 'application/pdf' }),
    new File(['cdef'], 'notes.txt', { type: 'text/plain' })];
}
function fill(selectedFiles = files(), content = '我的心得') {
  fireEvent.change(screen.getByLabelText('作業內容'), { target: { value: content } });
  if (selectedFiles.length) fireEvent.change(screen.getByLabelText('作業附件'), { target: { files: selectedFiles } });
}
function preview() {
  fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
  fireEvent.click(screen.getByLabelText('我已確認課程、作業內容與附件正確'));
}

beforeEach(() => sessionStorage.clear());

describe('TronClass confirmed rules in the editor', () => {
  it.each([undefined, { status: 'unknown' } as const])('keeps missing/unknown school rules as local preparation only: %j', async (rules) => {
    const client = fixture({ ...preparation, rules, canSubmit: rules ? false : true,
      maxFiles: 0, maxFileBytes: 0, allowedContentTypes: [] });
    await ready();
    expect(screen.getByText('本頁整理上限：', { exact: false }).textContent).toContain('最多 4 個附件');
    expect(screen.queryByText('這份作業只接受文字。')).toBeNull();
    fill();
    preview();
    expect((screen.getByRole('button', { name: '確認送出到 TronClass' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('我的心得')).toBeTruthy();
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it.each([
    { maxFiles: 0 }, { maxFileBytes: 0 }, { rules: { ...confirmed, maxTotalBytes: 0 } },
    { rules: { ...confirmed, allowsAttachments: false } },
  ])('does not replace a confirmed zero/disallowed attachment limit with editor defaults: %j', async (change) => {
    fixture({ ...preparation, ...change });
    await ready();
    expect((screen.getByLabelText('作業附件') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('這份作業目前不接受附件。')).toBeTruthy();
    expect(screen.queryByText(/最多 4 個附件/)).toBeNull();
    expect(screen.getByText('這份作業只接受文字。')).toBeTruthy();
  });

  it('asks the student to move text into an attachment instead of silently discarding it', async () => {
    const client = fixture({ ...preparation, rules: { ...confirmed, allowsText: false } });
    await ready();
    fill();
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    expect(screen.getByRole('alert').textContent).toContain('請將文字整理在附件內');
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('我的心得');
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('rejects an over-total selection while preserving the existing text before preview', async () => {
    const client = fixture({ ...preparation, rules: { ...confirmed, maxTotalBytes: 5 } });
    await ready();
    fill();
    expect(screen.getByRole('alert').textContent).toBe('附件合計不可超過 5 B。');
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('我的心得');
    expect(screen.queryByText('report.pdf')).toBeNull();
    expect(client.upload).not.toHaveBeenCalled();
  });

  it('rejects a second file with unsupported MIME metadata before accepting the batch', async () => {
    const client = fixture({ ...preparation, allowedContentTypes: [] });
    await ready();
    fill([files()[0], new File(['answer'], 'notes.txt', { type: `application/${'x'.repeat(100)}` })]);
    expect(screen.getByRole('alert').textContent).toBe('其中有無法辨識格式的附件，請重新選取檔案。');
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('我的心得');
    expect(screen.queryByText('report.pdf')).toBeNull();
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
  });
});

describe('TronClass full payload recheck before uploading', () => {
  const changes: { name: string; change: Partial<TronClassPreparation>; message: string }[] = [
    { name: 'text permission', change: { rules: { ...confirmed, allowsText: false } }, message: '這份作業只接受附件' },
    { name: 'attachment permission', change: { rules: { ...confirmed, allowsAttachments: false } }, message: '這份作業目前不接受附件' },
    { name: 'zero attachment count', change: { maxFiles: 0 }, message: '這份作業目前不接受附件' },
    { name: 'attachment count', change: { maxFiles: 1 }, message: '一次最多可加入 1 個附件' },
    { name: 'second file size', change: { maxFileBytes: 3 }, message: '單一附件不可超過 3 B' },
    { name: 'combined size', change: { rules: { ...confirmed, maxTotalBytes: 5 } }, message: '附件合計不可超過 5 B' },
    { name: 'second MIME type', change: { allowedContentTypes: ['application/pdf'] }, message: '其中有此作業不接受的檔案格式' },
    { name: 'missing rules from an older response', change: { rules: undefined }, message: '尚未確認這份作業的繳交規則' },
  ];
  it.each(changes)('checks $name before starting even the first upload', async ({ change, message }) => {
    const client = fixture();
    await ready();
    fill();
    preview();
    client.prepare.mockResolvedValueOnce({ ...preparation, ...change });
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(message));
    expect(client.prepare).toHaveBeenCalledTimes(2);
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('我的心得');
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('notes.txt')).toBeTruthy();
  });

  it('allows an exact-limit payload and uploads both files before submitting once', async () => {
    const value = { ...preparation, maxFiles: 2, maxFileBytes: 4, rules: { ...confirmed, maxTotalBytes: 6 } };
    const client = fixture(value);
    await ready();
    fill();
    preview();
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByText('TronClass 已確認收到');
    expect(client.prepare).toHaveBeenCalledTimes(2);
    expect(client.upload).toHaveBeenCalledTimes(2);
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(client.upload.mock.invocationCallOrder[1]).toBeLessThan(client.submit.mock.invocationCallOrder[0]);
  });

  it('does not keep old send permission after the latest preparation fails', async () => {
    const client = fixture();
    await ready();
    fill();
    preview();
    client.prepare.mockRejectedValueOnce(new Error('school unavailable'));
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByRole('button', { name: '重新確認繳交條件' });
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('我的心得');
    expect(screen.getByText('report.pdf')).toBeTruthy();
    preview();
    expect((screen.getByRole('button', { name: '確認送出到 TronClass' }) as HTMLButtonElement).disabled).toBe(true);
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('keeps a failed history/rules refresh from reusing previously confirmed send permission', async () => {
    const client = fixture({ ...preparation, history: { source: 'tronclass', courseId: 12, homeworkId: 51,
      state: 'unavailable', fetchedAt: '2026-11-16T08:00:00.000Z', latestId: null, entries: [] } });
    await ready();
    fill();
    preview();
    let reject!: (reason: Error) => void;
    client.prepare.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    fireEvent.click(screen.getByRole('button', { name: '重新讀取繳交紀錄' }));
    await waitFor(() => expect(client.prepare).toHaveBeenCalledTimes(2));
    await act(async () => reject(new Error('read failed')));
    await screen.findByRole('button', { name: '重新確認繳交條件' });
    fireEvent.click(screen.getByLabelText('我已確認課程、作業內容與附件正確'));
    expect((screen.getByRole('button', { name: '確認送出到 TronClass' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('我的心得')).toBeTruthy();
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
  });
});

describe('TronClass confirmation of the latest school requirements', () => {
  const initial = { ...preparation, details };
  const changes: { name: string; change: Partial<TronClassPreparation> }[] = [
    { name: 'title', change: { title: '老師更新的報告題目' } },
    { name: 'description', change: { description: '新增比較兩種演算法的要求。' } },
    { name: 'cleared description', change: { description: '' } },
    { name: 'deadline', change: { deadline: '2026-11-20T15:59:00.000Z' } },
    { name: 'submission mode', change: { details: { ...details, mode: 'multiple' } } },
    { name: 'remaining attempts', change: { details: { ...details,
      attempts: { unlimited: false, limit: 3, used: 1, remaining: 2 } } } },
    { name: 'retraction setting', change: { details: { ...details, retractAllowed: true } } },
    { name: 'unavailable details', change: { details: { status: 'unavailable' } } },
    { name: 'new total limit still fitting the payload', change: { rules: { ...confirmed, maxTotalBytes: 12 } } },
    { name: 'new file count still fitting the payload', change: { maxFiles: 3 } },
    { name: 'new per-file limit still fitting the payload', change: { maxFileBytes: 8 } },
    { name: 'new accepted formats still fitting the payload', change: {
      allowedContentTypes: ['application/pdf', 'text/plain', 'image/png'] } },
  ];
  it.each(changes)('preserves the draft and requires a new preview when $name changes', async ({ change }) => {
    const client = fixture(initial);
    await ready();
    fill();
    preview();
    client.prepare.mockResolvedValueOnce({ ...initial, ...change });
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent)
      .toContain('校方作業條件已變更，請查看最新要求並重新預覽。'));
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect((screen.getByLabelText('作業內容') as HTMLTextAreaElement).value).toBe('我的心得');
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('notes.txt')).toBeTruthy();
    expect(screen.getByRole('heading', { name: change.title ?? initial.title })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '確認送出到 TronClass' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    expect((screen.getByLabelText('我已確認課程、作業內容與附件正確') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: '確認送出到 TronClass' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows submission after the student previews and confirms the changed requirements', async () => {
    const client = fixture(initial);
    await ready();
    fill();
    preview();
    client.prepare.mockResolvedValue({ ...initial, title: '最新報告題目', description: '請比較執行時間。' });
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: '最新報告題目' })).toBeTruthy();
    expect(screen.getByText('請比較執行時間。')).toBeTruthy();
    expect(client.upload).not.toHaveBeenCalled();
    preview();
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByText('TronClass 已確認收到');
    expect(client.upload).toHaveBeenCalledTimes(2);
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(client.submit.mock.calls[0][0].content).toBe('我的心得');
  });

  it('does not invalidate confirmation when only the read time changes', async () => {
    const client = fixture(initial);
    await ready();
    fill();
    preview();
    client.prepare.mockResolvedValueOnce({ ...initial, details: {
      ...details, fetchedAt: '2026-11-18T07:01:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByText('TronClass 已確認收到');
    expect(client.upload).toHaveBeenCalledTimes(2);
    expect(client.submit).toHaveBeenCalledTimes(1);
  });

  it('does not accept confirmation of the old summary while the first preparation is pending', async () => {
    let resolve!: (value: TronClassPreparation) => void;
    const pending = new Promise<TronClassPreparation>(done => { resolve = done; });
    const client = fixture(pending);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '預覽繳交內容' }));
    const checkbox = screen.getByLabelText('我已確認課程、作業內容與附件正確') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    fireEvent.click(checkbox);
    await act(async () => resolve({ ...initial, title: '來源詳頁的最新題目' }));
    await ready();
    expect(screen.getByRole('heading', { name: '來源詳頁的最新題目' })).toBeTruthy();
    expect((screen.getByLabelText('我已確認課程、作業內容與附件正確') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: '確認送出到 TronClass' }) as HTMLButtonElement).disabled).toBe(true);
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('我已確認課程、作業內容與附件正確'));
    fireEvent.click(screen.getByRole('button', { name: '確認送出到 TronClass' }));
    await screen.findByText('TronClass 已確認收到');
    expect(client.submit).toHaveBeenCalledTimes(1);
  });
});
