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

beforeEach(() => {
  vi.clearAllMocks();
  voices = [remote, local];
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', { getVoices: () => voices, speak, cancel, addEventListener: vi.fn(), removeEventListener: vi.fn() });
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
