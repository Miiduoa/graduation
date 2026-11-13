import { useState } from 'react';
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
  // clearAllMocks preserves previous mock implementations. A synchronous
  // speech-engine fake must not leak into the following student's test.
  speak.mockReset();
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

it('clears a failed-stop warning when the remaining speech ends naturally', () => {
  const changed = vi.fn();
  render(<StudyReadAloud text={'長篇講義原文'.repeat(90)} onSpeakingChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const first = speak.mock.calls[0][0] as Utterance;
  expect(changed).toHaveBeenLastCalledWith(true);
  cancel.mockImplementationOnce(() => { throw new Error('browser speech engine busy'); });
  fireEvent.click(screen.getByRole('button', { name: '停止朗讀' }));
  expect(screen.getByRole('status').textContent).toContain('尚未確認停止朗讀');

  // The engine can finish on its own despite rejecting cancel(). The
  // abandoned remaining chunks must stay stopped and the warning must clear.
  act(() => first.onend?.());
  expect(speak).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: '朗讀這一段' })).toBeTruthy();

  // A new user gesture can start a fresh reading without stale error UI.
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect(speak).toHaveBeenCalledTimes(2);
  expect((speak.mock.calls[1][0] as Utterance).voice).toBe(local);
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

it('lets students select the pace of local Chinese speech without changing a playing utterance', () => {
  const changed = vi.fn();
  render(<StudyReadAloud text="微積分課程筆記" onSpeakingChange={changed} />);
  const pace = screen.getByRole('combobox', { name: '朗讀速度' }) as HTMLSelectElement;
  expect(pace.value).toBe('0.95');
  fireEvent.change(pace, { target: { value: '0.8' } });
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const slow = speak.mock.calls[0][0] as Utterance;
  expect(slow.rate).toBe(0.8);
  expect(slow.voice).toBe(local);
  expect(pace.disabled).toBe(true);
  expect(screen.getByRole('button', { name: '停止朗讀' })).toBeTruthy();
  act(() => slow.onend?.());
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(pace.disabled).toBe(false);
  fireEvent.change(pace, { target: { value: '1.1' } });
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const fast = speak.mock.calls[1][0] as Utterance;
  expect(fast.rate).toBe(1.1);
  expect(fast.voice).toBe(local);
  expect(cancel).not.toHaveBeenCalled();
  expect(changed).toHaveBeenLastCalledWith(true);
});

it('keeps pace selection disabled when only remote Chinese voices are available', () => {
  voices = [remote];
  render(<StudyReadAloud text="來源不外傳" />);
  const pace = screen.getByRole('combobox', { name: '朗讀速度' }) as HTMLSelectElement;
  expect(pace.disabled).toBe(true);
  expect((screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement).disabled).toBe(true);
  expect(speak).not.toHaveBeenCalled();
});

it('preserves the selected Chinese narration pace when a new teaching step remounts the reader', () => {
  function StepReader({ step }: { step: string }) {
    const [savedRate, setSavedRate] = useState(0.95);
    return <StudyReadAloud key={step} text={step} rate={savedRate} onRateChange={setSavedRate} />;
  }

  const view = render(<StepReader step="第一步：先讀題目" />);
  const pace = screen.getByRole('combobox', { name: '朗讀速度' }) as HTMLSelectElement;
  fireEvent.change(pace, { target: { value: '0.8' } });
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const first = speak.mock.calls[0][0] as Utterance;
  expect(first.rate).toBe(0.8);
  expect(first.voice).toBe(local);
  act(() => first.onend?.());

  view.rerender(<StepReader step="第二步：計算答案" />);
  expect((screen.getByRole('combobox', { name: '朗讀速度' }) as HTMLSelectElement).value).toBe('0.8');
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const second = speak.mock.calls[1][0] as Utterance;
  expect(second.text).toBe('第二步：計算答案');
  expect(second.rate).toBe(0.8);
  expect(second.voice).toBe(local);

  act(() => second.onend?.());
  fireEvent.change(screen.getByRole('combobox', { name: '朗讀速度' }), { target: { value: '1.1' } });
  view.rerender(<StepReader step="第三步：檢查結果" />);
  expect((screen.getByRole('combobox', { name: '朗讀速度' }) as HTMLSelectElement).value).toBe('1.1');
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect((speak.mock.calls[2][0] as Utterance).rate).toBe(1.1);
  expect((speak.mock.calls[2][0] as Utterance).voice).toBe(local);
  expect(cancel).not.toHaveBeenCalled();
});

