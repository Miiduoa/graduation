import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  const [memory, setMemory] = useState(emptyStudyPassage);
  return <CourseStudyPassage passage={passage} mode="understand" memory={memory}
    onChange={setMemory} timingLog={timingLog}
    onTiming={(sample) => setTimingLog((previous) => [...previous, { run: previous.length + 1, ...sample }])} />;
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
    await waitFor(() => expect(screen.getByText('本段裝置端 AI 耗時紀錄（最近 10 次，編號持續累加）')).toBeTruthy());
    fireEvent.click(screen.getByText('本段裝置端 AI 耗時紀錄（最近 10 次，編號持續累加）'));
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
      run: 1, mode: 'understand', outcome: 'success', downloadProgressObserved: false,
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
    fireEvent.click(screen.getByText('本段裝置端 AI 耗時紀錄（最近 10 次，編號持續累加）'));
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

it('copies the exact JSON only after the standard Clipboard Promise<void> response, with a selectable fallback for broken mobile bridges', async () => {
  mocks.run.mockImplementationOnce(async (request) => {
    request.onTiming?.({ preparationMs: 15, generationMs: 18, totalMs: 33, outcome: 'success' });
    return answer;
  });
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn().mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('permission denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<TimingPassage />);
    fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
    fireEvent.click(await screen.findByText('本段裝置端 AI 耗時紀錄（最近 10 次，編號持續累加）'));
    const output = screen.getByRole('textbox', { name: '本段裝置端 AI 耗時紀錄 JSON' }) as HTMLTextAreaElement;
    const copy = screen.getByRole('button', { name: '複製量測 JSON' });

    fireEvent.click(copy);
    await waitFor(() => expect(screen.getByText(/瀏覽器已接受複製指令/)).toBeTruthy());
    expect(writeText).toHaveBeenLastCalledWith(output.value);
    expect(output.value).not.toContain(passage.text);

    copy.focus();
    fireEvent.click(copy);
    await waitFor(() => expect(screen.getByText(/已全選這份量測 JSON/)).toBeTruthy());
    expect(document.activeElement).toBe(output);
    expect(output.selectionStart).toBe(0);
    expect(output.selectionEnd).toBe(output.value.length);
    expect(screen.getByText(/尚未確認寫入剪貼簿/)).toBeTruthy();

    copy.focus();
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByText(/尚未確認寫入剪貼簿/)).toBeTruthy());
    expect(output.value).toContain('"format": "nuni-study-tutor-timing"');
  } finally {
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

async function openTimingExport() {
  mocks.run.mockImplementationOnce(async (request) => {
    request.onTiming?.({ preparationMs: 15, generationMs: 18, totalMs: 33, outcome: 'success' });
    return answer;
  });
  const { unmount } = render(<TimingPassage />);
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  fireEvent.click(await screen.findByText('本段裝置端 AI 耗時紀錄（最近 10 次，編號持續累加）'));
  return {
    unmount,
    copy: screen.getByRole('button', { name: '複製量測 JSON' }),
    output: screen.getByRole<HTMLTextAreaElement>('textbox', { name: '本段裝置端 AI 耗時紀錄 JSON' }),
  };
}

async function withClipboardTimers(writeText: (text: string) => Promise<unknown>, run: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let settlePending!: () => void;
  const cleanup = new Promise<void>((resolve) => { settlePending = resolve; });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text: string) => Promise.race([writeText(text), cleanup]) },
  });
  vi.useFakeTimers();
  try {
    await run();
  } finally {
    await act(async () => settlePending());
    vi.useRealTimers();
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
}

