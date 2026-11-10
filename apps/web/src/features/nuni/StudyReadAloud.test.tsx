import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudyReadAloud } from './StudyReadAloud';

class Utterance {
  voice: unknown;
  lang = '';
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
const local = { lang: 'zh-TW', localService: true };
const remote = { lang: 'zh-TW', localService: false };
let voices: Array<{ lang: string; localService: boolean }>;
const speak = vi.fn();
const cancel = vi.fn();
const addEventListener = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  voices = [remote, local];
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', { getVoices: () => voices, speak, cancel, addEventListener, removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it('uses an installed Chinese voice and clears playback state on completion', () => {
  const changed = vi.fn();
  render(<StudyReadAloud text="課程原文" onSpeakingChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const utterance = speak.mock.calls[0][0] as Utterance;
  expect(utterance.voice).toBe(local);
  expect(changed).toHaveBeenLastCalledWith(true);
  act(() => utterance.onend?.());
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('button', { name: '朗讀這一段' })).toBeTruthy();
});

it('does not fall back to a remote voice when an installed Chinese voice is absent', () => {
  voices = [remote, { lang: 'en-US', localService: true }];
  render(<StudyReadAloud text="課程原文" />);
  expect(screen.getByRole('button', { name: '朗讀這一段' }).hasAttribute('disabled')).toBe(true);
  expect(speak).not.toHaveBeenCalled();
});

it('stops and detaches the old utterance when its content changes or the board closes', () => {
  const changed = vi.fn();
  const view = render(<StudyReadAloud text="舊課程原文" onSpeakingChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const old = speak.mock.calls[0][0] as Utterance;
  view.rerender(<StudyReadAloud text="新的講解" onSpeakingChange={changed} />);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(old.onend).toBeNull();
  expect(old.onerror).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const current = speak.mock.calls[1][0] as Utterance;
  view.unmount();
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(current.onend).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(false);
});

it('keeps Stop available when a mobile browser refreshes its voice list mid-reading', () => {
  const changed = vi.fn();
  render(<StudyReadAloud text="講義內容仍在本機" onSpeakingChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect(speak).toHaveBeenCalledTimes(1);
  const voiceUpdate = addEventListener.mock.calls.find(([event]) => event === 'voiceschanged')?.[1] as (() => void) | undefined;
  expect(voiceUpdate).toBeTypeOf('function');

  // iOS/Android can refresh installed voice lists while the active speech
  // utterance is still playing. Never trap students behind a disabled Stop.
  voices = [remote];
  act(() => voiceUpdate?.());
  const stopButton = screen.getByRole('button', { name: '停止朗讀' }) as HTMLButtonElement;
  expect(stopButton.disabled).toBe(false);
  fireEvent.click(stopButton);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenLastCalledWith(false);
  const unavailableButton = screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement;
  expect(unavailableButton.disabled).toBe(true);
  expect(speak).toHaveBeenCalledTimes(1); // No fallback to remote speech.

  voices = [local];
  act(() => voiceUpdate?.());
  const restoredButton = screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement;
  expect(restoredButton.disabled).toBe(false);
  fireEvent.click(restoredButton);
  expect(speak).toHaveBeenCalledTimes(2);
  expect((speak.mock.calls[1][0] as Utterance).voice).toBe(local);
});


it('finds a newly installed local Chinese voice even when voiceschanged never fires', () => {
  voices = [remote];
  render(<StudyReadAloud text="這段講義仍只在裝置上朗讀" />);
  expect((screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement).disabled).toBe(true);
  expect(speak).not.toHaveBeenCalled();

  // Safari may keep the initial voice list until a user gesture and omit the event.
  voices = [remote, local];
  fireEvent.click(screen.getByRole('button', { name: '重新檢查中文語音' }));
  const playButton = screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement;
  expect(playButton.disabled).toBe(false);
  fireEvent.click(playButton);
  expect(speak).toHaveBeenCalledTimes(1);
  const spoken = speak.mock.calls[0][0] as Utterance;
  expect(spoken.voice).toBe(local);
  expect(spoken.text).toBe('這段講義仍只在裝置上朗讀');
});

it('retains the local-only boundary when the voice lookup temporarily throws', () => {
  voices = [remote];
  render(<StudyReadAloud text="原文" />);
  const synth = window.speechSynthesis;
  const initial = synth.getVoices;
  synth.getVoices = () => { throw new Error('voice list not ready'); };
  expect(() => fireEvent.click(screen.getByRole('button', { name: '重新檢查中文語音' }))).not.toThrow();
  expect((screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement).disabled).toBe(true);
  expect(speak).not.toHaveBeenCalled();
  synth.getVoices = initial;
  voices = [local];
  fireEvent.click(screen.getByRole('button', { name: '重新檢查中文語音' }));
  expect((screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement).disabled).toBe(false);
});

it('keeps reading available and allows retry when a mobile browser rejects utterance creation', () => {
  const changed = vi.fn();
  render(<StudyReadAloud text="私人教材只供裝置端朗讀" onSpeakingChange={changed} />);

  // A voice can be listed as installed even when constructing an utterance
  // throws due to browser permissions or a temporarily unavailable engine.
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    constructor() { throw new Error('blocked speech engine details'); }
  });
  expect(() => fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }))).not.toThrow();
  expect(screen.getByRole('status').textContent).toContain('目前無法朗讀');
  expect(screen.getByRole('status').textContent).not.toContain('blocked speech engine details');
  expect((screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement).disabled).toBe(false);
  expect(speak).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(changed).toHaveBeenLastCalledWith(false);

  // A subsequent user gesture must work after the browser engine recovers.
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect(speak).toHaveBeenCalledTimes(1);
  expect((speak.mock.calls[0][0] as Utterance).text).toBe('私人教材只供裝置端朗讀');
  expect(changed).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole('status')).toBeNull();
});

