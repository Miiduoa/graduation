import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VoiceDictationButton } from './VoiceDictationButton';

class FakeSpeechRecognition {
  static last: FakeSpeechRecognition;
  static failStart = false;
  lang = '';
  interimResults = false;
  continuous = false;
  onresult:
    | ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
    | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => {
    if (FakeSpeechRecognition.failStart) throw new Error('mock recognition unavailable');
  });
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeSpeechRecognition.last = this;
  }
}

beforeEach(() => {
  FakeSpeechRecognition.failStart = false;
  Object.defineProperty(window, 'webkitSpeechRecognition', {
    configurable: true,
    value: FakeSpeechRecognition,
  });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'webkitSpeechRecognition');
});

it('fills a draft after a final Taiwanese Mandarin transcript without submitting it', () => {
  const onTranscript = vi.fn();
  render(<VoiceDictationButton onTranscript={onTranscript} />);
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  expect(FakeSpeechRecognition.last.lang).toBe('zh-TW');
  expect(screen.getByRole('status').textContent).toContain('正在聆聽');
  act(() =>
    FakeSpeechRecognition.last.onresult?.({
      results: [{ isFinal: true, 0: { transcript: '請幫我查公車' } }],
    }),
  );
  expect(onTranscript).toHaveBeenCalledWith('請幫我查公車');
  expect(FakeSpeechRecognition.last.stop).not.toHaveBeenCalled();
  expect(FakeSpeechRecognition.last.abort).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '使用語音輸入' }).getAttribute('aria-pressed')).toBe(
    'false',
  );
});

it('explains microphone denial without changing the draft', () => {
  const onTranscript = vi.fn();
  render(<VoiceDictationButton onTranscript={onTranscript} />);
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  act(() => FakeSpeechRecognition.last.onerror?.({ error: 'not-allowed' }));
  expect(screen.getByRole('alert').textContent).toContain('允許權限');
  expect(onTranscript).not.toHaveBeenCalled();
});