it.each([false, true])('preserves note input after a clipboard timeout (note blurred: %s)', async (blurNote) => {
  const { copy, output } = await openTimingExport();
  await withClipboardTimers(() => new Promise(() => {}), async () => {
    copy.focus();
    fireEvent.click(copy);
    const note = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '用自己的話記下這一段' });
    note.focus();
    fireEvent.change(note, { target: { value: '筆記內容' } });
    note.setSelectionRange(1, 3);
    if (blurNote) note.blur();

    act(() => vi.advanceTimersByTime(5000));

    expect(document.activeElement).toBe(blurNote ? document.body : note);
    expect(note.value).toBe('筆記內容');
    expect([note.selectionStart, note.selectionEnd]).toEqual([1, 3]);
    expect(output.readOnly).toBe(true);
    expect(output.closest('details')?.open).toBe(true);
    expect(output.value).toContain('nuni-study-tutor-timing');
    const status = screen.getByText(/瀏覽器未確認複製/);
    expect(status.getAttribute('aria-live')).toBe('polite');
    if (!blurNote) {
      fireEvent.change(note, { target: { value: '筆記內容繼續寫' } });
      expect(note.value).toBe('筆記內容繼續寫');
    }
  });
});

it.each(['tab blur', 'background then return'])(
  'does not steal focus after %s while clipboard acknowledgement is pending', async (scenario) => {
    const { copy, output } = await openTimingExport();
    await withClipboardTimers(() => new Promise(() => {}), async () => {
      copy.focus();
      fireEvent.click(copy);
      expect(document.activeElement).toBe(copy);
      const previousVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      try {
        if (scenario === 'tab blur') {
          window.dispatchEvent(new Event('blur'));
        } else {
          let visible = false;
          Object.defineProperty(document, 'visibilityState', {
            configurable: true, get: () => visible ? 'visible' : 'hidden',
          });
          document.dispatchEvent(new Event('visibilitychange'));
          visible = true;
          document.dispatchEvent(new Event('visibilitychange'));
        }
        act(() => vi.advanceTimersByTime(5000));
        expect(document.activeElement).toBe(copy);
        expect(output.selectionStart).toBe(0);
        expect(output.selectionEnd).toBe(0);
        expect(screen.getByText(/瀏覽器未確認複製/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '全選量測 JSON' }));
        expect(document.activeElement).toBe(output);
        expect([output.selectionStart, output.selectionEnd]).toEqual([0, output.value.length]);
      } finally {
        if (previousVisibility) Object.defineProperty(document, 'visibilityState', previousVisibility);
        else Reflect.deleteProperty(document, 'visibilityState');
      }
    });
  },
);

it('focuses and selects the fallback on timeout while the copy button retains focus', async () => {
  const { copy, output } = await openTimingExport();
  await withClipboardTimers(() => new Promise(() => {}), async () => {
    copy.focus();
    fireEvent.click(copy);
    act(() => vi.advanceTimersByTime(5000));
    expect(document.activeElement).toBe(output);
    expect([output.selectionStart, output.selectionEnd]).toEqual([0, output.value.length]);
  });
});

it('ignores the previous copy timer and late clipboard result after a second click', async () => {
  const { copy, output } = await openTimingExport();
  let resolveFirst!: (value: unknown) => void;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const writeText = vi.fn(() => new Promise(() => {})).mockReturnValueOnce(first);
  await withClipboardTimers(writeText, async () => {
    copy.focus();
    fireEvent.click(copy);
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(copy);
    act(() => vi.advanceTimersByTime(4000));
    await act(async () => resolveFirst(undefined));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(copy);
    expect(screen.getByText(/正在等待瀏覽器確認複製/)).toBeTruthy();

    act(() => vi.advanceTimersByTime(5000));
    expect(document.activeElement).toBe(output);
    expect(screen.getByText(/已全選這份量測 JSON/)).toBeTruthy();
  });
});

async function addTimingMeasurement() {
  mocks.run.mockImplementationOnce(async (request) => {
    request.onTiming?.({ preparationMs: 21, generationMs: 29, totalMs: 50, outcome: 'success' });
    return answer;
  });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '只依原文重新講解' })));
}

