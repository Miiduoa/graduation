'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './CourseStudyPanel.module.css';

/** Use an installed voice so reading a private course does not require a speech service. */
export function StudyReadAloud({ text, label = '朗讀這一段', onSpeakingChange }: {
  text: string;
  label?: string;
  onSpeakingChange?: (speaking: boolean) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [supported, setSupported] = useState(false);
  const refreshVoices = useRef<(() => void) | null>(null);
  const [speaking, setSpeaking] = useState(false);
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
    synthesis.addEventListener('voiceschanged', update);
    return () => {
      refreshVoices.current = null;
      synthesis.removeEventListener('voiceschanged', update);
      if (active.current) {
        active.current.onend = null;
        active.current.onerror = null;
        active.current = null;
        synthesis.cancel();
        onSpeakingChange?.(false);
      }
    };
  }, [text, onSpeakingChange]);

  function stop() {
    if (active.current) {
      active.current.onend = null;
      active.current.onerror = null;
      active.current = null;
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    onSpeakingChange?.(false);
  }

  function toggle() {
    if (active.current) { stop(); return; }
    if (!voice.current || !available) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice.current;
    utterance.lang = voice.current.lang;
    utterance.rate = 0.95;
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
    setSpeaking(true);
    onSpeakingChange?.(true);
    try { window.speechSynthesis.speak(utterance); }
    catch { stop(); setError('目前無法朗讀，可繼續閱讀文字。'); }
  }

  return (
    <div className={styles.readAloud}>
      <button type="button" className={styles.button} disabled={!available && !speaking}
        aria-pressed={speaking} onClick={toggle}>
        {speaking ? '停止朗讀' : label}
      </button>
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
