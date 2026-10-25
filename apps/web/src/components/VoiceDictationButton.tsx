'use client';

import { useEffect, useRef, useState } from 'react';
import { CampusIcon } from './CampusIcon';
import styles from './VoiceDictationButton.module.css';

interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechResultEvent {
  results: ArrayLike<SpeechResult>;
}
interface SpeechRecognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechConstructor = new () => SpeechRecognizer;

function browserSpeech(): SpeechConstructor | null {
  if (typeof window === 'undefined') return null;
  const browser = window as Window & {
    SpeechRecognition?: SpeechConstructor;
    webkitSpeechRecognition?: SpeechConstructor;
  };
  return browser.SpeechRecognition || browser.webkitSpeechRecognition || null;
}
function describeError(error: string): string {
  if (error === 'not-allowed' || error === 'service-not-allowed')
    return '無法使用麥克風。請在瀏覽器允許權限，或改用文字輸入。';
  if (error === 'no-speech') return '沒有聽到聲音，請再試一次。';
  if (error === 'audio-capture') return '找不到可用的麥克風，請改用文字輸入。';
  if (error === 'network') return '語音辨識暫時無法連線，請改用文字輸入。';
  return '語音辨識未完成，請再試一次或改用文字輸入。';
}

export function VoiceDictationButton({
  onTranscript,
  disabled = false,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef<SpeechRecognizer | null>(null);
  const callback = useRef(onTranscript);

  useEffect(() => {
    callback.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    setSupported(!!browserSpeech());
    return () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      }
    };
  }, []);
  useEffect(() => {
    if (disabled && recognitionRef.current) recognitionRef.current.abort();
  }, [disabled]);

  function toggle() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const Constructor = browserSpeech();
    if (!Constructor || disabled) return;
    const recognition = new Constructor();
    recognitionRef.current = recognition;
    recognition.lang = 'zh-TW';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      const finished: string[] = [];
      const tentative: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim();
        if (!transcript) continue;
        if (result.isFinal) finished.push(transcript);
        else tentative.push(transcript);
      }
      if (finished.length) {
        callback.current(finished.join(' ').slice(0, 4000));
        setInterim('');
      } else {
        setInterim(tentative.join(' ').slice(0, 80));
      }
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      if (event.error !== 'aborted') setError(describeError(event.error));
      setInterim('');
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setListening(false);
      setInterim('');
    };
    try {
      recognition.start();
      setError('');
      setInterim('');
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setError('無法啟動語音辨識，請再試一次或使用鍵盤麥克風。');
    }
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={listening ? styles.listening : styles.button}
        disabled={disabled || !supported}
        aria-label={!supported ? '此瀏覽器不支援語音辨識' : listening ? '停止語音輸入' : '使用語音輸入'}
        aria-pressed={listening}
        title={!supported ? '瀏覽器尚不支援；可使用手機鍵盤的語音輸入' : '語音轉文字，不會自動送出'}
        onClick={toggle}
      >
        <CampusIcon name="microphone" size={19} />
        <span>{listening ? '停止' : '語音'}</span>
      </button>
      {listening && (
        <span className={styles.status} role="status">
          {interim ? interim : '正在聆聽…'}
        </span>
      )}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