function clipboardCompletion() {
  let complete!: () => void;
  let fail!: () => void;
  const result = new Promise<void>((resolve, reject) => {
    complete = resolve;
    fail = () => reject(new Error('clipboard denied'));
  });
  return { result, complete, fail };
}

it.each([
  { clicks: 2, staleFails: false },
  { clicks: 3, staleFails: false },
  { clicks: 2, staleFails: true },
])('keeps the latest JSON after $clicks clicks (stale write fails: $staleFails)', async ({ clicks, staleFails }) => {
  const { copy, output } = await openTimingExport();
  const first = clipboardCompletion();
  const latest = clipboardCompletion();
  let pasted = '';
  const writeText = vi.fn((text: string) => latest.result.then(() => { pasted = text; }))
    .mockImplementationOnce((text) => first.result.then(() => { pasted = text; }));

  await withClipboardTimers(writeText, async () => {
    const original = output.value;
    fireEvent.click(copy);
    for (let index = 1; index < clicks; index += 1) {
      await addTimingMeasurement();
      fireEvent.click(copy);
    }
    const expected = output.value;
    expect(JSON.parse(expected).measurements.map((entry: StudyTimingEntry) => entry.run))
      .toEqual(Array.from({ length: clicks }, (_, index) => index + 1));

    // If submitted early, the newest write would finish before the oldest one.
    await act(async () => latest.complete());
    expect(writeText.mock.calls).toEqual([[original]]);
    expect(pasted).toBe('');
    expect(screen.getAllByRole('status').map((status) => status.textContent).join(' ')).toContain('正在等待瀏覽器確認複製');

    await act(async () => (staleFails ? first.fail() : first.complete()));
    expect(writeText.mock.calls).toEqual([[original], [expected]]);
    expect(pasted).toBe(expected);
    expect(screen.getAllByRole('status').map((status) => status.textContent).join(' ')).toContain('瀏覽器已接受複製指令');
  });
});

it('retries a failed copy using the latest measurements', async () => {
  const { copy, output } = await openTimingExport();
  const first = clipboardCompletion();
  let pasted = '';
  const writeText = vi.fn(async (text: string) => { pasted = text; })
    .mockReturnValueOnce(first.result);

  await withClipboardTimers(writeText, async () => {
    const original = output.value;
    fireEvent.click(copy);
    await act(async () => first.fail());
    expect(screen.getAllByRole('status').map((status) => status.textContent).join(' ')).toMatch(/未確認/);
    await addTimingMeasurement();

    copy.focus();
    await act(async () => fireEvent.click(copy));
    expect(writeText.mock.calls).toEqual([[original], [output.value]]);
    expect(JSON.parse(pasted).measurements).toHaveLength(2);
    expect(pasted).toBe(output.value);
    expect(screen.getAllByRole('status').map((status) => status.textContent).join(' ')).toContain('瀏覽器已接受複製指令');
  });
});

it('clears the copy timer and ignores late clipboard rejection after unmount', async () => {
  const { unmount, copy, output } = await openTimingExport();
  let rejectClipboard!: () => void;
  const clipboard = new Promise((_, reject) => { rejectClipboard = () => reject(new Error('late rejection')); });
  await withClipboardTimers(() => clipboard, async () => {
    const focus = vi.spyOn(output, 'focus');
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const cancel = vi.spyOn(globalThis, 'clearTimeout');
    try {
      copy.focus();
      fireEvent.click(copy);
      const timerIndex = schedule.mock.calls.findIndex(([, delay]) => delay === 5000);
      expect(timerIndex).toBeGreaterThanOrEqual(0);
      const timer = schedule.mock.results[timerIndex]?.value;
      unmount();
      expect(cancel).toHaveBeenCalledWith(timer);
      act(() => vi.advanceTimersByTime(5000));
      await act(async () => rejectClipboard());
      expect(document.activeElement).toBe(document.body);
      expect(focus).not.toHaveBeenCalled();
    } finally {
      focus.mockRestore();
      schedule.mockRestore();
      cancel.mockRestore();
    }
  });
});
