'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { PERSONAL_IMPORT_DOCUMENT_LIMITS } from '@campus/shared/src/imports/documents';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { readPersonalImportDocumentFile } from '@/lib/personalImportDocuments';
import {
  splitStudySection,
  studySourceFromDocument,
  studySourceFromText,
  STUDY_TUTOR_LIMITS,
  type StudyMode,
  type StudyPassage,
  type StudySource,
  type TutorExplanation,
} from '@/lib/studyTutor';
import { getStudyTutorAvailability, runStudyTutor } from '@/lib/studyTutorRuntime';
import { StudyReadAloud } from './StudyReadAloud';
import styles from './CourseStudyPanel.module.css';

type Material = { id: string; title: string; body: string };
type Props = { courseTitle: string; material?: Material; onClose: () => void };

function initialMaterial(material?: Material): { source: StudySource | null; error: string } {
  if (!material?.body.trim()) return { source: null, error: '' };
  try {
    return { source: studySourceFromText({ id: material.id, title: material.title, text: material.body }), error: '' };
  } catch (error) {
    return { source: null, error: error instanceof Error ? error.message : '這份教材無法讀取。' };
  }
}

function PassageStudy({ passage, mode }: { passage: StudyPassage; mode: StudyMode }) {
  const [availability, setAvailability] = useState<ReturnType<typeof getStudyTutorAvailability> | null>(null);
  const [result, setResult] = useState<TutorExplanation | null>(null);
  const [question, setQuestion] = useState('');
  const [attempt, setAttempt] = useState('');
  const [answerVisible, setAnswerVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const current = useRef<AbortController | null>(null);
  const passageHeading = useRef<HTMLHeadingElement>(null);
  const questionId = useId();
  const attemptId = useId();
  const downloadId = useId();

  useEffect(() => {
    setAvailability(getStudyTutorAvailability());
    passageHeading.current?.focus();
    return () => { current.current?.abort(); current.current = null; };
  }, []);

  function stop() {
    current.current?.abort();
    current.current = null;
    setBusy(false);
    setProgress('已停止，原文仍保留。');
  }

  async function explain() {
    if (current.current || !availability?.available || !passage.text.trim()) return;
    const controller = new AbortController();
    current.current = controller;
    setBusy(true);
    setError('');
    setResult(null);
    setAttempt('');
    setAnswerVisible(false);
    setProgress('正在準備這一段的講解…');
    try {
      const explanation = await runStudyTutor({ passage, mode, question: question.trim() || undefined,
        signal: controller.signal,
        onProgress: (message) => {
          if (current.current === controller && !controller.signal.aborted) setProgress(message);
        },
      });
      if (current.current !== controller || controller.signal.aborted) return;
      setResult(explanation);
      setProgress('講解已整理，可對照原文與試答。');
    } catch (failure) {
      if (current.current !== controller || controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : '講解未能完成，請再試一次。');
      setProgress('');
    } finally {
      if (current.current === controller) { current.current = null; setBusy(false); }
    }
  }

  return (
    <div className={styles.passage}>
      <div className={styles.sourceHeading}><h4 ref={passageHeading} tabIndex={-1}>原文</h4><span>{passage.label}</span></div>
      <blockquote className={styles.sourceText}>{passage.text}</blockquote>
      {!passage.text.trim() && <p className={styles.note}>這一段只有空白，可直接前往下一段。</p>}
      {!busy && <StudyReadAloud key={result ? 'explanation' : 'source'}
        text={result?.explanation ?? passage.text} label={result ? '朗讀這段講解' : '朗讀原文'}
        onSpeakingChange={setSpeaking} />}
      <div className={styles.coach}>
        <div className={styles.coachHeading}><h4>把這一段弄懂</h4><span>選用 AI 講解</span></div>
        <p id={downloadId} className={styles.note}>
          首次啟用會下載模型（{availability?.downloadLabel ?? '約 1.9 GB，建議使用 Wi-Fi'}）。
          講解在裝置上產生，只使用目前這一段；內容可能有誤，請對照教材。
        </p>
        {availability && !availability.available && <p className={styles.note} role="status">{availability.reason}</p>}
        <label className={styles.field} htmlFor={questionId}>卡在哪裡？也可以直接開始講解
          <textarea id={questionId} rows={2} value={question} maxLength={STUDY_TUTOR_LIMITS.questionCharacters}
            disabled={busy} onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：用生活中的例子解釋這個概念" />
        </label>
        <div className={styles.actions}>
          <VoiceDictationButton disabled={busy || speaking} onTranscript={(text) =>
            setQuestion((previous) => `${previous}${previous ? ' ' : ''}${text}`.slice(0, STUDY_TUTOR_LIMITS.questionCharacters))} />
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !availability?.available || !passage.text.trim()}
            aria-describedby={downloadId} onClick={() => void explain()}>
            {busy ? '準備講解中…' : result ? '依問題重新講解' : '啟用 AI 講解本段'}
          </button>
          {busy && <button type="button" className={styles.button} onClick={stop}>停止講解</button>}
        </div>
        <p className={styles.note}>語音輸入由瀏覽器提供，可能使用線上辨識服務；轉成文字後，由你決定是否送出。</p>
        {speaking && <p className={styles.note}>停止朗讀後，就能用語音提問。</p>}
        <p className={styles.status} role="status" aria-live="polite">{progress}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {result && <section className={styles.explanation} aria-label="本段 AI 講解">
          <h4>{result.title}</h4>
          <p className={styles.explanationText}>{result.explanation}</p>
          <details className={styles.reference}><summary>對照這段講解引用的原文</summary><blockquote>{result.sourceQuote}</blockquote></details>
          <div className={styles.exercise}>
            <h4>換你試試</h4>
            <p>{result.question}</p>
            <label className={styles.field} htmlFor={attemptId}>先寫下你的想法
              <textarea id={attemptId} rows={3} maxLength={2000} value={attempt}
                onChange={(event) => { setAttempt(event.target.value); setAnswerVisible(false); }} />
            </label>
            <button type="button" className={styles.button} disabled={!attempt.trim()} onClick={() => setAnswerVisible((value) => !value)}
              aria-expanded={answerVisible}>{answerVisible ? '收起參考回答' : '對照參考回答'}</button>
            {answerVisible && <p className={styles.referenceAnswer}>{result.answer}</p>}
            <p className={styles.note}>這是自我檢查，不會自動評分，也不會影響課程成績或作業繳交狀態。</p>
          </div>
        </section>}
      </div>
    </div>
  );
}

