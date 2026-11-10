'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './CourseStudyPanel.module.css';

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
  const active = useRef<SpeechSynthesisUtterance | null>(null);

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
        onSpeakingChange?.(false);
      }
    };
  }, [text, onSpeakingChange]);

  function stop(): boolean {
    if (active.current) {
      // Do not claim that playback has stopped if a mobile browser rejects
      // cancel(). Keep Stop enabled and voice dictation blocked for a retry.
      const utterance = active.current;
      try {
        window.speechSynthesis.cancel();
      } catch {
        setError('瀏覽器尚未確認停止朗讀，請再按一次「停止朗讀」；若仍播放，請使用裝置的語音控制。');
        return false;
      }
      utterance.onend = null;
      utterance.onerror = null;
      active.current = null;
    }
    setSpeaking(false);
    setError('');
    onSpeakingChange?.(false);
    return true;
  }

  function toggle() {
    if (active.current) { stop(); return; }
    if (!voice.current || !available) return;
    // Mobile browsers can advertise a local voice but reject utterance
    // construction (for example when speech access is restricted). Do not
    // leave the reader stuck or leak the browser error into the lesson.
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice.current;
      utterance.lang = voice.current.lang;
      utterance.rate = rate;
    } catch {
      setSpeaking(false);
      onSpeakingChange?.(false);
      setError('目前無法朗讀，可繼續閱讀文字。');
      return;
    }
    active.current = utterance;
    const finish = () => {
      if (active.current !== utterance) return false;
      active.current = null;
      utterance.onend = null;
      utterance.onerror = null;
      setSpeaking(false);
      onSpeakingChange?.(false);
      return true;
    };
    utterance.onend = finish;
    utterance.onerror = () => {
      if (finish()) setError('朗讀未能完成，可繼續閱讀文字。');
    };
    setError('');
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      // A synchronous start failure must not depend on cancel(): browsers can
      // reject both calls, leaving a false "停止朗讀" state that blocks retry.
      if (active.current === utterance) active.current = null;
      utterance.onend = null;
      utterance.onerror = null;
      setSpeaking(false);
      onSpeakingChange?.(false);
      setError('目前無法朗讀，可繼續閱讀文字。');
      return;
    }
    // Some engines can call onend synchronously; do not resurrect ended speech.
    if (active.current === utterance) {
      setSpeaking(true);
      onSpeakingChange?.(true);
    }
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
