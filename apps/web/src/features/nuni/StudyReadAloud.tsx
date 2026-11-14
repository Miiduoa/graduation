'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './CourseStudyPanel.module.css';

// Mobile speech engines can stop unexpectedly on a long single utterance.
// Split on natural punctuation where possible, preserving every source character.
const STUDY_SPEECH_CHUNK_LENGTH = 160;
// Some older WebViews lack a functioning grapheme segmenter. Preserve common
// multi-code-point characters in the local fallback, within the speech cap.
// This is intentionally bounded and not a replacement for Unicode UAX #29.
function isRegionalIndicator(character: string): boolean {
  const point = character.codePointAt(0) ?? 0;
  return point >= 0x1f1e6 && point <= 0x1f1ff;
}

function isStudySpeechContinuation(current: string, previous: string, regionalRun: number): boolean {
  if (current === '\n' && previous === '\r') return true;
  if (!previous || previous === '\r' || previous === '\n') return false;
  const point = current.codePointAt(0) ?? 0;
  const prior = previous.codePointAt(0) ?? 0;
  // Combining accents, variation selectors, emoji modifiers/tags and ZWJ
  // sequences should not begin a new mobile utterance.
  if (/^\p{Mark}$/u.test(current) || current === '\u200d' || previous === '\u200d' ||
      (point >= 0x1f3fb && point <= 0x1f3ff) ||
      (point >= 0xe0020 && point <= 0xe007f)) return true;
  // Pairs of regional indicators form one flag; the next pair is independent.
  if (isRegionalIndicator(current) && regionalRun % 2 === 1) return true;
  // Common decomposed Hangul L+V+T syllables.
  const isL = (value: number) =>
    (value >= 0x1100 && value <= 0x115f) || (value >= 0xa960 && value <= 0xa97f);
  const isV = (value: number) =>
    (value >= 0x1160 && value <= 0x11a7) || (value >= 0xd7b0 && value <= 0xd7c6);
  const isT = (value: number) =>
    (value >= 0x11a8 && value <= 0x11ff) || (value >= 0xd7cb && value <= 0xd7fb);
  return (isV(point) && (isL(prior) || isV(prior))) ||
    (isT(point) && (isV(prior) || isT(prior)));
}

function fallbackStudySpeechUnits(text: string): string[] {
  const result: string[] = [];
  let previous = '';
  let regionalRun = 0;
  for (const character of text) {
    const last = result.length - 1;
    if (last >= 0 && result[last].length + character.length <= STUDY_SPEECH_CHUNK_LENGTH &&
        isStudySpeechContinuation(character, previous, regionalRun)) {
      result[last] += character;
    } else {
      result.push(character);
    }
    regionalRun = isRegionalIndicator(character) ? regionalRun + 1 : 0;
    previous = character;
  }
  return result;
}

function splitStudySpeech(text: string): string[] {
  // Code-point slicing keeps surrogate pairs but can split a Chinese combining
  // character, Korean Jamo syllable or emoji ZWJ/flag in mid-utterance.
  // Intl.Segmenter is built into current browsers and runs on the device.
  const units: string[] = [];
  // A WebView can expose Intl.Segmenter but throw during construction or
  // iteration (for example while its locale data is unavailable). Never lose
  // a student's original text or crash the reading button in that case.
  // Discard partial segments before falling back so speech cannot repeat text.
  let segmented = false;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'grapheme' });
      let verifiedOffset = 0;
      let previousCharacter = '';
      let regionalRun = 0;
      for (const { segment } of segmenter.segment(text)) {
        // Some WebViews return a partial, duplicated or corrupted iterator
        // without throwing. Verify every unit against the original text so
        // fallback never silently skips or repeats private lesson content.
        if (typeof segment !== 'string' || !segment || !text.startsWith(segment, verifiedOffset)) {
          throw new Error('invalid on-device grapheme segmentation');
        }
        // A faulty iterator can reproduce the original text yet claim that
        // an accent, ZWJ emoji, flag pair or Hangul syllable ends mid-grapheme.
        // Such boundaries are unsafe even when the UTF-16 content matches.
        const firstCharacter = Array.from(segment)[0] ?? '';
        if (verifiedOffset > 0 &&
            isStudySpeechContinuation(firstCharacter, previousCharacter, regionalRun)) {
          throw new Error('broken on-device grapheme boundary');
        }
        // A damaged WebView can yield individual UTF-16 code units while
        // still concatenating back to the full source. Never trust a segment
        // that starts with a low surrogate or ends with a high surrogate:
        // it would split an emoji in half at a mobile speech chunk boundary.
        const firstUnit = segment.charCodeAt(0);
        const lastUnit = segment.charCodeAt(segment.length - 1);
        if ((firstUnit >= 0xdc00 && firstUnit <= 0xdfff) ||
            (lastUnit >= 0xd800 && lastUnit <= 0xdbff)) {
          throw new Error('broken surrogate pair in on-device grapheme segmentation');
        }
        verifiedOffset += segment.length;
        for (const character of segment) {
          regionalRun = isRegionalIndicator(character) ? regionalRun + 1 : 0;
          previousCharacter = character;
        }
        if (segment.length <= STUDY_SPEECH_CHUNK_LENGTH) {
          units.push(segment);
          continue;
        }
        // A pathological grapheme must still fit the mobile utterance cap.
        // Never split a UTF-16 surrogate pair in this bounded fallback.
        let part = '';
        for (const character of segment) {
          if (part && part.length + character.length > STUDY_SPEECH_CHUNK_LENGTH) {
            units.push(part);
            part = '';
          }
          part += character;
        }
        if (part) units.push(part);
      }
      if (verifiedOffset !== text.length) {
        throw new Error('incomplete on-device grapheme segmentation');
      }
      segmented = true;
    } catch {
      units.length = 0;
    }
  }
  if (!segmented) {
    // Older or partially broken engines use the previous code-point-safe path.
    // Do not spread long lesson arrays into push(): older WebViews can reject
    // hundreds of thousands of function arguments with RangeError.
    for (const unit of fallbackStudySpeechUnits(text)) units.push(unit);
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < units.length;) {
    let end = offset;
    let length = 0;
    while (end < units.length && length + units[end].length <= STUDY_SPEECH_CHUNK_LENGTH) {
      length += units[end].length;
      end += 1;
    }
    if (end === offset) end = offset + 1;
    if (end < units.length) {
      for (let index = end - 1; index >= offset + 80; index -= 1) {
        if (/[。！？；，、\n.!?;:：]/u.test(units[index])) {
          end = index + 1;
          break;
        }
      }
    }
    chunks.push(units.slice(offset, end).join(''));
    offset = end;
  }
  return chunks;
}