it('disables speech if the browser does not support recognition', () => {
  Reflect.deleteProperty(window, 'webkitSpeechRecognition');
  render(<VoiceDictationButton onTranscript={vi.fn()} />);
  expect(
    (screen.getByRole('button', { name: '此瀏覽器不支援語音辨識' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

function finalResult(text: string) {
  return { results: [{ isFinal: true, 0: { transcript: text } }] };
}

function startCapture(onTranscript = vi.fn()) {
  const view = render(<VoiceDictationButton onTranscript={onTranscript} />);
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  const recognition = FakeSpeechRecognition.last;
  return { view, recognition, onTranscript, lateResult: recognition.onresult! };
}

it('stops without accepting a delayed final transcript or waiting for onend', () => {
  const { recognition, lateResult, onTranscript } = startCapture();
  fireEvent.click(screen.getByRole('button', { name: '停止語音輸入' }));
  act(() => lateResult(finalResult('停止後的舊文字')));
  expect(onTranscript).not.toHaveBeenCalled();
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(recognition.stop).not.toHaveBeenCalled();
  expect(recognition.onresult).toBeNull();
  expect(recognition.onerror).toBeNull();
  expect(recognition.onend).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: '使用語音輸入' })).toBeTruthy();
});

it('invalidates the capture immediately when disabled and allows a fresh capture later', () => {
  const { view, recognition, lateResult, onTranscript } = startCapture();
  view.rerender(<VoiceDictationButton onTranscript={onTranscript} disabled />);
  act(() => lateResult(finalResult('停用後的舊文字')));
  expect(onTranscript).not.toHaveBeenCalled();
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(recognition.onresult).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(<VoiceDictationButton onTranscript={onTranscript} />);
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  const next = FakeSpeechRecognition.last;
  expect(next).not.toBe(recognition);
  act(() => lateResult(finalResult('不能污染新的語音輸入')));
  act(() => next.onresult?.(finalResult('新的草稿')));
  expect(onTranscript).toHaveBeenCalledExactlyOnceWith('新的草稿');
});

it('does not call a new callback with an old capture after unmount', () => {
  const { view, recognition, lateResult, onTranscript } = startCapture();
  view.unmount();
  act(() => lateResult(finalResult('已離開的輸入')));
  expect(onTranscript).not.toHaveBeenCalled();
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(recognition.onresult).toBeNull();
  expect(recognition.onerror).toBeNull();
  expect(recognition.onend).toBeNull();
});

it('delivers only the first nonempty final event and never overwrites an edited draft', () => {
  const { view, recognition, lateResult, onTranscript } = startCapture();
  act(() => lateResult(finalResult('  ')));
  expect(onTranscript).not.toHaveBeenCalled();
  expect(recognition.abort).not.toHaveBeenCalled();
  act(() => lateResult(finalResult('第一份草稿')));
  const newCallback = vi.fn();
  view.rerender(<VoiceDictationButton onTranscript={newCallback} />);
  act(() => lateResult(finalResult('第一份草稿')));
  act(() => lateResult(finalResult('後來的不同文字')));
  expect(onTranscript).toHaveBeenCalledExactlyOnceWith('第一份草稿');
  expect(newCallback).not.toHaveBeenCalled();
  expect(recognition.abort).toHaveBeenCalledOnce();
});

it('keeps interim speech local and joins the final segments in the first final event', () => {
  const { recognition, onTranscript } = startCapture();
  expect(recognition.interimResults).toBe(true);
  expect(recognition.continuous).toBe(false);
  act(() =>
    recognition.onresult?.({ results: [{ isFinal: false, 0: { transcript: '還沒說完' } }] }),
  );
  expect(screen.getByRole('status').textContent).toBe('還沒說完');
  expect(onTranscript).not.toHaveBeenCalled();
  act(() =>
    recognition.onresult?.({
      results: [
        { isFinal: true, 0: { transcript: ' 找圖書館 ' } },
        { isFinal: true, 0: { transcript: '再去吃飯' } },
        { isFinal: false, 0: { transcript: '未確認片段' } },
      ],
    }),
  );
  expect(onTranscript).toHaveBeenCalledExactlyOnceWith('找圖書館 再去吃飯');
  expect(screen.queryByRole('status')).toBeNull();
});

it('does not let a previous session result or end event interrupt a new capture', () => {
  const { recognition, lateResult, onTranscript } = startCapture();
  const oldEnd = recognition.onend!;
  fireEvent.click(screen.getByRole('button', { name: '停止語音輸入' }));
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  const next = FakeSpeechRecognition.last;
  act(() => {
    lateResult(finalResult('舊轉寫'));
    oldEnd();
  });
  expect(screen.getByRole('button', { name: '停止語音輸入' })).toBeTruthy();
  expect(next.abort).not.toHaveBeenCalled();
  act(() => next.onresult?.(finalResult('新轉寫')));
  expect(onTranscript).toHaveBeenCalledExactlyOnceWith('新轉寫');
});

it.each(['not-allowed', 'service-not-allowed', 'no-speech', 'audio-capture', 'network'])(
  'ends a failed capture and allows retry after %s',
  (error) => {
    const { recognition, lateResult, onTranscript } = startCapture();
    act(() => recognition.onerror?.({ error }));
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    act(() => lateResult(finalResult('錯誤後的舊文字')));
    expect(onTranscript).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
    expect(FakeSpeechRecognition.last).not.toBe(recognition);
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('cleans up a start exception so retry works and stale events do nothing', () => {
  FakeSpeechRecognition.failStart = true;
  const { recognition, onTranscript } = startCapture();
  expect(screen.getByRole('alert').textContent).toContain('無法啟動');
  expect(recognition.onresult).toBeNull();
  expect(recognition.onerror).toBeNull();
  expect(recognition.onend).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  FakeSpeechRecognition.failStart = false;
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  act(() => FakeSpeechRecognition.last.onresult?.(finalResult('重新輸入')));
  expect(onTranscript).toHaveBeenCalledExactlyOnceWith('重新輸入');
});

it('handles an abort implementation that throws without leaving stale listeners', () => {
  const { recognition, lateResult, onTranscript } = startCapture();
  recognition.abort.mockImplementation(() => {
    throw new Error('already stopped');
  });
  fireEvent.click(screen.getByRole('button', { name: '停止語音輸入' }));
  act(() => lateResult(finalResult('不應出現')));
  expect(onTranscript).not.toHaveBeenCalled();
  expect(recognition.onresult).toBeNull();
  expect(screen.getByRole('button', { name: '使用語音輸入' })).toBeTruthy();
});
