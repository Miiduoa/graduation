import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TronClassSubmissionHistory as History } from '@campus/shared/src/tronClassSubmissionHistory';
import { TronClassRequestError } from '@/lib/tronClassIntegrationClient';
import { TronClassSubmissionHistory } from './TronClassSubmissionHistory';
import { TronClassAssignment } from './TronClassAssignment';

const revision = 'a'.repeat(32);
const history: History = {
  source: 'tronclass', courseId: 101, homeworkId: 202, fetchedAt: '2026-11-18T05:00:00.000Z',
  state: 'available', latestId: '501', entries: [{ id: '501', state: 'submitted', isLatest: true,
    createdAt: '2026-11-17T05:00:00.000Z', content: '自己的報告', contentTruncated: false,
    hasOtherResources: false, attachments: [{ name: '報告.pdf', size: 9, download: { uploadId: 601 } }],
  }],
};
const sourceHref = 'https://tronclass.pu.edu.tw/course/101/learning-activity#/202';
const result = () => ({ blob: new Blob(['%PDF-test'], { type: 'application/pdf' }), filename: '報告.pdf' });
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

it('downloads from the assignment history using the exact version and current binding', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:history');
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const download = vi.fn(async () => result());
  const client = { prepare: vi.fn(async () => ({
    source: 'tronclass' as const, schoolId: 'pu' as const, courseId: 101, homeworkId: 202, revision,
    title: '作業', description: '', deadline: null, canSubmit: false, blockedReason: '尚未開放站內繳交。',
    maxFiles: 0, maxFileBytes: 0, allowedContentTypes: [], receipt: null, history,
  })), upload: vi.fn(), submit: vi.fn(), reconcile: vi.fn(), downloadSubmissionAttachment: download };
  render(<TronClassAssignment client={client} revision={revision} owner="platform:test-account"
    homework={{ id: 202, courseId: 101, courseName: '課程', title: '作業', deadline: null,
      deadlineLabel: '未提供截止時間', submitted: true, description: '', href: sourceHref }}
    onClose={vi.fn()} onBusy={vi.fn()} onConnectionChanged={vi.fn()} onSubmitted={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '下載 報告.pdf' }));
  await screen.findByText('已開始下載。');
  expect(download).toHaveBeenCalledWith({ courseId: 101, homeworkId: 202, submissionId: '501', uploadId: 601, revision }, expect.any(AbortSignal));
  expect(create).toHaveBeenCalledOnce();
  expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('報告.pdf');
  expect(client.submit).not.toHaveBeenCalled();
  expect(client.upload).not.toHaveBeenCalled();
});

it('does not invent a download button when the school only supplies attachment metadata', () => {
  const download = vi.fn();
  render(<TronClassSubmissionHistory history={{ ...history, entries: [{ ...history.entries[0],
    attachments: [{ name: '報告.pdf', size: 9 }],
  }] }} sourceHref={sourceHref} onRetry={vi.fn()} attachmentDownload={{ revision, download }} />);
  expect(screen.queryByRole('button', { name: /下載/ })).toBeNull();
  expect(screen.getByText('報告.pdf · 9 B')).toBeTruthy();
  expect(download).not.toHaveBeenCalled();
});

it('cancels an in-flight file when the current account view unmounts and discards late bytes', async () => {
  const create = vi.spyOn(URL, 'createObjectURL');
  let finish!: (file: ReturnType<typeof result>) => void;
  const download = vi.fn(() => new Promise<ReturnType<typeof result>>(resolve => { finish = resolve; }));
  const view = render(<TronClassSubmissionHistory history={history} sourceHref={sourceHref} onRetry={vi.fn()}
    attachmentDownload={{ revision, download }} />);
  fireEvent.click(screen.getByRole('button', { name: '下載 報告.pdf' }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  expect((screen.getByRole('button', { name: '正在下載 報告.pdf' }) as HTMLButtonElement).disabled).toBe(true);
  const signal = (download.mock.calls[0] as unknown as [unknown, AbortSignal])[1];
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(result()));
  expect(create).not.toHaveBeenCalled();
});

it('passes a changed connection back to the workspace and does not expose stale bytes', async () => {
  const create = vi.spyOn(URL, 'createObjectURL');
  const onConnectionChanged = vi.fn();
  const error = new TronClassRequestError('TRONCLASS_BINDING_CHANGED', '請重新讀取課程。', 409);
  const download = vi.fn(async () => { throw error; });
  render(<TronClassSubmissionHistory history={history} sourceHref={sourceHref} onRetry={vi.fn()}
    attachmentDownload={{ revision, download, onConnectionChanged }} />);
  fireEvent.click(screen.getByRole('button', { name: '下載 報告.pdf' }));
  await waitFor(() => expect(onConnectionChanged).toHaveBeenCalledWith(error));
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByText('已開始下載。')).toBeNull();
});
