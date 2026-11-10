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