it('does not falsely report that mobile playback stopped when cancel throws, and allows a retry', () => {
  const changed = vi.fn();
  render(<StudyReadAloud text="需保持可停止的講義朗讀" onSpeakingChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const utterance = speak.mock.calls[0][0] as Utterance;
  cancel.mockImplementationOnce(() => { throw new Error('speech engine busy'); });
  fireEvent.click(screen.getByRole('button', { name: '停止朗讀' }));

  expect(screen.getByRole('status').textContent).toContain('尚未確認停止朗讀');
  expect(screen.getByRole('status').textContent).not.toContain('speech engine busy');
  expect((screen.getByRole('button', { name: '停止朗讀' }) as HTMLButtonElement).disabled).toBe(false);
  expect(changed).toHaveBeenLastCalledWith(true);
  expect(utterance.onend).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '停止朗讀' }));
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(utterance.onend).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect(speak).toHaveBeenCalledTimes(2);
});

it('does not crash source cleanup if a mobile speech engine throws on cancel', () => {
  const changed = vi.fn();
  const view = render(<StudyReadAloud text="舊講義" onSpeakingChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const utterance = speak.mock.calls[0][0] as Utterance;
  cancel.mockImplementationOnce(() => { throw new Error('engine already gone'); });
  expect(() => view.unmount()).not.toThrow();
  expect(utterance.onend).toBeNull();
  expect(utterance.onerror).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(false);
});

it('retries local Chinese speech when the browser refuses a voiceschanged listener', () => {
  addEventListener.mockImplementationOnce(() => { throw new Error('event listener unavailable'); });
  voices = [remote];
  render(<StudyReadAloud text="學生的原文保留在裝置上" />);

  expect((screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement).disabled).toBe(true);
  voices = [remote, local];
  fireEvent.click(screen.getByRole('button', { name: '重新檢查中文語音' }));
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect(speak).toHaveBeenCalledTimes(1);
  expect((speak.mock.calls[0][0] as Utterance).voice).toBe(local);
});

it('still cancels reading on close if removing the voice listener throws', () => {
  const changed = vi.fn();
  const view = render(<StudyReadAloud text="離開頁面要清理的私人教材" onSpeakingChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const utterance = speak.mock.calls[0][0] as Utterance;
  window.speechSynthesis.removeEventListener = () => { throw new Error('event teardown failed'); };

  expect(() => view.unmount()).not.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(utterance.onend).toBeNull();
  expect(utterance.onerror).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(false);
});
