import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CourseStudyPassage, type StudyTimingEntry } from './CourseStudyPassage';
import { emptyStudyPassage } from './courseStudySession';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/studyTutorRuntime', () => ({
  getStudyTutorAvailability: () => ({ available: true, downloadLabel: '本機模型' }),
  runStudyTutor: mocks.run,
}));
const passage = { id: 'p1', label: '教材原文', text: '資料庫主鍵不可以重複。' };
const answer = { title: '主鍵', explanation: '主鍵像學號。', sourceQuote: '主鍵',
  question: '主鍵可以重複嗎？', answer: '不可以。' };

function TimingPassage() {
  const [timingLog, setTimingLog] = useState<StudyTimingEntry[]>([]);
  return <CourseStudyPassage passage={passage} mode="understand" memory={emptyStudyPassage()}
    onChange={vi.fn()} timingLog={timingLog}
    onTiming={(sample) => setTimingLog([{ run: 1, ...sample }])} />;
}

beforeEach(() => mocks.run.mockReset());

it('downloads the selectable JSON and gives each URL its own lifetime across unmount', async () => {
  mocks.run.mockImplementationOnce(async (request) => {
    request.onTiming?.({ preparationMs: 21, generationMs: 32, totalMs: 53, outcome: 'success' });
    return answer;
  });
  const OriginalURL = globalThis.URL;
  const create = vi.fn<(_value: Blob) => string>()
    .mockReturnValueOnce('blob:study-timing-1')
    .mockReturnValueOnce('blob:study-timing-2');
  const revoke = vi.fn();
  const requestedUrls: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    requestedUrls.push(this.href);
  });
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke; });
  try {
    const { unmount } = render(<TimingPassage />);
    fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
    await waitFor(() => expect(screen.getByText('本段裝置端 AI 耗時紀錄（僅本頁、最近 10 次）')).toBeTruthy());
    fireEvent.click(screen.getByText('本段裝置端 AI 耗時紀錄（僅本頁、最近 10 次）'));
    const output = screen.getByRole('textbox', { name: '本段裝置端 AI 耗時紀錄 JSON' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: '全選量測 JSON' }));
    expect(document.activeElement).toBe(output);
    expect(output.selectionStart).toBe(0);
    expect(output.selectionEnd).toBe(output.value.length);
    expect(screen.getByText(/尚未確認寫入剪貼簿/)).toBeTruthy();
    vi.useFakeTimers();
    const download = screen.getByRole('button', { name: '下載量測 JSON' });
    fireEvent.click(download);
    expect(create).toHaveBeenCalledTimes(1);
    const bytes = create.mock.calls[0]?.[0] as Blob;
    expect(await bytes.text()).toBe(output.value);
    expect(screen.getByText(/無法確認檔案是否已儲存/)).toBeTruthy();
    expect(JSON.parse(output.value).measurements[0]).toEqual({
      run: 1, outcome: 'success', downloadProgressObserved: false,
      preparationMs: 21, generationMs: 32, totalMs: 53,
    });
    expect(output.value).not.toContain(passage.text);
    expect(output.value).not.toContain(answer.answer);
    vi.advanceTimersByTime(1);
    fireEvent.click(download);
    expect(requestedUrls).toEqual(['blob:study-timing-1', 'blob:study-timing-2']);
    expect(revoke).not.toHaveBeenCalled();

    unmount();
    vi.advanceTimersByTime(59_998);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:study-timing-1');
    vi.advanceTimersByTime(1);
    expect(revoke.mock.calls).toEqual([['blob:study-timing-1'], ['blob:study-timing-2']]);
  } finally {
    vi.useRealTimers();
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('keeps manual selection and failed attempts when a mobile download bridge returns a non-Blob URL', async () => {
  mocks.run.mockImplementationOnce(async (request) => {
    request.onTiming?.({ preparationMs: 33, generationMs: null, totalMs: 33, outcome: 'failed' });
    throw new Error('模擬裝置端失敗');
  });
  const OriginalURL = globalThis.URL;
  const create = vi.fn<(_value: Blob) => string>().mockReturnValue('https://example.invalid/not-a-local-download');
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; });
  try {
    render(<TimingPassage />);
    fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
    await screen.findByText('模擬裝置端失敗');
    fireEvent.click(screen.getByText('本段裝置端 AI 耗時紀錄（僅本頁、最近 10 次）'));
    const output = screen.getByRole('textbox', { name: '本段裝置端 AI 耗時紀錄 JSON' }) as HTMLTextAreaElement;
    const original = output.value;
    fireEvent.click(screen.getByRole('button', { name: '下載量測 JSON' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/瀏覽器未接受量測 JSON 下載/)).toBeTruthy();
    expect(output.value).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: '全選量測 JSON' }));
    expect(output.selectionStart).toBe(0);
    expect(output.selectionEnd).toBe(original.length);
    expect(JSON.parse(output.value).measurements[0].outcome).toBe('failed');
  } finally {
    vi.unstubAllGlobals();
  }
});