it('allows retry after speak rejects synchronously without calling cancel', () => {
  const changed = vi.fn();
  render(<StudyReadAloud text="學生本機講義" onSpeakingChange={changed} />);
  speak.mockImplementationOnce(() => { throw new Error('private speech engine diagnostic'); });

  expect(() => fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }))).not.toThrow();
  expect(screen.getByRole('status').textContent).toContain('目前無法朗讀');
  expect(screen.getByRole('status').textContent).not.toContain('private speech engine diagnostic');
  expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
  expect((screen.getByRole('button', { name: '朗讀這一段' }) as HTMLButtonElement).disabled).toBe(false);
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(changed).not.toHaveBeenCalledWith(true);
  expect(cancel).not.toHaveBeenCalled();
  const rejected = speak.mock.calls[0][0] as Utterance;
  expect(rejected.onend).toBeNull();
  expect(rejected.onerror).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect(speak).toHaveBeenCalledTimes(2);
  const restarted = speak.mock.calls[1][0] as Utterance;
  expect(restarted.voice).toBe(local);
  expect(restarted.text).toBe('學生本機講義');
  expect(changed).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole('status')).toBeNull();
});

it('does not re-enter speaking state when an engine ends immediately inside speak', () => {
  const changed = vi.fn();
  speak.mockImplementationOnce((utterance: Utterance) => utterance.onend?.());
  render(<StudyReadAloud text="很短的原文" onSpeakingChange={changed} />);

  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect(speak).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(changed).not.toHaveBeenCalledWith(true);
  expect(cancel).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect(speak).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenLastCalledWith(true);
});

it('reads long cited lessons in bounded local-only chunks without skipping original characters', () => {
  const changed = vi.fn();
  const text = '主鍵' + '甲'.repeat(180) + '。外鍵' + '乙'.repeat(220);
  render(<StudyReadAloud text={text} onSpeakingChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const voiceUpdate = addEventListener.mock.calls.find(([event]) => event === 'voiceschanged')?.[1] as (() => void) | undefined;
  voices = [remote];
  act(() => voiceUpdate?.());

  const chunks: string[] = [];
  for (let index = 0; index < speak.mock.calls.length && index < 10; index += 1) {
    const part = speak.mock.calls[index][0] as Utterance;
    chunks.push(part.text);
    expect(Array.from(part.text).length).toBeLessThanOrEqual(160);
    // A temporary voice-list refresh must not switch to a remote/default voice.
    expect(part.voice).toBe(local);
    act(() => part.onend?.());
  }
  expect(chunks.length).toBeGreaterThan(2);
  expect(chunks.join('')).toBe(text);
  expect(changed.mock.calls.filter(([value]) => value === true)).toHaveLength(1);
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
});

it('does not start a second speech chunk when cancel synchronously triggers onend', () => {
  render(<StudyReadAloud text={'這一段長教材'.repeat(80)} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const first = speak.mock.calls[0][0] as Utterance;
  cancel.mockImplementationOnce(() => first.onend?.());
  fireEvent.click(screen.getByRole('button', { name: '停止朗讀' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(speak).toHaveBeenCalledTimes(1);
  expect(first.onend).toBeNull();
  expect(first.onerror).toBeNull();
  expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
});

it('recovers from a speech-engine failure midway through a long lesson without leaking the error', () => {
  const changed = vi.fn();
  speak.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('private speech details'); });
  render(<StudyReadAloud text={'教材逐字引句。'.repeat(75)} onSpeakingChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const first = speak.mock.calls[0][0] as Utterance;
  act(() => first.onend?.());

  expect(speak).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status').textContent).toContain('朗讀未能完成');
  expect(screen.getByRole('status').textContent).not.toContain('private speech details');
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  expect(speak).toHaveBeenCalledTimes(3);
  expect((speak.mock.calls[2][0] as Utterance).text).toBe(first.text);
  expect(changed).toHaveBeenLastCalledWith(true);
});

it('abandons later chunks after Stop is rejected, even if the active chunk finishes naturally', () => {
  render(<StudyReadAloud text={'學生要求停止朗讀。'.repeat(80)} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const first = speak.mock.calls[0][0] as Utterance;
  cancel.mockImplementationOnce(() => { throw new Error('cannot stop yet'); });
  fireEvent.click(screen.getByRole('button', { name: '停止朗讀' }));
  expect(screen.getByRole('status').textContent).toContain('尚未確認停止朗讀');
  expect(screen.getByRole('button', { name: '停止朗讀' })).toBeTruthy();
  act(() => first.onend?.());
  expect(speak).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
});

it.each([
  { label: 'combining accent', prefixLength: 159, cluster: 'e\u0301' },
  { label: 'emoji ZWJ sequence', prefixLength: 159, cluster: '👩‍💻' },
  { label: 'emoji skin modifier', prefixLength: 158, cluster: '👍🏽' },
  { label: 'regional flag pair', prefixLength: 158, cluster: '🇹🇼' },
  { label: 'Hangul Jamo syllable', prefixLength: 159, cluster: '각' },
])('reads a $label intact at a mobile utterance boundary', ({ prefixLength, cluster }) => {
  const prefix = '甲'.repeat(prefixLength);
  const original = prefix + cluster + '乙'.repeat(180);
  render(<StudyReadAloud text={original} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const chunks: string[] = [];
  for (let index = 0; index < speak.mock.calls.length && index < 10; index += 1) {
    const utterance = speak.mock.calls[index][0] as Utterance;
    chunks.push(utterance.text);
    act(() => utterance.onend?.());
  }
  expect(chunks.join('')).toBe(original);
  expect(chunks[0]).toBe(prefix);
  expect(chunks[1].startsWith(cluster)).toBe(true);
  expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 160)).toBe(true);
  expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
});

it('bounds an exceptionally long combining sequence without truncating speech text', () => {
  const original = 'e' + '\u0301'.repeat(450) + '乙'.repeat(40);
  render(<StudyReadAloud text={original} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const chunks: string[] = [];
  for (let index = 0; index < speak.mock.calls.length && index < 10; index += 1) {
    const utterance = speak.mock.calls[index][0] as Utterance;
    chunks.push(utterance.text);
    act(() => utterance.onend?.());
  }
  expect(chunks.join('')).toBe(original);
  expect(chunks.length).toBeGreaterThan(2);
  expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 160)).toBe(true);
});

it('drains thousands of immediately finished speech chunks without recursion or missing source text', () => {
  // A few mobile engines can fire onend synchronously inside speak().
  // Previously each callback nested another speakNext and could overflow the stack.
  const changed = vi.fn();
  const text = '甲'.repeat(160 * 3500 + 7);
  speak.mockImplementation((utterance: Utterance) => utterance.onend?.());
  render(<StudyReadAloud text={text} onSpeakingChange={changed} />);

  expect(() => fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }))).not.toThrow();
  expect(speak).toHaveBeenCalledTimes(3501);
  const utterances = speak.mock.calls.map(([utterance]) => utterance as Utterance);
  expect(utterances.every((utterance) => utterance.voice === local && utterance.text.length <= 160)).toBe(true);
  expect(utterances.map((utterance) => utterance.text).join('')).toBe(text);
  expect(changed).not.toHaveBeenCalledWith(true);
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
});