/** Use an installed voice so reading a private course does not require a speech service. */
export function StudyReadAloud({ text, label = '朗讀這一段', onSpeakingChange, rate: selectedRate, onRateChange }: {
  text: string;
  label?: string;
  onSpeakingChange?: (speaking: boolean) => void;
  /** Pass a controlled rate to preserve the choice when a teaching step remounts. */
  rate?: number;
  onRateChange?: (rate: number) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [supported, setSupported] = useState(false);
  const refreshVoices = useRef<(() => void) | null>(null);
  const [speaking, setSpeaking] = useState(false);
  // Apply the student's locally chosen pace only to the next utterance.
  const [localRate, setLocalRate] = useState(0.95);
  const rate = selectedRate ?? localRate;
  const [error, setError] = useState('');
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  // A parent may recreate this callback while narrating (for example on a UI state change).
  // Keep the latest listener without tearing down a playing utterance.
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  useEffect(() => {
    onSpeakingChangeRef.current = onSpeakingChange;
  }, [onSpeakingChange]);
  const active = useRef<SpeechSynthesisUtterance | null>(null);
  const remainingChunks = useRef<string[]>([]);

  useEffect(() => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    const synthesis = window.speechSynthesis;
    setSupported(true);
    setSpeaking(false);
    const update = () => {
      // Some mobile browsers return an empty list at first without firing
      // voiceschanged later. An explicit retry must share this same local-only filter.
      let voices: SpeechSynthesisVoice[];
      try { voices = synthesis.getVoices().filter((item) => item.localService); }
      catch { voices = []; }
      voice.current = voices.find((item) => /^zh[-_]TW$/i.test(item.lang))
        ?? voices.find((item) => /^zh\b/i.test(item.lang)) ?? null;
      setAvailable(!!voice.current);
    };
    refreshVoices.current = update;
    update();
    // Some mobile speech engines throw when adding a voiceschanged listener.
    // Keep manual installed-voice detection available rather than crashing the panel.
    try { synthesis.addEventListener('voiceschanged', update); }
    catch { /* Students can retry through the manual voice refresh button. */ }
    return () => {
      refreshVoices.current = null;
      remainingChunks.current = [];
      // A failed listener teardown must never prevent cancelling private speech.
      try { synthesis.removeEventListener('voiceschanged', update); }
      catch { /* Continue cleaning up the current utterance. */ }
      if (active.current) {
        active.current.onend = null;
        active.current.onerror = null;
        active.current = null;
        // Some mobile speech engines throw while the view is closing.
        // Focus changes and source replacement must still complete safely.
        try { synthesis.cancel(); } catch { /* The browser owns this speech engine. */ }
        onSpeakingChangeRef.current?.(false);
      }
    };
  }, [text]);

  function stop(): boolean {
    if (active.current) {
      const utterance = active.current;
      // cancel() may fire onend synchronously. Detach first so a cancelled
      // chunk cannot start the next piece behind the student's back.
      const oldEnd = utterance.onend;
      const oldError = utterance.onerror;
      utterance.onend = null;
      utterance.onerror = null;
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Keep Stop and the active playback state for a genuine retry.
        utterance.onend = oldEnd;
        utterance.onerror = oldError;
        // A rejected stop still means the student asked to end this sequence.
        // Never auto-start the next chunk when the current one later ends.
        remainingChunks.current = [];
        setError('瀏覽器尚未確認停止朗讀，請再按一次「停止朗讀」；若仍播放，請使用裝置的語音控制。');
        return false;
      }
      remainingChunks.current = [];
      active.current = null;
    }
    setSpeaking(false);
    setError('');
    onSpeakingChangeRef.current?.(false);
    return true;
  }

  function toggle() {
    if (active.current) { stop(); return; }
    if (!voice.current || !available) return;
    // Snapshot the approved on-device voice. voiceschanged can briefly report
    // no voices between chunks; never silently fall back to a remote/default one.
    const selectedVoice = voice.current;
    remainingChunks.current = splitStudySpeech(text);
    let announced = false;

    const finishPlayback = (message = '') => {
      remainingChunks.current = [];
      setSpeaking(false);
      onSpeakingChangeRef.current?.(false);
      // A failed cancel can still be followed by a natural onend. Once the
      // browser reports completion, remove the now-inaccurate Stop warning.
      setError(message);
    };
    // A browser may dispatch onend inside speak(). Drain that completion
    // without recursively nesting one speakNext call per lesson chunk.
    let launchingChunk = false;
    let nextChunkQueued = false;
    const speakNext = () => {
      if (launchingChunk) {
        nextChunkQueued = true;
        return;
      }
      do {
        nextChunkQueued = false;
        launchingChunk = true;
        try { launchChunk(); }
        finally { launchingChunk = false; }
      } while (nextChunkQueued);
    };
    const launchChunk = () => {
      const part = remainingChunks.current.shift();
      if (part === undefined) { finishPlayback(); return; }

      let utterance: SpeechSynthesisUtterance;
      try {
        utterance = new SpeechSynthesisUtterance(part);
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
        utterance.rate = rate;
      } catch {
        finishPlayback('目前無法朗讀，可繼續閱讀文字。');
        return;
      }
      active.current = utterance;
      const finishPart = (failed: boolean) => {
        if (active.current !== utterance) return;
        active.current = null;
        utterance.onend = null;
        utterance.onerror = null;
        if (failed) {
          finishPlayback('朗讀未能完成，可重新朗讀或繼續閱讀文字。');
        } else if (remainingChunks.current.length) {
          speakNext();
        } else {
          finishPlayback();
        }
      };
      utterance.onend = () => finishPart(false);
      utterance.onerror = () => finishPart(true);
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        if (active.current === utterance) active.current = null;
        utterance.onend = null;
        utterance.onerror = null;
        finishPlayback(announced
          ? '朗讀未能完成，可重新朗讀或繼續閱讀文字。'
          : '目前無法朗讀，可繼續閱讀文字。');
        return;
      }
      // An engine may finish a very short chunk inside speak(). Do not
      // resurrect a completed queue or announce speech more than once.
      if (active.current === utterance && !announced) {
        announced = true;
        setSpeaking(true);
        onSpeakingChangeRef.current?.(true);
      }
    };

    setError('');
    speakNext();
  }

  return (
    <div className={styles.readAloud}>
      <button type="button" className={styles.button} disabled={!available && !speaking}
        aria-pressed={speaking} onClick={toggle}>
        {speaking ? '停止朗讀' : label}
      </button>
      <label className={styles.note}>朗讀速度
        <select aria-label="朗讀速度" value={rate} disabled={!available || speaking}
          onChange={(event) => {
            const nextRate = Number(event.target.value);
            if (![0.8, 0.95, 1.1].includes(nextRate)) return;
            if (onRateChange) onRateChange(nextRate);
            else setLocalRate(nextRate);
          }}>
          <option value={0.8}>慢速（0.8 倍）</option>
          <option value={0.95}>一般（0.95 倍）</option>
          <option value={1.1}>稍快（1.1 倍）</option>
        </select>
      </label>
      {!available && !speaking && <>
        <small>{supported
          ? '目前找不到裝置上的中文離線語音；開啟或安裝語音後可重新檢查，仍可閱讀文字。'
          : '此瀏覽器未提供語音朗讀功能，仍可閱讀文字。'}</small>
        {supported && <button type="button" className={styles.button}
          onClick={() => refreshVoices.current?.()}>重新檢查中文語音</button>}
      </>}
      {error && <small role="status">{error}</small>}
    </div>
  );
}
