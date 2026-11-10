'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styles from './SpokenReply.module.css';

// The browser has one speech queue. Only cancel a reply started by this control.
let stopActive: (() => void) | null = null;
export function stopSpokenReply() {
  stopActive?.();
}

export function SpokenReply({
  text,
  disabled = false,
  children,
}: {
  text: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const rendered = useRef<HTMLDivElement>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState('');

  const stop = useCallback(() => {
    if (!utterance.current) return;
    utterance.current.onend = null;
    utterance.current.onerror = null;
    utterance.current = null;
    stopActive = null;
    setPlaying(false);
    window.speechSynthesis.cancel();
  }, []);

  useLayoutEffect(() => {
    if (disabled) stop();
    return stop;
  }, [disabled, stop, text]);

  useEffect(() => {
    // Some browsers populate their installed voice list after the first read.
    window.speechSynthesis?.getVoices();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    const onMicrophone = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-voice-input]')) stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('click', onMicrophone, true);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('click', onMicrophone, true);
      window.removeEventListener('pagehide', stop);
    };
  }, [playing, stop]);

  function toggle() {
    if (utterance.current) return stop();
    if (disabled || document.hidden || !text.trim()) return;
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) {
      setNotice('此瀏覽器不支援朗讀回覆。');
      return;
    }
    if (document.querySelector('[data-voice-input][aria-pressed="true"]')) {
      setNotice('請先結束語音輸入，再朗讀回覆。');
      return;
    }
    if (!stopActive && (synth.speaking || synth.pending)) {
      setNotice('請等目前的朗讀結束後再試。');
      return;
    }
    stopSpokenReply();
    const voices = synth
      .getVoices()
      .filter((v) => v.localService && /^(zh|cmn)([-_]|$)/i.test(v.lang));
    const voice =
      voices.find((v) => /[-_]TW$/i.test(v.lang)) ??
      voices.find((v) => /[-_]Hant/i.test(v.lang)) ??
      voices[0];
    if (!voice) {
      setNotice('裝置上沒有可用的中文朗讀語音。');
      return;
    }
    // Read the rendered answer. Markdown link targets and card metadata aren't part of the reply.
    const value = rendered.current
      ? (rendered.current.innerText ?? rendered.current.textContent)
      : text;
    if (!value?.trim()) return;
    const speech = new SpeechSynthesisUtterance(value);
    speech.voice = voice;
    speech.lang = voice.lang;
    const finish = (failed: boolean) => {
      if (utterance.current !== speech) return;
      utterance.current = null;
      stopActive = null;
      setPlaying(false);
      setNotice(failed ? '朗讀暫時無法使用，請再試一次。' : '');
    };
    speech.onend = () => finish(false);
    speech.onerror = () => finish(true);
    utterance.current = speech;
    stopActive = stop;
    setNotice('');
    setPlaying(true);
    try {
      synth.speak(speech);
    } catch {
      finish(true);
    }
  }

  return (
    <>
      {children && <div ref={rendered}>{children}</div>}
      <div className={styles.control}>
        <button
          type="button"
          disabled={disabled || !text.trim()}
          data-voice-playback
          aria-pressed={playing}
          onClick={toggle}
        >
          {playing ? '停止朗讀' : '朗讀回覆'}
        </button>
        <span role="status">{notice}</span>
      </div>
    </>
  );
}
