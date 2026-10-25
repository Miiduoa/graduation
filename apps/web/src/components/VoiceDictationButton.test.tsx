import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VoiceDictationButton } from './VoiceDictationButton';

class FakeSpeechRecognition {
  static last: FakeSpeechRecognition;
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() { FakeSpeechRecognition.last = this; }
}

beforeEach(() => {
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
  act(() => FakeSpeechRecognition.last.onresult?.({
    results: [{ isFinal: true, 0: { transcript: '請幫我查公車' } }],
  }));
  expect(onTranscript).toHaveBeenCalledWith('請幫我查公車');
  expect(FakeSpeechRecognition.last.stop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '停止語音輸入' }));
  expect(FakeSpeechRecognition.last.stop).toHaveBeenCalledOnce();
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
  expect((screen.getByRole('button', { name: '此瀏覽器不支援語音辨識' }) as HTMLButtonElement).disabled).toBe(true);
});