export function CourseStudyPanel({ courseTitle, material, onClose }: Props) {
  const [initial] = useState(() => initialMaterial(material));
  const [source, setSource] = useState<StudySource | null>(initial.source);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [passageIndex, setPassageIndex] = useState(0);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<StudyMode>('understand');
  const [paste, setPaste] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(initial.error);
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useRef<AbortController | null>(null);
  const inputId = useId();
  const pasteId = useId();
  const sectionId = useId();
  const modeId = useId();
  const headingId = useId();
  const section = source?.sections[sectionIndex];
  const passages = section ? splitStudySection(section) : [];
  const passage = passages[passageIndex];

  useEffect(() => {
    heading.current?.focus();
    return () => { read.current?.abort(); read.current = null; };
  }, []);

  function replaceSource(value: StudySource) {
    setSource(value);
    setSectionIndex(0);
    setPassageIndex(0);
    setRevision((previous) => previous + 1);
    setError('');
  }

  async function chooseFile(file: File) {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setReading(true);
    setError('');
    try {
      if (!/\.(pdf|txt|md)$/i.test(file.name)) throw new Error('請選擇 PDF、TXT 或 Markdown 文字檔。');
      if (!file.size || file.size > PERSONAL_IMPORT_DOCUMENT_LIMITS.bytes) throw new Error('請選擇有內容且不超過 8 MiB 的檔案。');
      const value = /\.pdf$/i.test(file.name)
        ? studySourceFromDocument(await readPersonalImportDocumentFile(file, controller.signal))
        : studySourceFromText({ id: 'local-text', title: file.name, text: await file.text() });
      if (read.current !== controller || controller.signal.aborted) return;
      replaceSource(value);
    } catch (failure) {
      if (read.current !== controller || controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : '檔案未能讀取，請重試。');
    } finally {
      if (read.current === controller) { read.current = null; setReading(false); }
    }
  }

  function cancelRead() {
    read.current?.abort();
    read.current = null;
    setReading(false);
  }

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>{courseTitle}</p><h3 id={headingId} ref={heading} tabIndex={-1}>讀書白板</h3></div>
        <button type="button" className={styles.button} onClick={onClose}>收起白板</button>
      </header>
      <p className={styles.intro}>一次讀一段，對照原文，再試著用自己的話說明。</p>
      {material && source?.id === material.id && <p className={styles.note}>已帶入「{material.title}」的教材文字。附件與外部連結的內容需另外選擇檔案或貼上文字。</p>}
      <details className={styles.import} open={!source || undefined}>
        <summary>{source ? '換一份講義或貼上內容' : '選擇要讀的內容'}</summary>
        <div className={styles.importBody}>
          <label className={styles.field} htmlFor={inputId}>選擇講義
            <input id={inputId} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              disabled={reading} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void chooseFile(file);
              }} />
          </label>
          <p className={styles.note}>PDF 最多 20 頁、8 MiB；文字最多 60,000 字元。檔案在此裝置讀取，公式、圖表與掃描辨識結果請對照原檔。</p>
          <label className={styles.field} htmlFor={pasteId}>或貼上課文與筆記
            <textarea id={pasteId} rows={4} value={paste} disabled={reading}
              onChange={(event) => setPaste(event.target.value)} placeholder="貼上想理解的段落…" />
          </label>
          <p className={paste.length > STUDY_TUTOR_LIMITS.textCharacters ? styles.error : styles.note}>
            {paste.length.toLocaleString('zh-TW')} / 60,000 字元{paste.length > STUDY_TUTOR_LIMITS.textCharacters ? '，請分成較短的章節；內容尚未加入白板。' : ''}
          </p>
          <button type="button" className={styles.button} disabled={reading || !paste.trim() || paste.length > STUDY_TUTOR_LIMITS.textCharacters}
            onClick={() => {
              try { replaceSource(studySourceFromText({ id: 'pasted', title: '貼上的筆記', text: paste })); setPaste(''); }
              catch (failure) { setError(failure instanceof Error ? failure.message : '文字無法讀取。'); }
            }}>開始讀這份內容</button>
        </div>
      </details>
      {reading && <div className={styles.actions}><p role="status">正在讀取講義…</p><button type="button" className={styles.button} onClick={cancelRead}>取消讀取</button></div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!reading && source && passage && <>
        <div className={styles.sourceMeta}>
          <strong>{source.title}</strong><span>離開白板即清除本次內容</span>
        </div>
        {source.warnings.length > 0 && <details className={styles.reference}>
          <summary>來源注意事項（{source.warnings.length}）</summary>
          {source.warnings.map((warning, index) => <p key={index} className={styles.note}>{warning}</p>)}
        </details>}
        <div className={styles.selectors}>
          <label className={styles.field} htmlFor={sectionId}>閱讀範圍
            <select id={sectionId} value={sectionIndex} onChange={(event) => { setSectionIndex(Number(event.target.value)); setPassageIndex(0); }}>
              {source.sections.map((item, index) => <option value={index} key={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className={styles.field} htmlFor={modeId}>這次怎麼讀
            <select id={modeId} value={mode} onChange={(event) => setMode(event.target.value as StudyMode)}>
              <option value="understand">理解概念</option><option value="exam">考前複習</option><option value="practice">練習思路</option>
            </select>
          </label>
        </div>
        <div className={styles.board}>
          <div className={styles.stepHeading}>
            <span>第 {passageIndex + 1} 段，共 {passages.length} 段</span><span>{section?.label}</span>
          </div>
          <PassageStudy key={`${revision}:${passage.id}:${mode}`} passage={passage} mode={mode} />
          <nav className={styles.stepNavigation} aria-label="白板段落導覽">
            <button type="button" className={styles.button} disabled={passageIndex === 0}
              onClick={() => setPassageIndex((previous) => previous - 1)}>上一段</button>
            <span>{passageIndex + 1} / {passages.length}</span>
            <button type="button" className={styles.button} disabled={passageIndex >= passages.length - 1}
              onClick={() => setPassageIndex((previous) => previous + 1)}>下一段</button>
          </nav>
        </div>
      </>}
    </section>
  );
}
