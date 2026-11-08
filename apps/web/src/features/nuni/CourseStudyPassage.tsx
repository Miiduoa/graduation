'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import {
  prepareStudyTutorHistory,
  STUDY_TUTOR_LIMITS,
  type StudyMode,
  type StudyPassage,
} from '@/lib/studyTutor';
import { getStudyTutorAvailability, runStudyTutor, type StudyTutorTiming } from '@/lib/studyTutorRuntime';
import {
  appendStudyLesson,
  studyLessonHistory,
  STUDY_SESSION_LIMITS,
  updateStudyMode,
  type StudyLesson,
  type StudyPassageMemory,
} from './courseStudySession';
import { StudyReadAloud } from './StudyReadAloud';
import { CourseStudySteps } from './CourseStudySteps';
import { locateStudyEvidence } from './studyEvidence';
import styles from './CourseStudyPanel.module.css';

type Props = {
  passage: StudyPassage;
  mode: StudyMode;
  memory: StudyPassageMemory;
  onChange: (update: (previous: StudyPassageMemory) => StudyPassageMemory) => void;
};

export function CourseStudyPassage({ passage, mode, memory, onChange }: Props) {
  const [availability, setAvailability] = useState<ReturnType<typeof getStudyTutorAvailability> | null>(null);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [timing, setTiming] = useState<StudyTutorTiming | null>(null);
  const [stepSelection, setStepSelection] = useState<{ lessonId: number; index: number } | null>(null);
  const current = useRef<AbortController | null>(null);
  const passageHeading = useRef<HTMLHeadingElement>(null);
  const evidenceMark = useRef<HTMLElement>(null);
  const questionId = useId();
  const attemptId = useId();
  const noteId = useId();
  const downloadId = useId();
  const lessonId = useId();
  const modeMemory = memory.modes[mode];
  const selected = modeMemory.lessons.find((lesson) => lesson.id === modeMemory.selectedLessonId);
  const result = selected?.response;
  const activeStepIndex = stepSelection?.lessonId === selected?.id ? stepSelection?.index ?? 0 : 0;
  const activeStep = result?.steps?.[activeStepIndex];
  const displayedQuote = activeStep?.sourceQuote ?? result?.sourceQuote;
  const evidence = displayedQuote ? locateStudyEvidence(passage.text, displayedQuote) : null;

  useEffect(() => {
    setAvailability(getStudyTutorAvailability());
    // Preserve focus on the mode/page select when a keyed passage remounts.
    // Explicit passage navigation and practice return focus the source in the parent.
    if (document.activeElement === document.body) passageHeading.current?.focus();
    return () => { current.current?.abort(); current.current = null; };
  }, []);

  function changeQuestion(value: string) {
    onChange((previous) => updateStudyMode(previous, mode, (state) => ({ ...state, question: value })));
  }

  function changeLesson(update: (previous: StudyLesson) => StudyLesson) {
    if (!selected) return;
    onChange((previous) => updateStudyMode(previous, mode, (state) => ({
      ...state,
      lessons: state.lessons.map((lesson) => lesson.id === selected.id ? update(lesson) : lesson),
    })));
  }

  function stop() {
    current.current?.abort();
    current.current = null;
    setBusy(false);
    setProgress('已停止，原文、筆記與先前講解仍保留。');
  }

  async function explain(withHistory = true) {
    if (current.current || !availability?.available || !passage.text.trim()) return;
    const controller = new AbortController();
    current.current = controller;
    const question = modeMemory.question.trim();
    setBusy(true);
    setError('');
    setTiming(null);
    setProgress('正在準備這一段的講解…');
    try {
      // Following an older lesson starts a branch from that point, never from a later answer.
      const turns = studyLessonHistory(modeMemory, selected?.id ?? null);
      const history = withHistory ? prepareStudyTutorHistory(passage, mode, turns, question) : undefined;
      const explanation = await runStudyTutor({ passage, mode, question: question || undefined, history,
        signal: controller.signal,
        onProgress: (message) => {
          if (current.current === controller && !controller.signal.aborted) setProgress(message);
        },
        onTiming: (measurement) => {
          if (current.current === controller) setTiming(measurement);
        },
      });
      if (current.current !== controller || controller.signal.aborted) return;
      setStepSelection(null);
      onChange((previous) => appendStudyLesson(previous, mode, { question, response: explanation }, history ? selected?.id ?? null : null));
      const retained = history?.turns.length ?? 0;
      const scope = withHistory && retained < turns.length
        ? retained === 0 ? '先前講解較長，這次只依目前原文與問題整理。' : `這次帶入最近 ${retained} 輪，較早的講解仍可回看。`
        : '';
      setProgress(`${scope}講解已保留，可對照原文與試答。`);
    } catch (failure) {
      if (current.current !== controller || controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : '講解未能完成，請再試一次。');
      setProgress('先前講解與筆記仍保留，可重試或從原文重新講解。');
    } finally {
      if (current.current === controller) { current.current = null; setBusy(false); }
    }
  }

  return (
    <div className={styles.passage}>
      <div className={styles.sourceHeading}><h4 ref={passageHeading} tabIndex={-1}>原文</h4><span>{passage.label}</span></div>
      <blockquote className={styles.sourceText}>
        {evidence ? <>{evidence.before}<mark ref={evidenceMark} tabIndex={-1}
          className={styles.evidenceHighlight}>{evidence.quote}</mark>{evidence.after}</> : passage.text}
      </blockquote>
      {!passage.text.trim() && <p className={styles.note}>這一段只有空白，可直接前往下一段。</p>}
      {!busy && <StudyReadAloud key={`${selected?.id ?? 'source'}:${activeStepIndex}`}
        text={activeStep?.explanation ?? result?.explanation ?? passage.text}
        label={activeStep ? '朗讀這一步' : result ? '朗讀這段講解' : '朗讀原文'}
        onSpeakingChange={setSpeaking} />}
      <section className={styles.personalNotes} aria-label="本段學習筆記">
        <div className={styles.coachHeading}>
          <h4>我的理解</h4>
          <button type="button" className={styles.button} aria-pressed={memory.needsReview}
            onClick={() => onChange((previous) => ({ ...previous, needsReview: !previous.needsReview }))}>
            {memory.needsReview ? '已加入待複習' : '加入待複習'}
          </button>
        </div>
        <label className={styles.field} htmlFor={noteId}>用自己的話記下這一段
          <textarea id={noteId} rows={3} maxLength={STUDY_SESSION_LIMITS.noteCharacters} value={memory.note}
            onChange={(event) => { const note = event.target.value; onChange((previous) => ({ ...previous, note })); }}
            placeholder="例如：還不清楚的地方、自己的例子，或要問老師的問題" />
        </label>
        <p className={styles.note}>切換段落與讀法會保留筆記；只有你決定哪些段落需要複習。</p>
      </section>
      <div className={styles.coach}>
        <div className={styles.coachHeading}><h4>把這一段弄懂</h4><span>選用 AI 講解</span></div>
        <p id={downloadId} className={styles.note}>
          首次啟用會下載模型（{availability?.downloadLabel ?? '約 1.9 GB，建議使用 Wi-Fi'}）。
          講解在裝置上產生，使用目前原文及同一讀法的近期追問；內容可能有誤，請對照教材。
        </p>
        {availability && !availability.available && <p className={styles.note} role="status">{availability.reason}</p>}
        {modeMemory.lessons.length > 0 && <div className={styles.lessonHistory}>
          <label className={styles.field} htmlFor={lessonId}>這一段的講解記錄
            <select id={lessonId} value={selected?.id ?? ''} disabled={busy} onChange={(event) => {
              const selectedLessonId = Number(event.target.value);
              setStepSelection(null);
              onChange((previous) => updateStudyMode(previous, mode, (state) => ({ ...state, selectedLessonId })));
              setError('');
              setTiming(null);
              setProgress('');
            }}>
              {modeMemory.lessons.map((lesson) => <option value={lesson.id} key={lesson.id}>
                第 {lesson.id} 次：{lesson.question || '開始講解'}
              </option>)}
            </select>
          </label>
          <p className={styles.note}>每種讀法保留最近 {STUDY_SESSION_LIMITS.lessonsPerMode} 次。追問會接續目前選取的講解，最多帶入近期 {STUDY_TUTOR_LIMITS.historyTurns} 輪；長內容可能只帶入一輪或重新依原文整理。</p>
        </div>}
        <label className={styles.field} htmlFor={questionId}>卡在哪裡？也可以直接開始講解
          <textarea id={questionId} rows={2} value={modeMemory.question} maxLength={STUDY_TUTOR_LIMITS.questionCharacters}
            disabled={busy} onChange={(event) => changeQuestion(event.target.value)}
            placeholder={result ? '例如：你剛剛的例子中，為什麼不能重複？' : '例如：用生活中的例子解釋這個概念'} />
        </label>
        <div className={styles.actions}>
          <VoiceDictationButton disabled={busy || speaking} onTranscript={(text) =>
            onChange((previous) => updateStudyMode(previous, mode, (state) => ({
              ...state, question: `${state.question}${state.question ? ' ' : ''}${text}`.slice(0, STUDY_TUTOR_LIMITS.questionCharacters),
            })))} />
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !availability?.available || !passage.text.trim()}
            aria-describedby={downloadId} onClick={() => void explain()}>
            {busy ? '準備講解中…' : result ? '接著追問' : '啟用 AI 講解本段'}
          </button>
          {result && <button type="button" className={styles.button} disabled={busy || !availability?.available}
            onClick={() => void explain(false)}>只依原文重新講解</button>}
          {busy && <button type="button" className={styles.button} onClick={stop}>停止講解</button>}
        </div>
        <p className={styles.note}>語音輸入由瀏覽器提供，可能使用線上辨識服務；轉成文字後，由你決定是否送出。</p>
        {speaking && <p className={styles.note}>停止朗讀後，就能用語音提問。</p>}
        <p className={styles.status} role="status" aria-live="polite">{progress}</p>
        {timing && <p className={styles.note}>
          本次裝置端講解{timing.outcome === 'success' ? '完成' : timing.outcome === 'cancelled' ? '已停止' : '未完成'}：
          準備 {Math.round(timing.preparationMs)} 毫秒，
          {timing.generationMs === null ? '尚未收到生成階段訊號' : `生成 ${Math.round(timing.generationMs)} 毫秒`}，
          合計 {Math.round(timing.totalMs)} 毫秒。僅為本次瀏覽器量測，不能據此認定冷啟、暖啟或回答正確。
        </p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {selected && result && <section className={styles.explanation} aria-label="本段 AI 講解">
          <h4>{result.title}</h4>
          {selected.question && <p className={styles.studentQuestion}>我的問題：{selected.question}</p>}
          <div className={`${styles.evidencePath} ${result.steps ? styles.structuredPath : ''}`} role="group" aria-label="三步對照學習">
            <section className={styles.evidenceStep} aria-label="第一步：核對原文">
              <p className={styles.evidenceStepHeading}>01 · 核對教材原文</p>
              {activeStep && <p className={styles.note}>目前對照第 {activeStepIndex + 1} 步：{activeStep.title}</p>}
              <blockquote className={styles.evidenceQuote}>{displayedQuote}</blockquote>
              <button type="button" className={styles.button} disabled={!evidence}
                onClick={() => evidenceMark.current?.focus()}>定位原文引句</button>
              {evidence && evidence.occurrences > 1 && <p className={styles.note}>
                相同引句在本段出現 {evidence.occurrences} 處，目前標示第一處。
              </p>}
              {!evidence && <p className={styles.error}>目前無法在原文定位這句引用，請重新講解。</p>}
            </section>
            <section className={styles.evidenceStep} aria-label="第二步：理解講解">
              <p className={styles.evidenceStepHeading}>02 · AI 解讀</p>
              <p className={styles.explanationText}>{result.explanation}</p>
              {result.steps && <CourseStudySteps steps={result.steps} activeIndex={activeStepIndex}
                onSelect={(index) => setStepSelection({ lessonId: selected.id, index })}
                onLocate={() => evidenceMark.current?.focus()} evidenceAvailable={!!evidence} />}
              <p className={styles.note}>找到引句只代表原文相符，不代表這段解釋一定正確。</p>
            </section>
            <section className={styles.evidenceStep} aria-label="第三步：自己試答">
              <p className={styles.evidenceStepHeading}>03 · 自己試答</p>
              <div className={styles.exercise}>
                <h4>換你試試</h4>
                <p>{result.question}</p>
                <label className={styles.field} htmlFor={attemptId}>先寫下你的想法
                  <textarea id={attemptId} rows={3} maxLength={STUDY_SESSION_LIMITS.attemptCharacters} value={selected.attempt}
                    onChange={(event) => { const attempt = event.target.value; changeLesson((previous) => ({ ...previous, attempt, answerVisible: false })); }} />
                </label>
                <button type="button" className={styles.button} disabled={!selected.attempt.trim()}
                  onClick={() => changeLesson((previous) => ({ ...previous, answerVisible: !previous.answerVisible }))}
                  aria-expanded={selected.answerVisible}>{selected.answerVisible ? '收起參考回答' : '對照參考回答'}</button>
                {selected.answerVisible && <p className={styles.referenceAnswer}>{result.answer}</p>}
                <p className={styles.note}>這是自我檢查，不會自動評分，也不會影響課程成績或作業繳交狀態。</p>
              </div>
            </section>
          </div>
        </section>}
      </div>
    </div>
  );
}