it('keeps the same local narration when the parent replaces the status callback', () => {
  const firstListener = vi.fn();
  const latestListener = vi.fn();
  const source = '原文與逐字引句。';
  const view = render(<StudyReadAloud text={source} onSpeakingChange={firstListener} />);
  fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }));
  const utterance = speak.mock.calls[0][0] as Utterance;
  expect(firstListener).toHaveBeenLastCalledWith(true);

  // Parent state updates can create a new callback without changing the
  // chosen lesson. This must not cancel a student's ongoing reading.
  view.rerender(<StudyReadAloud text={source} onSpeakingChange={latestListener} />);
  expect(cancel).not.toHaveBeenCalled();
  expect(speak).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '停止朗讀' })).toBeTruthy();
  expect(utterance.onend).not.toBeNull();

  act(() => utterance.onend?.());
  expect(latestListener).toHaveBeenLastCalledWith(false);
  expect(firstListener).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
});

it.each(['construction', 'iteration'])(
  'still reads every original character if Intl.Segmenter fails during %s',
  (failure) => {
    const nativeIntl = Intl;
    vi.stubGlobal('Intl', Object.assign(Object.create(nativeIntl), {
      Segmenter: class {
        constructor() {
          if (failure === 'construction') throw new Error('locale data unavailable');
        }
        *segment(text: string) {
          // Simulate a browser yielding a valid first cluster and then failing.
          // The fallback must discard that partial buffer, not repeat it.
          yield { segment: text[0] };
          throw new Error('segmentation iterator failed');
        }
      },
    }));
    const sourceText = '甲'.repeat(159) + '👩‍💻' + '乙'.repeat(200);
    render(<StudyReadAloud text={sourceText} />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: '朗讀這一段' }))).not.toThrow();
    const chunks: string[] = [];
    for (let index = 0; index < speak.mock.calls.length && index < 12; index += 1) {
      const utterance = speak.mock.calls[index][0] as Utterance;
      chunks.push(utterance.text);
      expect(utterance.voice).toBe(local);
      act(() => utterance.onend?.());
    }
    expect(chunks.join('')).toBe(sourceText);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 160)).toBe(true);
    expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
    expect(speak).toHaveBeenCalledTimes(chunks.length);
  },
);
